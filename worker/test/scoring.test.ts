import { describe, expect, it } from "vitest";
import {
  compareLeaderboard,
  currentStreak,
  isSameWeek,
  longestStreak,
  pointsFor,
  scoreMember,
  weekStart,
  type ScoredSolve,
} from "../src/scoring.js";

describe("pointsFor", () => {
  it("weights by difficulty to reward stretching", () => {
    expect(pointsFor("Easy", 2)).toBe(1);
    expect(pointsFor("Medium", 2)).toBe(3);
    expect(pointsFor("Hard", 2)).toBe(5);
  });

  it("adds a small first-solver bonus", () => {
    expect(pointsFor("Easy", 1)).toBe(2);
    expect(pointsFor("Hard", 1)).toBe(6);
  });

  it("keeps the bonus small enough that difficulty still dominates", () => {
    // A Medium solved last must beat an Easy solved first, or "practice, not a
    // race" stops being true.
    expect(pointsFor("Medium", 5)).toBeGreaterThan(pointsFor("Easy", 1));
  });
});

describe("weekStart", () => {
  it("snaps to Monday", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // a Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
  });

  it("puts Sunday and the following Monday in different weeks", () => {
    expect(isSameWeek("2026-10-25", "2026-10-26")).toBe(false);
    expect(isSameWeek("2026-10-19", "2026-10-25")).toBe(true);
  });

  it("works across a year boundary", () => {
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("currentStreak", () => {
  const dates = ["2026-10-25", "2026-10-24", "2026-10-23", "2026-10-22"];

  it("counts consecutive completed rounds", () => {
    const done = new Set(["2026-10-25", "2026-10-24", "2026-10-23"]);
    expect(currentStreak(dates, done, "2026-10-25")).toBe(3);
  });

  it("does not break the streak for an unfinished today", () => {
    const done = new Set(["2026-10-24", "2026-10-23"]);
    expect(currentStreak(dates, done, "2026-10-25")).toBe(2);
  });

  it("breaks on a missed past day", () => {
    const done = new Set(["2026-10-25", "2026-10-23"]);
    expect(currentStreak(dates, done, "2026-10-25")).toBe(1);
  });

  it("counts against rounds the room ran, not calendar days", () => {
    const sparse = ["2026-10-25", "2026-10-23", "2026-10-22"];
    const done = new Set(sparse);
    expect(currentStreak(sparse, done, "2026-10-25")).toBe(3);
  });
});

describe("longestStreak", () => {
  it("finds the best run anywhere in history", () => {
    const dates = ["d7", "d6", "d5", "d4", "d3", "d2", "d1"];
    expect(longestStreak(dates, new Set(["d7", "d5", "d4", "d3", "d1"]))).toBe(3);
  });
});

describe("scoreMember — problem sets", () => {
  const roundDates = ["2026-10-25", "2026-10-24", "2026-10-23"];
  const sizes = (n: number) => new Map(roundDates.map((d) => [d, n]));

  const solve = (roundDate: string, slug: string, points = 3, solvedAt = 1000): ScoredSolve =>
    ({ roundDate, slug, points, solvedAt });

  it("requires every problem in a set before a round counts", () => {
    // Two of three solved: progress, but the day is not complete, so it must
    // not extend the streak.
    const score = scoreMember({
      today: "2026-10-25",
      roundDates,
      roundSizes: sizes(3),
      solves: [solve("2026-10-25", "a"), solve("2026-10-25", "b")],
    });
    expect(score.solvedToday).toBe(2);
    expect(score.problemsToday).toBe(3);
    expect(score.completedToday).toBe(false);
    expect(score.finishedAt).toBeNull();
  });

  it("completes a round once the whole set is solved", () => {
    const score = scoreMember({
      today: "2026-10-25",
      roundDates,
      roundSizes: sizes(3),
      solves: [
        solve("2026-10-25", "a", 3, 100),
        solve("2026-10-25", "b", 3, 300),
        solve("2026-10-25", "c", 3, 200),
      ],
    });
    expect(score.completedToday).toBe(true);
    expect(score.currentStreak).toBe(1);
    // Finish time is the LAST solve, which is what a time trial should rank on.
    expect(score.finishedAt).toBe(300);
  });

  it("awards points for partial progress even when the set is unfinished", () => {
    const score = scoreMember({
      today: "2026-10-25",
      roundDates,
      roundSizes: sizes(3),
      solves: [solve("2026-10-25", "a", 5)],
    });
    expect(score.totalPoints).toBe(5);
    expect(score.completedToday).toBe(false);
  });

  it("counts streaks across multi-problem rounds", () => {
    const score = scoreMember({
      today: "2026-10-25",
      roundDates,
      roundSizes: sizes(2),
      solves: [
        solve("2026-10-25", "a"), solve("2026-10-25", "b"),
        solve("2026-10-24", "c"), solve("2026-10-24", "d"),
        solve("2026-10-23", "e"), // only half of that day
      ],
    });
    expect(score.currentStreak).toBe(2);
    expect(score.solvedOfLast7).toBe(2);
  });

  it("never treats an empty round as completed", () => {
    // A round with no problems picked must not silently extend a streak.
    const score = scoreMember({
      today: "2026-10-25",
      roundDates,
      roundSizes: new Map([["2026-10-25", 0]]),
      solves: [],
    });
    expect(score.completedToday).toBe(false);
    expect(score.currentStreak).toBe(0);
  });

  it("splits weekly from total points", () => {
    const score = scoreMember({
      today: "2026-10-25",
      roundDates: [...roundDates, "2026-10-18"],
      roundSizes: new Map([...sizes(1), ["2026-10-18", 1]]),
      solves: [solve("2026-10-25", "a", 3), solve("2026-10-18", "z", 5)],
    });
    expect(score.totalPoints).toBe(8);
    expect(score.weeklyPoints).toBe(3); // 10-18 is the previous week
  });
});

describe("compareLeaderboard", () => {
  const row = (o: Partial<{
    weeklyPoints: number; currentStreak: number; totalPoints: number;
    solvedToday: number; finishedAt: number | null;
  }> = {}) => ({
    weeklyPoints: 0, currentStreak: 0, totalPoints: 0,
    solvedToday: 0, finishedAt: null, ...o,
  });

  describe("daily mode", () => {
    const cmp = compareLeaderboard("daily");

    it("ranks on weekly points first, keeping the board winnable", () => {
      const sorted = [row({ weeklyPoints: 5, currentStreak: 10, totalPoints: 500 }), row({ weeklyPoints: 9 })].sort(cmp);
      expect(sorted[0]!.weeklyPoints).toBe(9);
    });

    it("breaks ties on streak, then total", () => {
      expect([row({ weeklyPoints: 9, currentStreak: 2 }), row({ weeklyPoints: 9, currentStreak: 7 })]
        .sort(cmp)[0]!.currentStreak).toBe(7);
      expect([row({ weeklyPoints: 9, totalPoints: 10 }), row({ weeklyPoints: 9, totalPoints: 80 })]
        .sort(cmp)[0]!.totalPoints).toBe(80);
    });

    it("ignores today's finish time", () => {
      const sorted = [row({ weeklyPoints: 9, finishedAt: 999 }), row({ weeklyPoints: 1, finishedAt: 1 })].sort(cmp);
      expect(sorted[0]!.weeklyPoints).toBe(9);
    });
  });

  describe("time trial mode", () => {
    const cmp = compareLeaderboard("time_trial");

    it("ranks by problems solved today first", () => {
      const sorted = [row({ solvedToday: 1, weeklyPoints: 99 }), row({ solvedToday: 3 })].sort(cmp);
      expect(sorted[0]!.solvedToday).toBe(3);
    });

    it("breaks ties on who finished earliest", () => {
      const sorted = [
        row({ solvedToday: 3, finishedAt: 500 }),
        row({ solvedToday: 3, finishedAt: 200 }),
      ].sort(cmp);
      expect(sorted[0]!.finishedAt).toBe(200);
    });

    it("ranks anyone still going below anyone who finished", () => {
      const sorted = [
        row({ solvedToday: 3, finishedAt: null, weeklyPoints: 999 }),
        row({ solvedToday: 3, finishedAt: 900 }),
      ].sort(cmp);
      expect(sorted[0]!.finishedAt).toBe(900);
    });

    it("falls back to season standings when today is a dead heat", () => {
      const sorted = [
        row({ solvedToday: 0, weeklyPoints: 2 }),
        row({ solvedToday: 0, weeklyPoints: 8 }),
      ].sort(cmp);
      expect(sorted[0]!.weeklyPoints).toBe(8);
    });
  });
});
