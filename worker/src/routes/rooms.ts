import { Hono } from "hono";
import type {
  BrowseProblemsResponse,
  CreateRoomRequest,
  Difficulty,
  JoinRoomRequest,
  LeaderboardEntry,
  PickRequest,
  PickResponse,
  Problem,
  RoomMode,
  RoomSettings,
  RoomStateResponse,
  Solve,
  VerifyNowResponse,
} from "@lcr/shared";
import { LIMITS, ROOM_DEFAULTS } from "@lcr/shared";
import type { AuthedUser } from "../auth.js";
import { generateRoomCode, randomId } from "../auth.js";
import type { Env } from "../db.js";
import {
  getProblem,
  getRoomByCode,
  getRoomById,
  insertSolve,
  isMember,
  listMembers,
  listPastRounds,
  listRoomSolves,
  listRoundDates,
  listRoundSizes,
  listSolves,
  mapProblem,
  roundHasProblems,
  setRoundProblems,
} from "../db.js";
import { evaluatePick, unacknowledgedWarnings } from "../repeats.js";
import { compareLeaderboard, scoreMember } from "../scoring.js";
import { ensureTodayRound } from "../rounds.js";
import { isValidTimeZone, localDate } from "../time.js";
import { findSolveInWindow, LeetCodeError } from "../leetcode.js";

type Ctx = { Bindings: Env; Variables: { user: AuthedUser } };

export const rooms = new Hono<Ctx>();

const nowSeconds = () => Math.floor(Date.now() / 1000);

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/** Keep room settings inside sane bounds, whatever a client sends. */
function sanitiseSettings(input: Partial<RoomSettings> = {}) {
  const mode: RoomMode = input.mode === "time_trial" ? "time_trial" : "daily";
  return {
    mode,
    problemsPerRound: clamp(
      input.problemsPerRound ?? ROOM_DEFAULTS.problemsPerRound,
      LIMITS.minProblemsPerRound,
      LIMITS.maxProblemsPerRound,
    ),
    timeTrialMinutes: clamp(
      input.timeTrialMinutes ?? ROOM_DEFAULTS.timeTrialMinutes,
      LIMITS.minTimeTrialMinutes,
      LIMITS.maxTimeTrialMinutes,
    ),
    repeatCooldownDays: clamp(
      input.repeatCooldownDays ?? ROOM_DEFAULTS.repeatCooldownDays, 0, 3650),
    topicWarnWindow: clamp(input.topicWarnWindow ?? ROOM_DEFAULTS.topicWarnWindow, 1, 60),
    topicWarnThreshold: clamp(
      input.topicWarnThreshold ?? ROOM_DEFAULTS.topicWarnThreshold, 1, 60),
    difficultyRunThreshold: clamp(
      input.difficultyRunThreshold ?? ROOM_DEFAULTS.difficultyRunThreshold, 1, 60),
    pickDeadlineLocal: /^\d{2}:\d{2}$/.test(input.pickDeadlineLocal ?? "")
      ? input.pickDeadlineLocal!
      : ROOM_DEFAULTS.pickDeadlineLocal,
  };
}

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

  const s = sanitiseSettings(body?.settings);
  const now = nowSeconds();
  const roomId = randomId();

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
                          topic_warn_threshold, difficulty_run_threshold,
                          mode, problems_per_round, time_trial_minutes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      roomId, code, name, user.id, timezone, JSON.stringify([user.id]),
      s.pickDeadlineLocal,
      JSON.stringify(body?.settings?.difficultyFilter ?? []),
      JSON.stringify(body?.settings?.topicFilter ?? []),
      s.repeatCooldownDays, s.topicWarnWindow, s.topicWarnThreshold,
      s.difficultyRunThreshold, s.mode, s.problemsPerRound, s.timeTrialMinutes,
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?,?,?,?)`,
    ).bind(roomId, user.id, "owner", now),
  ]);

  return c.json({ room: await getRoomById(c.env, roomId) }, 201);
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
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?,?,?,?)`,
      ).bind(room.id, user.id, "member", now),
      // Append to the rotation so the new member gets turns.
      c.env.DB.prepare(
        `UPDATE rooms SET curator_order = json_insert(curator_order, '$[#]', ?) WHERE id = ?`,
      ).bind(user.id, room.id),
    ]);
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
// Membership guard for everything below.
// ---------------------------------------------------------------------------

rooms.use("/:roomId/*", async (c, next) => {
  const user = c.get("user");
  if (!(await isMember(c.env, c.req.param("roomId"), user.id))) {
    return c.json({ error: "Not a member of this room", code: "forbidden" }, 403);
  }
  await next();
});

// ---------------------------------------------------------------------------
// Room settings
// ---------------------------------------------------------------------------

