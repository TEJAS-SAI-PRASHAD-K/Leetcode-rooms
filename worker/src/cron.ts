import { MAX_CHECKS_PER_CRON_RUN } from "@lcr/shared";
import type { Difficulty } from "@lcr/shared";
import type { Env } from "./db.js";
import {
  countProblems,
  insertSolve,
  listPastRounds,
  mapProblem,
  mapRoom,
  setRoundProblems,
  upsertProblems,
} from "./db.js";
import { fetchProblemPage, fetchRecentAccepted, LeetCodeError } from "./leetcode.js";
import { ensureTodayRound } from "./rounds.js";
import { selectFallbackSet } from "./selection.js";
import { isPastPickDeadline, localDate } from "./time.js";

/**
 * Runs every 10 minutes. Three jobs, in priority order:
 *   1. verify outstanding solves
 *   2. fill in rounds whose curator missed the pick deadline
 *   3. top up the problem catalog
 *
 * Workers Free allows 50 subrequests per invocation, which is the binding
 * constraint here — hence the bounded batch and the round-robin cursor.
 */
export async function runCron(env: Env, now = Math.floor(Date.now() / 1000)) {
  const summary = { verified: 0, checked: 0, fallbacks: 0, cataloged: 0 };

  try {
    const fb = await runPickFallback(env, now);
    summary.fallbacks = fb;
  } catch (err) {
    console.error("pick fallback failed", err);
  }

  try {
    const v = await runVerificationSweep(env, now);
    summary.verified = v.verified;
    summary.checked = v.checked;
  } catch (err) {
    console.error("verification sweep failed", err);
  }

  try {
    summary.cataloged = await refreshCatalog(env, now, summary.checked);
  } catch (err) {
    console.error("catalog refresh failed", err);
  }

  await env.DB.prepare(`UPDATE cron_cursor SET last_run_at = ? WHERE id = 1`)
    .bind(now)
    .run();

  console.log("cron", JSON.stringify(summary));
  return summary;
}

// ---------------------------------------------------------------------------
// 1. Verification sweep
// ---------------------------------------------------------------------------

interface PendingCheck {
  roundId: string;
  userId: string;
  username: string;
  slug: string;
  difficulty: Difficulty;
  windowStart: number;
  windowEnd: number;
}

async function runVerificationSweep(env: Env, now: number) {
  // Only members who have not solved yet, in rooms with an open round and a
  // problem set. The work naturally shrinks as the day goes on.
  const { results } = await env.DB.prepare(
    `SELECT r.id AS round_id, u.id AS user_id, u.leetcode_username AS username,
            p.slug, p.difficulty, r.window_start, r.window_end
       FROM rounds r
       JOIN round_problems p ON p.round_id = r.id
       JOIN room_members m   ON m.room_id = r.room_id
       JOIN users u          ON u.id = m.user_id
      WHERE ?1 BETWEEN r.window_start AND r.window_end
        AND u.leetcode_username IS NOT NULL
        AND u.verified_at IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM solves s
               WHERE s.round_id = r.id AND s.user_id = u.id AND s.slug = p.slug
            )
      ORDER BY r.room_id, u.id, p.position`,
  )
    .bind(now)
    .all<{
      round_id: string;
      user_id: string;
      username: string;
      slug: string;
      difficulty: string;
      window_start: number;
      window_end: number;
    }>();

  const pending: PendingCheck[] = results.map((r) => ({
    roundId: r.round_id,
    userId: r.user_id,
    username: r.username,
    slug: r.slug,
    difficulty: r.difficulty as Difficulty,
    windowStart: r.window_start,
    windowEnd: r.window_end,
  }));

  if (pending.length === 0) return { verified: 0, checked: 0 };

  // Round-robin so no room starves when the batch truncates the list.
  const cursorRow = await env.DB.prepare(
    `SELECT position FROM cron_cursor WHERE id = 1`,
  ).first<{ position: number }>();
  const start = (cursorRow?.position ?? 0) % pending.length;

  const batch: PendingCheck[] = [];
  for (let i = 0; i < Math.min(MAX_CHECKS_PER_CRON_RUN, pending.length); i++) {
    batch.push(pending[(start + i) % pending.length]!);
  }

  await env.DB.prepare(`UPDATE cron_cursor SET position = ? WHERE id = 1`)
    .bind((start + batch.length) % pending.length)
    .run();

  // One subrequest per distinct username, not per (user, round): a member in
  // several rooms is checked once and matched against each round.
  const byUser = new Map<string, PendingCheck[]>();
  for (const p of batch) {
    const list = byUser.get(p.username);
    if (list) list.push(p);
    else byUser.set(p.username, [p]);
  }

  let verified = 0;
  for (const [username, checks] of byUser) {
    // One feed fetch covers every outstanding problem for this user, which
    // matters under the 50-subrequest ceiling now that a round holds a set.
    let feed: Awaited<ReturnType<typeof fetchRecentAccepted>>;
    try {
      feed = await fetchRecentAccepted(username);
    } catch (err) {
      if (err instanceof LeetCodeError) {
        console.warn(`verify failed for ${username}: ${err.message}`);
        continue;
      }
      throw err;
    }

    for (const check of checks) {
      try {
        const hit = feed.find(
          (s) =>
            s.titleSlug === check.slug &&
            s.timestamp >= check.windowStart &&
            s.timestamp <= check.windowEnd,
        );
        const solvedAt = hit ? hit.timestamp : null;
        if (solvedAt === null) continue;

        const solve = await insertSolve(env, {
          roundId: check.roundId,
          userId: check.userId,
          slug: check.slug,
          solvedAt,
          difficulty: check.difficulty,
          source: "verified_poll",
          now,
        });
        if (solve) verified++;
      } catch (err) {
        // One bad handle must not abort the sweep for everyone else.
        if (err instanceof LeetCodeError) {
          console.warn(`verify failed for ${username}: ${err.message}`);
          break; // Skip this user's remaining rounds; retry next tick.
        }
        throw err;
      }
    }
  }

  return { verified, checked: byUser.size };
}

