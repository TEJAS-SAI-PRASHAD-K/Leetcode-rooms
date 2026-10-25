import type { Difficulty } from "@lcr/shared";
import { DIFFICULTY_POINTS, FIRST_SOLVER_BONUS } from "@lcr/shared";

/** Points for one solve. `solveOrder` of 1 earns the (small) first-solver bonus. */
export function pointsFor(difficulty: Difficulty, solveOrder: number): number {
  return DIFFICULTY_POINTS[difficulty] + (solveOrder === 1 ? FIRST_SOLVER_BONUS : 0);
}

/**
 * Current streak: consecutive rounds ending at the most recent *completed* day
 * that the user solved.
 *
 * `roundDates` must be the room's round dates, newest first. Today is excluded
 * from breaking a streak — the day is not over yet, so an unsolved today leaves
 * the streak intact rather than zeroing it before the member has had a chance.
 */
export function currentStreak(
  roundDates: string[],
  solvedDates: ReadonlySet<string>,
  today: string,
): number {
  let streak = 0;
  for (const date of roundDates) {
    if (solvedDates.has(date)) {
      streak++;
      continue;
    }
    // An unsolved today is pending, not a break.
    if (date === today) continue;
    break;
  }
  return streak;
}

/** Longest run of consecutive solved rounds anywhere in the room's history. */
export function longestStreak(
  roundDates: string[],
  solvedDates: ReadonlySet<string>,
): number {
  let best = 0;
  let run = 0;
  for (const date of roundDates) {
    if (solvedDates.has(date)) {
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
  // getUTCDay(): 0=Sunday. Shift so Monday is the first day of the week.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** True when `date` falls in the same Monday-start week as `reference`. */
export function isSameWeek(date: string, reference: string): boolean {
  return weekStart(date) === weekStart(reference);
}

export interface ScoredSolve {
  roundDate: string;
  points: number;
}

export interface MemberScore {
  weeklyPoints: number;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  solvedOfLast7: number;
  solvedToday: boolean;
}

/**
 * Roll a member's solves up into their leaderboard row.
 *
 * `roundDates` is every round the room has run, newest first — needed because
 * a streak is defined against days the room actually had a problem, so a room
 * that skipped a day doesn't break anyone's streak.
 */
export function scoreMember(args: {
  solves: ScoredSolve[];
  roundDates: string[];
  today: string;
}): MemberScore {
  const { solves, roundDates, today } = args;
  const solvedDates = new Set(solves.map((s) => s.roundDate));
  const last7 = roundDates.slice(0, 7);

  return {
    weeklyPoints: solves
      .filter((s) => isSameWeek(s.roundDate, today))
      .reduce((sum, s) => sum + s.points, 0),
    totalPoints: solves.reduce((sum, s) => sum + s.points, 0),
    currentStreak: currentStreak(roundDates, solvedDates, today),
    longestStreak: longestStreak(roundDates, solvedDates),
    solvedOfLast7: last7.filter((d) => solvedDates.has(d)).length,
    solvedToday: solvedDates.has(today),
  };
}

/**
 * Leaderboard order: weekly points, then current streak, then total points.
 * Weekly first is deliberate — it keeps the standings winnable for someone who
 * joined late or had a bad fortnight.
 */
export function compareLeaderboard(
  a: Pick<MemberScore, "weeklyPoints" | "currentStreak" | "totalPoints">,
  b: Pick<MemberScore, "weeklyPoints" | "currentStreak" | "totalPoints">,
): number {
  return (
    b.weeklyPoints - a.weeklyPoints ||
    b.currentStreak - a.currentStreak ||
    b.totalPoints - a.totalPoints
  );
}
