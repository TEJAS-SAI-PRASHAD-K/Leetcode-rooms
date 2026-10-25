import { Hono } from "hono";
import type {
  BrowseProblemsResponse,
  CreateRoomRequest,
  JoinRoomRequest,
  LeaderboardEntry,
  PickRequest,
  PickResponse,
  Problem,
  RoomStateResponse,
  VerifyNowResponse,
} from "@lcr/shared";
import { ROOM_DEFAULTS } from "@lcr/shared";
import type { AuthedUser } from "../auth.js";
import { generateRoomCode, randomId } from "../auth.js";
import type { Env } from "../db.js";
import {
  getProblem,
  getRoomByCode,
  getRoomById,
  isMember,
  listMembers,
  listPastRounds,
  listRoomSolves,
  listRoundDates,
  listSolves,
  insertSolve,
  mapProblem,
} from "../db.js";
import { evaluatePick, unacknowledgedWarnings } from "../repeats.js";
import { compareLeaderboard, scoreMember } from "../scoring.js";
import { ensureTodayRound } from "../rounds.js";
import { isValidTimeZone, localDate } from "../time.js";
import { findSolveInWindow, LeetCodeError } from "../leetcode.js";

type Ctx = { Bindings: Env; Variables: { user: AuthedUser } };

export const rooms = new Hono<Ctx>();

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Create / join
// ---------------------------------------------------------------------------

rooms.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<CreateRoomRequest>().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  const timezone = body?.timezone ?? ROOM_DEFAULTS.timezone;
  if (!isValidTimeZone(timezone)) {
    return c.json({ error: `unknown timezone: ${timezone}` }, 400);
  }

  const s = { ...ROOM_DEFAULTS, ...body?.settings };
  const now = nowSeconds();
  const roomId = randomId();

  // Retry on the (unlikely) code collision rather than failing the request.
  let code = generateRoomCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await getRoomByCode(c.env, code))) break;
    code = generateRoomCode();
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO rooms (id, code, name, owner_id, timezone, curator_order,
                          pick_deadline_local, difficulty_filter, topic_filter,
                          repeat_cooldown_days, topic_warn_window,
                          topic_warn_threshold, difficulty_run_threshold, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      roomId,
      code,
      name,
      user.id,
      timezone,
      JSON.stringify([user.id]),
      s.pickDeadlineLocal,
      JSON.stringify(body?.settings?.difficultyFilter ?? []),
      JSON.stringify(body?.settings?.topicFilter ?? []),
      s.repeatCooldownDays,
      s.topicWarnWindow,
      s.topicWarnThreshold,
      s.difficultyRunThreshold,
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?,?,?,?)`,
    ).bind(roomId, user.id, "owner", now),
  ]);

  const room = await getRoomById(c.env, roomId);
  return c.json({ room }, 201);
});

rooms.post("/join", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<JoinRoomRequest>().catch(() => null);
  const code = body?.code?.trim().toUpperCase();
  if (!code) return c.json({ error: "code is required" }, 400);

  const room = await getRoomByCode(c.env, code);
  if (!room) return c.json({ error: "No room with that code", code: "not_found" }, 404);

  const now = nowSeconds();
  if (!(await isMember(c.env, room.id, user.id))) {
    await c.env.DB.prepare(
      `INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?,?,?,?)`,
    )
      .bind(room.id, user.id, "member", now)
      .run();

    // Append to the rotation so the new member gets turns.
    await c.env.DB.prepare(
      `UPDATE rooms SET curator_order = json_insert(curator_order, '$[#]', ?) WHERE id = ?`,
    )
      .bind(user.id, room.id)
      .run();
  }

  return c.json({ room: await getRoomById(c.env, room.id) });
});

rooms.get("/", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.code, r.name
       FROM room_members m JOIN rooms r ON r.id = m.room_id
      WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
  )
    .bind(user.id)
    .all<{ id: string; code: string; name: string }>();
  return c.json({ rooms: results });
});

// ---------------------------------------------------------------------------
// Shared guard: every route below needs membership.
// ---------------------------------------------------------------------------

rooms.use("/:roomId/*", async (c, next) => {
  const user = c.get("user");
  const roomId = c.req.param("roomId");
  if (!(await isMember(c.env, roomId, user.id))) {
    return c.json({ error: "Not a member of this room", code: "forbidden" }, 403);
  }
  await next();
});

// ---------------------------------------------------------------------------
// Room state — the single call the popup renders from.
// ---------------------------------------------------------------------------

rooms.get("/:roomId/state", async (c) => {
  const user = c.get("user");
  const room = await getRoomById(c.env, c.req.param("roomId"));
  if (!room) return c.json({ error: "room not found" }, 404);

  const now = nowSeconds();
  const today = localDate(now, room.timezone);
  const round = await ensureTodayRound(c.env, room, now);
  const members = await listMembers(c.env, room.id);

  const [roundDates, allSolves, solves] = await Promise.all([
    listRoundDates(c.env, room.id),
    listRoomSolves(c.env, room.id),
    listSolves(c.env, round.id),
  ]);

  const leaderboard: LeaderboardEntry[] = members
    .map((m) => {
      const mine = allSolves
        .filter((s) => s.userId === m.userId)
        .map((s) => ({ roundDate: s.roundDate, points: s.points }));
      const score = scoreMember({ solves: mine, roundDates, today });
      return {
        userId: m.userId,
        displayName: m.displayName,
        leetcodeUsername: m.leetcodeUsername,
        ...score,
      };
    })
    .sort(compareLeaderboard);

  const problem = round.problemSlug
    ? await getProblem(c.env, round.problemSlug)
    : null;

  const body: RoomStateResponse = {
    room,
    members,
    today: round,
    curator: members.find((m) => m.userId === round.curatorId) ?? null,
    isMyTurn: round.curatorId === user.id,
    problem,
    solves,
    leaderboard,
    poolExhaustedNotice:
      round.selectionSource === "auto_fallback_exhausted"
        ? `Today's problem was reused because every problem in this room's pool was used within the last ${room.repeatCooldownDays} days. Widen the room's filters to avoid repeats.`
        : null,
  };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Browse the catalog, annotated with this room's repeat verdict.
