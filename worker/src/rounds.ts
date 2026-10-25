import type { Round } from "@lcr/shared";
import type { Env } from "./db.js";
import { getRound, mapRound } from "./db.js";
import { curatorForRound } from "./selection.js";
import { dayWindow, localDate } from "./time.js";
import { randomId } from "./auth.js";

/**
 * Ensure a round row exists for the room's current local date.
 *
 * Created empty (no problem yet) so the popup can show whose turn it is before
 * anyone has picked, and so the fallback cron has a row to fill in. Idempotent
 * via the UNIQUE(room_id, round_date) constraint, which matters because both
 * the cron and ordinary requests call this.
 */
export async function ensureTodayRound(
  env: Env,
  room: { id: string; timezone: string; curatorOrder: string[] },
  now: number,
): Promise<Round> {
  const date = localDate(now, room.timezone);

  const existing = await getRound(env, room.id, date);
  if (existing) return existing;

  const { start, end } = dayWindow(date, room.timezone);

  // Rotate on the number of rounds the room has already had, so the order is
  // stable and does not depend on who happened to pick last.
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM rounds WHERE room_id = ?`,
  )
    .bind(room.id)
    .first<{ n: number }>();

  const curatorId = curatorForRound({
    curatorOrder: room.curatorOrder,
    roundIndex: countRow?.n ?? 0,
  });

  await env.DB.prepare(
    `INSERT INTO rounds (id, room_id, round_date, curator_id, window_start, window_end, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (room_id, round_date) DO NOTHING`,
  )
    .bind(randomId(), room.id, date, curatorId, start, end, now)
    .run();

  // Re-read rather than trusting our own insert: a concurrent request may have
  // won the race, and that row is the one everyone else will see.
  const row = await env.DB.prepare(
    `SELECT * FROM rounds WHERE room_id = ? AND round_date = ?`,
  )
    .bind(room.id, date)
    .first<Parameters<typeof mapRound>[0]>();

  if (!row) throw new Error(`failed to create round for ${room.id} ${date}`);
  return mapRound(row);
}
