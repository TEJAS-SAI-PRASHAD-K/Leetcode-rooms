import type {
  Difficulty,
  Member,
  Problem,
  Room,
  Round,
  SelectionSource,
  Solve,
  SolveSource,
  WarningCode,
} from "@lcr/shared";
import { DIFFICULTY_POINTS, FIRST_SOLVER_BONUS } from "@lcr/shared";
import type { PastRound } from "./repeats.js";

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
}

// ---------------------------------------------------------------------------
// Row shapes + mappers. Kept explicit so a schema change surfaces as a type
// error rather than an undefined at runtime.
// ---------------------------------------------------------------------------

function parseJsonArray<T>(raw: unknown, fallback: T[] = []): T[] {
  if (typeof raw !== "string") return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

interface RoomRow {
  id: string;
  code: string;
  name: string;
  owner_id: string;
  timezone: string;
  curator_order: string;
  pick_deadline_local: string;
  difficulty_filter: string;
  topic_filter: string;
  repeat_cooldown_days: number;
  topic_warn_window: number;
  topic_warn_threshold: number;
  difficulty_run_threshold: number;
  created_at: number;
}

export function mapRoom(r: RoomRow): Room {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    ownerId: r.owner_id,
    timezone: r.timezone,
    curatorOrder: parseJsonArray<string>(r.curator_order),
    pickDeadlineLocal: r.pick_deadline_local,
    difficultyFilter: parseJsonArray<Difficulty>(r.difficulty_filter),
    topicFilter: parseJsonArray<string>(r.topic_filter),
    repeatCooldownDays: r.repeat_cooldown_days,
    topicWarnWindow: r.topic_warn_window,
    topicWarnThreshold: r.topic_warn_threshold,
    difficultyRunThreshold: r.difficulty_run_threshold,
    createdAt: r.created_at,
  };
}

interface RoundRow {
  id: string;
  room_id: string;
  round_date: string;
  curator_id: string | null;
  problem_slug: string | null;
  problem_title: string | null;
  difficulty: string | null;
  topic_tags: string;
  selection_source: string | null;
  window_start: number;
  window_end: number;
  acknowledged: string;
}

export function mapRound(r: RoundRow): Round {
  return {
    id: r.id,
    roomId: r.room_id,
    roundDate: r.round_date,
    curatorId: r.curator_id,
    problemSlug: r.problem_slug,
    problemTitle: r.problem_title,
    difficulty: (r.difficulty as Difficulty | null) ?? null,
    topicTags: parseJsonArray<string>(r.topic_tags),
    selectionSource: (r.selection_source as SelectionSource | null) ?? null,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    acknowledged: parseJsonArray<WarningCode>(r.acknowledged),
  };
}

interface ProblemRow {
  slug: string;
  frontend_id: string;
  title: string;
  difficulty: string;
  paid_only: number;
  ac_rate: number;
  topic_tags: string;
}

export function mapProblem(r: ProblemRow): Problem {
  return {
    slug: r.slug,
    frontendId: r.frontend_id,
    title: r.title,
    difficulty: r.difficulty as Difficulty,
    paidOnly: r.paid_only === 1,
    acRate: r.ac_rate,
    topicTags: parseJsonArray<string>(r.topic_tags),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getRoomById(env: Env, roomId: string): Promise<Room | null> {
  const row = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`)
    .bind(roomId)
    .first<RoomRow>();
  return row ? mapRoom(row) : null;
}

export async function getRoomByCode(env: Env, code: string): Promise<Room | null> {
  const row = await env.DB.prepare(`SELECT * FROM rooms WHERE code = ?`)
    .bind(code.toUpperCase())
    .first<RoomRow>();
  return row ? mapRoom(row) : null;
}

export async function listMembers(env: Env, roomId: string): Promise<Member[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id          AS user_id,
            u.leetcode_username,
            u.display_name,
            u.verified_at,
            m.role,
            m.joined_at
       FROM room_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ?
      ORDER BY m.joined_at ASC`,
  )
    .bind(roomId)
    .all<{
      user_id: string;
      leetcode_username: string | null;
      display_name: string;
      verified_at: number | null;
      role: string;
      joined_at: number;
    }>();

  return results.map((r) => ({
    userId: r.user_id,
    leetcodeUsername: r.leetcode_username ?? "",
    displayName: r.display_name,
    role: r.role === "owner" ? "owner" : "member",
    verifiedAt: r.verified_at,
    joinedAt: r.joined_at,
  }));
}

export async function isMember(
  env: Env,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM room_members WHERE room_id = ? AND user_id = ?`,
  )
    .bind(roomId, userId)
    .first<{ ok: number }>();
  return row !== null;
}

export async function getRound(
  env: Env,
  roomId: string,
  roundDate: string,
): Promise<Round | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM rounds WHERE room_id = ? AND round_date = ?`,
  )
    .bind(roomId, roundDate)
    .first<RoundRow>();
  return row ? mapRound(row) : null;
}

export async function getRoundById(env: Env, roundId: string): Promise<Round | null> {
  const row = await env.DB.prepare(`SELECT * FROM rounds WHERE id = ?`)
    .bind(roundId)
    .first<RoundRow>();
  return row ? mapRound(row) : null;
}