rooms.patch("/:roomId/settings", async (c) => {
  const user = c.get("user");
  const room = await getRoomById(c.env, c.req.param("roomId"));
  if (!room) return c.json({ error: "room not found" }, 404);
  if (room.ownerId !== user.id) {
    return c.json({ error: "Only the room owner can change settings", code: "forbidden" }, 403);
  }

  const body = await c.req.json<Partial<RoomSettings>>().catch(() => null);
  if (!body) return c.json({ error: "invalid body" }, 400);

  // Merge over current values so a partial update cannot silently reset
  // settings the caller did not mention.
  const s = sanitiseSettings({ ...room, ...body });

  await c.env.DB.prepare(
    `UPDATE rooms SET mode = ?, problems_per_round = ?, time_trial_minutes = ?,
            repeat_cooldown_days = ?, topic_warn_window = ?, topic_warn_threshold = ?,
            difficulty_run_threshold = ?, pick_deadline_local = ?,
            difficulty_filter = ?, topic_filter = ?
      WHERE id = ?`,
  )
    .bind(
      s.mode, s.problemsPerRound, s.timeTrialMinutes, s.repeatCooldownDays,
      s.topicWarnWindow, s.topicWarnThreshold, s.difficultyRunThreshold,
      s.pickDeadlineLocal,
      JSON.stringify(body.difficultyFilter ?? room.difficultyFilter),
      JSON.stringify(body.topicFilter ?? room.topicFilter),
      room.id,
    )
    .run();

  return c.json({ room: await getRoomById(c.env, room.id) });
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

  const [roundDates, roundSizes, allSolves, solves] = await Promise.all([
    listRoundDates(c.env, room.id),
    listRoundSizes(c.env, room.id),
    listRoomSolves(c.env, room.id),
    listSolves(c.env, round.id),
  ]);

  const leaderboard: LeaderboardEntry[] = members
    .map((m) => {
      const mine = allSolves.filter((s) => s.userId === m.userId);
      const score = scoreMember({ solves: mine, roundDates, roundSizes, today });
      return {
        userId: m.userId,
        displayName: m.displayName,
        leetcodeUsername: m.leetcodeUsername,
        ...score,
      };
    })
    .sort(compareLeaderboard(room.mode));

  // Only meaningful while a time-trial round is open.
  const timeTrialSecondsLeft =
    room.mode === "time_trial" && round.problems.length > 0 && now < round.windowEnd
      ? round.windowEnd - now
      : null;

  const body: RoomStateResponse = {
    room,
    members,
    today: round,
    curator: members.find((m) => m.userId === round.curatorId) ?? null,
    isMyTurn: round.curatorId === user.id,
    problem: null, // superseded by today.problems; kept for contract stability
    solves,
    leaderboard,
    timeTrialSecondsLeft,
    poolExhaustedNotice:
      round.selectionSource === "auto_fallback_exhausted"
        ? `Today's set reused a problem because everything in this room's pool was used within the last ${room.repeatCooldownDays} days. Widen the room's filters to avoid repeats.`
        : null,
  };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Browse the catalog, annotated with this room's repeat verdict.
//
// The verdict rides along per problem so the UI can grey out blocked picks with
// a reason, rather than only rejecting at submit time.
// ---------------------------------------------------------------------------

rooms.get("/:roomId/problems", async (c) => {
  const user = c.get("user");
  const room = await getRoomById(c.env, c.req.param("roomId"));
  if (!room) return c.json({ error: "room not found" }, 404);

  const q = c.req.query("query")?.trim() ?? "";
  const difficulty = c.req.query("difficulty")?.split(",").filter(Boolean) ?? [];
  const tags = c.req.query("tags")?.split(",").filter(Boolean) ?? [];
  const selected = c.req.query("selected")?.split(",").filter(Boolean) ?? [];
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
  // Topic filtering uses a LIKE over the JSON tag array. The quotes make it an
  // exact tag match, so "array" cannot also match "bit-manipulation-array".
  for (const tag of tags) {
    clauses.push("topic_tags LIKE ?");
    binds.push(`%"${tag}"%`);
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
  const pastPicks = await listPastRounds(c.env, room.id);
  const today = localDate(nowSeconds(), room.timezone);

  const body: BrowseProblemsResponse = {
    problems: page.map((p) => ({
      ...p,
      verdict: evaluatePick({
        settings: room,
        candidate: p,
        pastPicks,
        today,
        curatorId: user.id,
        alreadyInSet: selected,
      }),
    })),
    nextCursor: results.length > limit ? cursor + limit : null,
  };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Pick the set for today.
//
// Re-evaluated server-side even though the browse list already showed verdicts:
// a stale popup or a direct API call must not be able to slip a repeat through.
// ---------------------------------------------------------------------------

rooms.post("/:roomId/pick", async (c) => {
  const user = c.get("user");
  const room = await getRoomById(c.env, c.req.param("roomId"));
  if (!room) return c.json({ error: "room not found" }, 404);

  const body = await c.req.json<PickRequest>().catch(() => null);
  const slugs = (body?.slugs ?? []).map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) return c.json({ error: "slugs is required" }, 400);

  if (slugs.length !== room.problemsPerRound) {
    return c.json(
      {
        error: `This room expects ${room.problemsPerRound} problem${room.problemsPerRound === 1 ? "" : "s"} per round, got ${slugs.length}.`,
        code: "wrong_set_size",
      },
      400,
    );
  }
  if (new Set(slugs).size !== slugs.length) {
    return c.json({ error: "The set contains the same problem twice.", code: "duplicate" }, 400);
  }

  const now = nowSeconds();
  const round = await ensureTodayRound(c.env, room, now);

  if (await roundHasProblems(c.env, round.id)) {
    return c.json({ error: "Today's set is already chosen", code: "already_picked" }, 409);
  }
  if (round.curatorId && round.curatorId !== user.id) {
    return c.json(
      {
        ok: false,
        verdict: {
          blocked: { code: "not_your_turn", message: "It is not your turn to pick today." },
          warnings: [],
        },
      } satisfies PickResponse,
      403,
    );
  }

  const pastPicks = await listPastRounds(c.env, room.id);
  const chosen: Problem[] = [];
  const acknowledge = body?.acknowledge ?? [];

  // Evaluate each problem against the room's history *and* the rest of the set,
  // so a set cannot contain the same problem twice or a recent repeat.
  for (const slug of slugs) {
    const candidate = await getProblem(c.env, slug);
    if (!candidate) {
      return c.json({ error: `Unknown problem: ${slug}`, code: "not_found" }, 404);
    }

    const verdict = evaluatePick({
      settings: room,
      candidate,
      pastPicks,
      today: round.roundDate,
      curatorId: user.id,
      alreadyInSet: chosen.map((p) => p.slug),
    });

    if (verdict.blocked) {
      return c.json({ ok: false, verdict } satisfies PickResponse, 409);
    }
    // Overridable warnings must be confirmed explicitly; silence is not
    // consent, so an older client that does not know a code fails closed.
    if (unacknowledgedWarnings(verdict, acknowledge).length > 0) {
      return c.json({ ok: false, verdict } satisfies PickResponse, 428);
    }
    chosen.push(candidate);
  }

  await setRoundProblems(c.env, round.id, chosen, "curator", user.id, acknowledge);

  // A time trial starts the moment the set is published, so everyone races the
  // same window. In daily mode the window stays the room's local day.
  if (room.mode === "time_trial") {
    await c.env.DB.prepare(
      `UPDATE rounds SET window_start = ?, window_end = ? WHERE id = ?`,
    )
      .bind(now, now + room.timeTrialMinutes * 60, round.id)
      .run();
  }

  return c.json({
    ok: true,
    round: (await ensureTodayRound(c.env, room, now)),
  } satisfies PickResponse);
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

  if (round.problems.length === 0) {
    return c.json({ error: "No problems set for today", code: "no_problem" }, 409);
  }
  if (!user.leetcodeUsername) {
    return c.json({ error: "Link your LeetCode account first", code: "no_handle" }, 409);
  }

  const known = (await listSolves(c.env, round.id)).filter((s) => s.userId === user.id);
  const solvedSlugs = new Set(known.map((s) => s.slug));
  const outstanding = round.problems.filter((p) => !solvedSlugs.has(p.slug));

  const newSolves: Solve[] = [];
  let degraded = false;

  for (const problem of outstanding) {
    try {
      const solvedAt = await findSolveInWindow(
        user.leetcodeUsername,
        problem.slug,
        round.windowStart,
        round.windowEnd,
      );
      if (solvedAt === null) continue;

      const solve = await insertSolve(c.env, {
        roundId: round.id,
        userId: user.id,
        slug: problem.slug,
        solvedAt,
        difficulty: problem.difficulty,
        source: "verified_poll",
        now,
      });
      if (solve) newSolves.push(solve);
    } catch (err) {
      // A LeetCode failure makes a negative result inconclusive, so say so
      // rather than telling the user they have not solved it.
      if (!(err instanceof LeetCodeError)) throw err;
      degraded = true;
      break;
    }
  }

  const solves = (await listSolves(c.env, round.id)).filter((s) => s.userId === user.id);
  return c.json({
    newSolves,
    solves,
    completed: solves.length >= round.problems.length,
    degraded,
  } satisfies VerifyNowResponse);
});