// ---------------------------------------------------------------------------
// 2. Pick-deadline fallback
// ---------------------------------------------------------------------------

async function runPickFallback(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT * FROM rooms`).all<
    Parameters<typeof mapRoom>[0]
  >();

  let filled = 0;
  for (const row of results) {
    const room = mapRoom(row);
    const today = localDate(now, room.timezone);

    if (
      !isPastPickDeadline({
        now,
        date: today,
        pickDeadlineLocal: room.pickDeadlineLocal,
        timeZone: room.timezone,
      })
    ) {
      continue;
    }

    const round = await ensureTodayRound(env, room, now);
    if (round.problems.length > 0) continue; // curator already picked

    // Pull a bounded candidate pool from the cache rather than the whole
    // catalog, keeping the query cheap. Ordered by acceptance rate so the
    // fallback leans toward approachable problems.
    const { results: pool } = await env.DB.prepare(
      `SELECT * FROM problem_cache WHERE paid_only = 0 ORDER BY RANDOM() LIMIT 600`,
    ).all<Parameters<typeof mapProblem>[0]>();

    if (pool.length === 0) continue;

    const selection = selectFallbackSet({
      candidates: pool.map(mapProblem),
      pastPicks: await listPastRounds(env, room.id),
      today,
      repeatCooldownDays: room.repeatCooldownDays,
      difficultyFilter: room.difficultyFilter,
      topicFilter: room.topicFilter,
      count: room.problemsPerRound,
    });
    if (!selection) continue;

    await setRoundProblems(env, round.id, selection.problems, selection.source, null, []);

    // A time trial opens when the set is published, so a fallback set starts
    // the clock now rather than inheriting the whole day.
    if (room.mode === "time_trial") {
      await env.DB.prepare(
        `UPDATE rounds SET window_start = ?, window_end = ? WHERE id = ?`,
      )
        .bind(now, now + room.timeTrialMinutes * 60, round.id)
        .run();
    }

    if (selection.notice) console.warn(`room ${room.code}: ${selection.notice}`);
    filled++;
  }

  return filled;
}

// ---------------------------------------------------------------------------
// 3. Catalog top-up
//
// Paged in across ticks so a cold start fills gradually without ever coming
// near the subrequest ceiling.
// ---------------------------------------------------------------------------

async function refreshCatalog(
  env: Env,
  now: number,
  subrequestsUsed: number,
): Promise<number> {
  const budget = MAX_CHECKS_PER_CRON_RUN - subrequestsUsed;
  if (budget < 2) return 0;

  const have = await countProblems(env);
  const PAGE = 100;

  // Fill forward from what we already have; LeetCode's list is stably ordered.
  const page = await fetchProblemPage({ limit: PAGE, skip: have });
  if (page.problems.length === 0) {
    // Catalog complete. Refresh the oldest slice so acRate and new tags stay current.
    const stale = await env.DB.prepare(
      `SELECT slug FROM problem_cache ORDER BY refreshed_at ASC LIMIT 1`,
    ).first<{ slug: string }>();
    if (!stale) return 0;
    const refreshed = await fetchProblemPage({ limit: PAGE, skip: 0 });
    await upsertProblems(env, refreshed.problems, now);
    return refreshed.problems.length;
  }

  await upsertProblems(env, page.problems, now);
  return page.problems.length;
}

/** Exposed for the dev-only manual trigger, so the catalog can be seeded on demand. */
export async function seedCatalog(env: Env, pages = 5): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let total = 0;
  for (let i = 0; i < pages; i++) {
    const have = await countProblems(env);
    const page = await fetchProblemPage({ limit: 100, skip: have });
    if (page.problems.length === 0) break;
    await upsertProblems(env, page.problems, now);
    total += page.problems.length;
  }
  return total;
}