/** Room round dates, newest first. Streaks are defined against these. */
export async function listRoundDates(env: Env, roomId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT round_date FROM rounds
      WHERE room_id = ? AND problem_slug IS NOT NULL
      ORDER BY round_date DESC`,
  )
    .bind(roomId)
    .all<{ round_date: string }>();
  return results.map((r) => r.round_date);
}

/**
 * Past rounds for repeat detection, newest first, with the curator's name
 * joined in so a block message can say who picked it.
 */
export async function listPastRounds(
  env: Env,
  roomId: string,
  limit = 400,
): Promise<PastRound[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.round_date, r.problem_slug, r.problem_title, r.difficulty,
            r.topic_tags, r.curator_id, u.display_name AS curator_name
       FROM rounds r
       LEFT JOIN users u ON u.id = r.curator_id
      WHERE r.room_id = ? AND r.problem_slug IS NOT NULL
      ORDER BY r.round_date DESC
      LIMIT ?`,
  )
    .bind(roomId, limit)
    .all<{
      round_date: string;
      problem_slug: string;
      problem_title: string | null;
      difficulty: string | null;
      topic_tags: string;
      curator_id: string | null;
      curator_name: string | null;
    }>();

  return results.map((r) => ({
    roundDate: r.round_date,
    problemSlug: r.problem_slug,
    problemTitle: r.problem_title ?? r.problem_slug,
    difficulty: (r.difficulty as Difficulty) ?? "Medium",
    topicTags: parseJsonArray<string>(r.topic_tags),
    curatorId: r.curator_id,
    curatorName: r.curator_name,
  }));
}

export async function listSolves(env: Env, roundId: string): Promise<Solve[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM solves WHERE round_id = ? ORDER BY solve_order ASC`,
  )
    .bind(roundId)
    .all<{
      round_id: string;
      user_id: string;
      solved_at: number;
      points: number;
      solve_order: number;
      source: string;
    }>();

  return results.map((r) => ({
    roundId: r.round_id,
    userId: r.user_id,
    solvedAt: r.solved_at,
    points: r.points,
    solveOrder: r.solve_order,
    source: r.source as SolveSource,
  }));
}

/** Every solve in a room, with its round date, for leaderboard rollup. */
export async function listRoomSolves(
  env: Env,
  roomId: string,
): Promise<Array<{ userId: string; roundDate: string; points: number }>> {
  const { results } = await env.DB.prepare(
    `SELECT s.user_id, r.round_date, s.points
       FROM solves s
       JOIN rounds r ON r.id = s.round_id
      WHERE r.room_id = ?`,
  )
    .bind(roomId)
    .all<{ user_id: string; round_date: string; points: number }>();

  return results.map((r) => ({
    userId: r.user_id,
    roundDate: r.round_date,
    points: r.points,
  }));
}

export async function getProblem(env: Env, slug: string): Promise<Problem | null> {
  const row = await env.DB.prepare(`SELECT * FROM problem_cache WHERE slug = ?`)
    .bind(slug)
    .first<ProblemRow>();
  return row ? mapProblem(row) : null;
}

export async function countProblems(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM problem_cache`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Upsert catalog entries. Chunked by the caller to respect D1 statement limits. */
export async function upsertProblems(env: Env, problems: Problem[], now: number) {
  if (problems.length === 0) return;

  const stmt = env.DB.prepare(
    `INSERT INTO problem_cache
       (slug, frontend_id, title, difficulty, paid_only, ac_rate, topic_tags, refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       frontend_id = excluded.frontend_id,
       title       = excluded.title,
       difficulty  = excluded.difficulty,
       paid_only   = excluded.paid_only,
       ac_rate     = excluded.ac_rate,
       topic_tags  = excluded.topic_tags,
       refreshed_at= excluded.refreshed_at`,
  );

  await env.DB.batch(
    problems.map((p) =>
      stmt.bind(
        p.slug,
        p.frontendId,
        p.title,
        p.difficulty,
        p.paidOnly ? 1 : 0,
        p.acRate,
        JSON.stringify(p.topicTags),
        now,
      ),
    ),
  );
}

/**
 * Record a verified solve.
 *
 * Insert-once on (round_id, user_id) is what makes repeated polling safe: the
 * cron sweep and the post-submit fast path can both race to report the same
 * solve and the first one wins. Returns null when a row already existed, so
 * callers can tell "newly verified" from "already known".
 *
 * Points and solve_order are derived inside the statement rather than read-then-
 * written, so two concurrent verifications cannot both claim first place.
 */
export async function insertSolve(
  env: Env,
  args: {
    roundId: string;
    userId: string;
    solvedAt: number;
    difficulty: Difficulty;
    source: SolveSource;
    now: number;
  },
): Promise<Solve | null> {
  const result = await env.DB.prepare(
    `INSERT INTO solves (round_id, user_id, solved_at, points, solve_order, source, created_at)
     SELECT ?1, ?2, ?3,
            ?4 + CASE WHEN (SELECT COUNT(*) FROM solves WHERE round_id = ?1) = 0
                      THEN ?5 ELSE 0 END,
            1 + (SELECT COUNT(*) FROM solves WHERE round_id = ?1),
            ?6, ?7
     WHERE NOT EXISTS (SELECT 1 FROM solves WHERE round_id = ?1 AND user_id = ?2)`,
  )
    .bind(
      args.roundId,
      args.userId,
      args.solvedAt,
      DIFFICULTY_POINTS[args.difficulty],
      FIRST_SOLVER_BONUS,
      args.source,
      args.now,
    )
    .run();

  if (!result.meta.changes) return null;

  const row = await env.DB.prepare(
    `SELECT * FROM solves WHERE round_id = ? AND user_id = ?`,
  )
    .bind(args.roundId, args.userId)
    .first<{
      round_id: string;
      user_id: string;
      solved_at: number;
      points: number;
      solve_order: number;
      source: string;
    }>();

  return row
    ? {
        roundId: row.round_id,
        userId: row.user_id,
        solvedAt: row.solved_at,
        points: row.points,
        solveOrder: row.solve_order,
        source: row.source as SolveSource,
      }
    : null;
}