//
// The verdict is attached per problem so the UI can grey out blocked picks with
// a reason, instead of only rejecting at submit time.
// ---------------------------------------------------------------------------

rooms.get("/:roomId/problems", async (c) => {
  const user = c.get("user");
  const room = await getRoomById(c.env, c.req.param("roomId"));
  if (!room) return c.json({ error: "room not found" }, 404);

  const q = c.req.query("query")?.trim() ?? "";
  const difficulty = c.req.query("difficulty")?.split(",").filter(Boolean) ?? [];
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const cursor = Number(c.req.query("cursor") ?? 0);

  const clauses = ["paid_only = 0"];
  const binds: unknown[] = [];
  if (q) {
    clauses.push("(title LIKE ? OR slug LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (difficulty.length) {
    clauses.push(`difficulty IN (${difficulty.map(() => "?").join(",")})`);
    binds.push(...difficulty);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM problem_cache
      WHERE ${clauses.join(" AND ")}
      ORDER BY CAST(frontend_id AS INTEGER) ASC
      LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit + 1, cursor)
    .all<Parameters<typeof mapProblem>[0]>();

  const page = results.slice(0, limit).map(mapProblem);
  const pastRounds = await listPastRounds(c.env, room.id);
  const today = localDate(nowSeconds(), room.timezone);

  const body: BrowseProblemsResponse = {
    problems: page.map((p) => ({
      ...p,
      verdict: evaluatePick({
        settings: room,
        candidate: p,
        pastRounds,
        today,
        curatorId: user.id,
      }),
    })),
    nextCursor: results.length > limit ? cursor + limit : null,
  };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Pick today's problem.
//
// Re-evaluates server-side even though the browse list already showed verdicts:
// a stale popup or a direct API call must not be able to slip a repeat through.
// ---------------------------------------------------------------------------

rooms.post("/:roomId/pick", async (c) => {
  const user = c.get("user");
  const room = await getRoomById(c.env, c.req.param("roomId"));
  if (!room) return c.json({ error: "room not found" }, 404);

  const body = await c.req.json<PickRequest>().catch(() => null);
  const slug = body?.slug?.trim();
  if (!slug) return c.json({ error: "slug is required" }, 400);

  const now = nowSeconds();
  const round = await ensureTodayRound(c.env, room, now);

  if (round.problemSlug) {
    return c.json(
      { error: "Today's problem is already set", code: "already_picked" },
      409,
    );
  }
  if (round.curatorId && round.curatorId !== user.id) {
    const resp: PickResponse = {
      ok: false,
      verdict: {
        blocked: { code: "not_your_turn", message: "It is not your turn to pick today." },
        warnings: [],
      },
    };
    return c.json(resp, 403);
  }

  const candidate = await getProblem(c.env, slug);
  if (!candidate) {
    return c.json({ error: `Unknown problem: ${slug}`, code: "not_found" }, 404);
  }

  const pastRounds = await listPastRounds(c.env, room.id);
  const verdict = evaluatePick({
    settings: room,
    candidate,
    pastRounds,
    today: round.roundDate,
    curatorId: user.id,
  });

  if (verdict.blocked) {
    return c.json({ ok: false, verdict } satisfies PickResponse, 409);
  }

  // Overridable warnings must be confirmed explicitly; silence is not consent,
  // so an older client that does not know a warning code fails closed.
  const missing = unacknowledgedWarnings(verdict, body?.acknowledge);
  if (missing.length > 0) {
    return c.json({ ok: false, verdict } satisfies PickResponse, 428);
  }

  await c.env.DB.prepare(
    `UPDATE rounds
        SET problem_slug = ?, problem_title = ?, difficulty = ?, topic_tags = ?,
            selection_source = 'curator', curator_id = ?, acknowledged = ?
      WHERE id = ?`,
  )
    .bind(
      candidate.slug,
      candidate.title,
      candidate.difficulty,
      JSON.stringify(candidate.topicTags),
      user.id,
      JSON.stringify(body?.acknowledge ?? []),
      round.id,
    )
    .run();

  const updated = await ensureTodayRound(c.env, room, now);
  return c.json({ ok: true, round: updated } satisfies PickResponse);
});

// ---------------------------------------------------------------------------
// On-demand verification (the post-submit fast path).
//
// The extension asks the server to *check*; it never asserts a solve itself.
// ---------------------------------------------------------------------------

rooms.post("/:roomId/verify-now", async (c) => {
  const user = c.get("user");
  const room = await getRoomById(c.env, c.req.param("roomId"));
  if (!room) return c.json({ error: "room not found" }, 404);

  const now = nowSeconds();
  const round = await ensureTodayRound(c.env, room, now);

  if (!round.problemSlug || !round.difficulty) {
    return c.json({ error: "No problem set for today", code: "no_problem" }, 409);
  }
  if (!user.leetcodeUsername) {
    return c.json(
      { error: "Link your LeetCode account first", code: "no_handle" },
      409,
    );
  }

  const existing = (await listSolves(c.env, round.id)).find(
    (s) => s.userId === user.id,
  );
  if (existing) {
    return c.json({ solved: true, solve: existing, degraded: false } satisfies VerifyNowResponse);
  }

  let solvedAt: number | null = null;
  try {
    solvedAt = await findSolveInWindow(
      user.leetcodeUsername,
      round.problemSlug,
      round.windowStart,
      round.windowEnd,
    );
  } catch (err) {
    // A LeetCode failure makes a negative result inconclusive, so say so rather
    // than telling the user they have not solved it.
    if (err instanceof LeetCodeError) {
      return c.json({ solved: false, solve: null, degraded: true } satisfies VerifyNowResponse);
    }
    throw err;
  }

  if (solvedAt === null) {
    return c.json({ solved: false, solve: null, degraded: false } satisfies VerifyNowResponse);
  }

  const solve = await insertSolve(c.env, {
    roundId: round.id,
    userId: user.id,
    solvedAt,
    difficulty: round.difficulty,
    source: "verified_poll",
    now,
  });

  return c.json({
    solved: true,
    solve: solve ?? (await listSolves(c.env, round.id)).find((s) => s.userId === user.id) ?? null,
    degraded: false,
  } satisfies VerifyNowResponse);
});
