import { describe, expect, it } from "vitest";
import {
  compareLeaderboard,
  currentStreak,
  isSameWeek,
  longestStreak,
  pointsFor,
  scoreMember,
  weekStart,
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
    // A Medium solved last must beat an Easy solved first, or the "practice,
    // not a race" framing breaks down.
    expect(pointsFor("Medium", 5)).toBeGreaterThan(pointsFor("Easy", 1));
  });
});

describe("weekStart", () => {
  it("snaps to Monday", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // a Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // the Monday itself
    expect(weekStart("2026-10-20")).toBe("2026-10-19");
  });

  it("puts Sunday and the following Monday in different weeks", () => {
    // The classic off-by-one: Sunday must close the week, not open it.
    expect(isSameWeek("2026-10-25", "2026-10-26")).toBe(false);
    expect(isSameWeek("2026-10-19", "2026-10-25")).toBe(true);
  });

  it("works across a year boundary", () => {
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("currentStreak", () => {
  const dates = ["2026-10-25", "2026-10-24", "2026-10-23", "2026-10-22"];

  it("counts consecutive solved rounds", () => {
    const solved = new Set(["2026-10-25", "2026-10-24", "2026-10-23"]);
    expect(currentStreak(dates, solved, "2026-10-25")).toBe(3);
  });

  it("does not break the streak for an unsolved today", () => {
    // The day is not over. Zeroing the streak before the member has had a
    // chance to solve would be actively discouraging.
    const solved = new Set(["2026-10-24", "2026-10-23"]);
    expect(currentStreak(dates, solved, "2026-10-25")).toBe(2);
  });

  it("breaks on a missed past day", () => {
    const solved = new Set(["2026-10-25", "2026-10-23"]);
    expect(currentStreak(dates, solved, "2026-10-25")).toBe(1);
  });

  it("is zero when nothing is solved", () => {
    expect(currentStreak(dates, new Set(), "2026-10-25")).toBe(0);
  });

  it("counts against rounds the room ran, not calendar days", () => {
    // The room skipped 10-24, so solving 10-25 and 10-23 is an unbroken streak.
    const sparse = ["2026-10-25", "2026-10-23", "2026-10-22"];
    const solved = new Set(["2026-10-25", "2026-10-23", "2026-10-22"]);
    expect(currentStreak(sparse, solved, "2026-10-25")).toBe(3);
  });
});

describe("longestStreak", () => {
  it("finds the best run anywhere in history", () => {
    const dates = ["d7", "d6", "d5", "d4", "d3", "d2", "d1"];
    const solved = new Set(["d7", "d5", "d4", "d3", "d1"]);
    expect(longestStreak(dates, solved)).toBe(3);
  });

  it("is zero with no solves", () => {
    expect(longestStreak(["d1", "d2"], new Set())).toBe(0);
  });
});

describe("scoreMember", () => {
  const roundDates = [
    "2026-10-25", "2026-10-24", "2026-10-23", "2026-10-22",
    "2026-10-21", "2026-10-20", "2026-10-19", "2026-10-18",
  ];

  it("rolls solves into a leaderboard row", () => {
    const score = scoreMember({
      today: "2026-10-25",
      roundDates,
      solves: [
        { roundDate: "2026-10-25", points: 3 },
        { roundDate: "2026-10-24", points: 1 },
        { roundDate: "2026-10-19", points: 5 },
        // Previous week: counts toward total, not weekly.
        { roundDate: "2026-10-18", points: 5 },
      ],
    });

    expect(score.totalPoints).toBe(14);
    expect(score.weeklyPoints).toBe(9); // 19th-25th is one Monday-start week
    expect(score.currentStreak).toBe(2);
    expect(score.solvedOfLast7).toBe(3);
    expect(score.solvedToday).toBe(true);
  });

  it("reports solvedToday false before solving, without losing the streak", () => {
    const score = scoreMember({
      today: "2026-10-25",
      roundDates,
      solves: [
        { roundDate: "2026-10-24", points: 1 },
        { roundDate: "2026-10-23", points: 1 },
      ],
    });
    expect(score.solvedToday).toBe(false);
    expect(score.currentStreak).toBe(2);
  });

  it("handles a brand-new member with no solves", () => {
    const score = scoreMember({ today: "2026-10-25", roundDates, solves: [] });
    expect(score).toMatchObject({
      weeklyPoints: 0,
      totalPoints: 0,
      currentStreak: 0,
      longestStreak: 0,
      solvedOfLast7: 0,
      solvedToday: false,
    });
  });
});

describe("compareLeaderboard", () => {
  const row = (weeklyPoints: number, currentStreak: number, totalPoints: number) => ({
    weeklyPoints, currentStreak, totalPoints,
  });

  it("ranks on weekly points first, so the board stays winnable", () => {
    const sorted = [row(5, 10, 500), row(9, 1, 10)].sort(compareLeaderboard);
    expect(sorted[0]!.weeklyPoints).toBe(9);
  });

  it("breaks weekly ties on current streak", () => {
    const sorted = [row(9, 2, 999), row(9, 7, 10)].sort(compareLeaderboard);
    expect(sorted[0]!.currentStreak).toBe(7);
  });

  it("falls back to total points", () => {
    const sorted = [row(9, 3, 10), row(9, 3, 80)].sort(compareLeaderboard);
    expect(sorted[0]!.totalPoints).toBe(80);
  });
});
