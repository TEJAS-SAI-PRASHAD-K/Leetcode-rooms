import type { Difficulty, Problem, SelectionSource } from "@lcr/shared";
import type { PastRound } from "./repeats.js";
import { daysBetween } from "./repeats.js";

export interface SelectionResult {
  problem: Problem;
  source: SelectionSource;
  /** Set when filters had to be relaxed, so the UI can say why. */
  notice: string | null;
}

/**
 * Pick a problem automatically when the curator missed the deadline.
 *
 * Runs the same repeat rules as a manual pick, so an absent curator can never
 * cause the repeat the whole feature exists to prevent.
 *
 * A narrow room filter plus a 30-day cooldown can leave nothing legal, so this
 * degrades in a fixed, reported order rather than failing: relax the topic
 * filter, then the difficulty filter, then fall back to the least recently used
 * problem. Silently skipping a day is the worst outcome for a habit tracker —
 * better a repeat with a visible notice than a broken streak.
 */
export function selectFallbackProblem(args: {
  candidates: Problem[];
  pastRounds: PastRound[];
  today: string;
  repeatCooldownDays: number;
  difficultyFilter: Difficulty[];
  topicFilter: string[];
  /** Injectable for deterministic tests. */
  random?: () => number;
}): SelectionResult | null {
  const {
    candidates,
    pastRounds,
    today,
    repeatCooldownDays,
    difficultyFilter,
    topicFilter,
    random = Math.random,
  } = args;

  const usable = candidates.filter((p) => !p.paidOnly);
  if (usable.length === 0) return null;

  const blockedSlugs = new Set(
    pastRounds
      .filter((r) => daysBetween(r.roundDate, today) < repeatCooldownDays)
      .map((r) => r.problemSlug),
  );

  const matchesDifficulty = (p: Problem) =>
    difficultyFilter.length === 0 || difficultyFilter.includes(p.difficulty);
  const matchesTopic = (p: Problem) =>
    topicFilter.length === 0 || p.topicTags.some((t) => topicFilter.includes(t));

  // Progressively looser attempts. Order matters: topic is the cheapest
  // constraint to give up, difficulty shapes the room's learning level more.
  const attempts: Array<{ pool: Problem[]; notice: string | null }> = [
    {
      pool: usable.filter(
        (p) => !blockedSlugs.has(p.slug) && matchesDifficulty(p) && matchesTopic(p),
      ),
      notice: null,
    },
    {
      pool: usable.filter((p) => !blockedSlugs.has(p.slug) && matchesDifficulty(p)),
      notice:
        "No unused problems matched this room's topic filter, so the topic filter was ignored for today. Consider widening it.",
    },
    {
      pool: usable.filter((p) => !blockedSlugs.has(p.slug)),
      notice:
        "No unused problems matched this room's filters, so they were ignored for today. Consider widening them.",
    },
  ];

  for (const attempt of attempts) {
    if (attempt.pool.length > 0) {
      const chosen = attempt.pool[Math.floor(random() * attempt.pool.length)]!;
      return { problem: chosen, source: "auto_fallback", notice: attempt.notice };
    }
  }

  // Everything available is inside the cooldown. Reuse the least recently used
  // problem and say so loudly.
  const lastUsed = new Map<string, string>();
  for (const r of pastRounds) {
    // pastRounds is newest first, so the first entry per slug is its latest use.
    if (!lastUsed.has(r.problemSlug)) lastUsed.set(r.problemSlug, r.roundDate);
  }

  const leastRecent = [...usable].sort((a, b) => {
    const da = lastUsed.get(a.slug) ?? "0000-00-00";
    const db = lastUsed.get(b.slug) ?? "0000-00-00";
    return da < db ? -1 : da > db ? 1 : 0;
  })[0]!;

  return {
    problem: leastRecent,
    source: "auto_fallback_exhausted",
    notice:
      `Every problem in this room's pool was used within the last ${repeatCooldownDays} days, ` +
      `so "${leastRecent.title}" was reused as the least recently seen. ` +
      `Widen the room's difficulty or topic filters to avoid repeats.`,
  };
}

/**
 * Whose turn it is to pick. Rotates by round index so the order is stable and
 * predictable rather than depending on who last picked.
 */
export function curatorForRound(args: {
  curatorOrder: string[];
  roundIndex: number;
}): string | null {
  const { curatorOrder, roundIndex } = args;
  if (curatorOrder.length === 0) return null;
  const i = ((roundIndex % curatorOrder.length) + curatorOrder.length) % curatorOrder.length;
  return curatorOrder[i]!;
}
