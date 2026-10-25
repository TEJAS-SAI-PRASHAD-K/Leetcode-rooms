import type { Difficulty, RoomMode } from "@lcr/shared";
import { DIFFICULTY_POINTS, FIRST_SOLVER_BONUS } from "@lcr/shared";

/** Points for one solve. `solveOrder` of 1 earns the (small) first-solver bonus. */
export function pointsFor(difficulty: Difficulty, solveOrder: number): number {
  return DIFFICULTY_POINTS[difficulty] + (solveOrder === 1 ? FIRST_SOLVER_BONUS : 0);
}

/**
 * Current streak: consecutive rounds, ending at the most recent, that the user
 * *completed*.
 *
 * Completing means solving every problem in that round's set — a multi-problem
 * round is a daily goal, not a pile of optional extras. Today is excluded from
 * breaking a streak: the day is not over, so a partially finished set leaves
 * the streak intact rather than zeroing it before the member has had a chance.
 */
export function currentStreak(
  roundDates: string[],
  completedDates: ReadonlySet<string>,
  today: string,
): number {
  let streak = 0;
  for (const date of roundDates) {
    if (completedDates.has(date)) {
      streak++;
      continue;
    }
    if (date === today) continue; // still in progress
    break;
  }
  return streak;
}

/** Longest run of consecutive completed rounds anywhere in the room's history. */
export function longestStreak(
  roundDates: string[],
  completedDates: ReadonlySet<string>,
): number {
  let best = 0;
  let run = 0;
  for (const date of roundDates) {
    if (completedDates.has(date)) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

/**
 * Monday-start week containing `date` (a room-local YYYY-MM-DD), as a
 * YYYY-MM-DD key. The weekly leaderboard resets on this boundary so a strong
 * week never permanently decides the standings.
 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // getUTCDay(): 0=Sunday
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** True when `date` falls in the same Monday-start week as `reference`. */
export function isSameWeek(date: string, reference: string): boolean {
  return weekStart(date) === weekStart(reference);
}

export interface ScoredSolve {
  roundDate: string;
  slug: string;
  points: number;
  solvedAt: number;
}

export interface MemberScore {
  weeklyPoints: number;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  solvedOfLast7: number;
  completedToday: boolean;
  solvedToday: number;
  problemsToday: number;
  finishedAt: number | null;
}

/**
 * Roll a member's solves up into their leaderboard row.
 *
 * `roundSizes` maps each round date to how many problems that round held, which
 * is what makes "completed" meaningful: a round is complete when the member's
 * solve count for it equals its size. Rounds the room never ran are absent, so
 * a skipped day cannot break anyone's streak.
 */
export function scoreMember(args: {
  solves: ScoredSolve[];
  /** Round dates newest first. */
  roundDates: string[];
  /** Round date -> number of problems in that round's set. */
  roundSizes: ReadonlyMap<string, number>;
  today: string;
}): MemberScore {
  const { solves, roundDates, roundSizes, today } = args;

  const byDate = new Map<string, ScoredSolve[]>();
  for (const s of solves) {
    const list = byDate.get(s.roundDate);
    if (list) list.push(s);
    else byDate.set(s.roundDate, [s]);
  }

  const completedDates = new Set<string>();
  for (const [date, list] of byDate) {
    const size = roundSizes.get(date) ?? 0;
    // A round with no problems cannot be "completed", or an empty round would
    // silently extend everyone's streak.
    if (size > 0 && list.length >= size) completedDates.add(date);
  }

  const todaysSolves = byDate.get(today) ?? [];
  const problemsToday = roundSizes.get(today) ?? 0;
  const completedToday = completedDates.has(today);

  return {
    weeklyPoints: solves
      .filter((s) => isSameWeek(s.roundDate, today))
      .reduce((sum, s) => sum + s.points, 0),
    totalPoints: solves.reduce((sum, s) => sum + s.points, 0),
    currentStreak: currentStreak(roundDates, completedDates, today),
    longestStreak: longestStreak(roundDates, completedDates),
    solvedOfLast7: roundDates.slice(0, 7).filter((d) => completedDates.has(d)).length,
    completedToday,
    solvedToday: todaysSolves.length,
    problemsToday,
    // The moment the set was finished, used to rank a time trial.
    finishedAt: completedToday
      ? Math.max(...todaysSolves.map((s) => s.solvedAt))
      : null,
  };
}

type Rankable = Pick<
  MemberScore,
  "weeklyPoints" | "currentStreak" | "totalPoints" | "solvedToday" | "finishedAt"
>;

/**
 * Leaderboard order, which depends on what the room is for.
 *
 * daily      — weekly points, then current streak, then total. Weekly first
 *              keeps the board winnable for someone who joined late or had a
 *              bad fortnight.
 * time_trial — today's result decides it: most problems solved, then whoever
 *              finished the set earliest. Someone who finished ranks above
 *              anyone still going, regardless of accumulated points.
 */
export function compareLeaderboard(mode: RoomMode = "daily") {
  return (a: Rankable, b: Rankable): number => {
    if (mode === "time_trial") {
      if (b.solvedToday !== a.solvedToday) return b.solvedToday - a.solvedToday;
      if (a.finishedAt !== b.finishedAt) {
        if (a.finishedAt === null) return 1; // unfinished ranks last
        if (b.finishedAt === null) return -1;
        return a.finishedAt - b.finishedAt; // earlier finish wins
      }
    }
    return (
      b.weeklyPoints - a.weeklyPoints ||
      b.currentStreak - a.currentStreak ||
      b.totalPoints - a.totalPoints
    );
  };
}
