import { describe, expect, it } from "vitest";
import type { Problem } from "@lcr/shared";
import {
  curatorForRound,
  selectFallbackProblem,
  selectFallbackSet,
} from "../src/selection.js";
import type { PastPick } from "../src/repeats.js";

const TODAY = "2026-10-25";

function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function p(slug: string, over: Partial<Problem> = {}): Problem {
  return {
    slug,
    frontendId: "1",
    title: slug,
    difficulty: "Medium",
    paidOnly: false,
    acRate: 50,
    topicTags: ["array"],
    ...over,
  };
}

function past(slug: string, date: string): PastPick {
  return {
    roundDate: date,
    problemSlug: slug,
    problemTitle: slug,
    difficulty: "Medium",
    topicTags: ["array"],
    curatorId: "u1",
    curatorName: "Sam",
  };
}

const base = {
  today: TODAY,
  repeatCooldownDays: 30,
  difficultyFilter: [] as never[],
  topicFilter: [] as never[],
  random: () => 0,
};

describe("selectFallbackProblem", () => {
  it("never picks a problem inside the cooldown", () => {
    const r = selectFallbackProblem({
      ...base,
      candidates: [p("recent"), p("fresh")],
      pastPicks: [past("recent", daysAgo(5))],
    });
    expect(r!.problem.slug).toBe("fresh");
    expect(r!.source).toBe("auto_fallback");
    expect(r!.notice).toBeNull();
  });

  it("will reuse a problem once past the cooldown", () => {
    const r = selectFallbackProblem({
      ...base,
      candidates: [p("old")],
      pastPicks: [past("old", daysAgo(60))],
    });
    expect(r!.problem.slug).toBe("old");
    expect(r!.source).toBe("auto_fallback");
  });

  it("skips Premium problems", () => {
    const r = selectFallbackProblem({
      ...base,
      candidates: [p("locked", { paidOnly: true }), p("free")],
      pastPicks: [],
    });
    expect(r!.problem.slug).toBe("free");
  });

  it("honours the room's difficulty and topic filters", () => {
    const r = selectFallbackProblem({
      ...base,
      difficultyFilter: ["Hard"] as never,
      topicFilter: ["graph"] as never,
      candidates: [
        p("a", { difficulty: "Easy", topicTags: ["graph"] }),
        p("b", { difficulty: "Hard", topicTags: ["array"] }),
        p("c", { difficulty: "Hard", topicTags: ["graph"] }),
      ],
      pastPicks: [],
    });
    expect(r!.problem.slug).toBe("c");
  });

  it("relaxes the topic filter before the difficulty filter", () => {
    const r = selectFallbackProblem({
      ...base,
      difficultyFilter: ["Hard"] as never,
      topicFilter: ["graph"] as never,
      candidates: [
        p("easy-graph", { difficulty: "Easy", topicTags: ["graph"] }),
        p("hard-array", { difficulty: "Hard", topicTags: ["array"] }),
      ],
      pastPicks: [],
    });
    // Difficulty is the more meaningful constraint, so it survives.
    expect(r!.problem.slug).toBe("hard-array");
    expect(r!.source).toBe("auto_fallback");
    expect(r!.notice).toContain("topic filter");
  });

  it("relaxes both filters rather than skipping the day", () => {
    const r = selectFallbackProblem({
      ...base,
      difficultyFilter: ["Hard"] as never,
      topicFilter: ["graph"] as never,
      candidates: [p("easy-array", { difficulty: "Easy", topicTags: ["array"] })],
      pastPicks: [],
    });
    expect(r!.problem.slug).toBe("easy-array");
    expect(r!.notice).toContain("filters");
  });

  it("reuses the least recently used problem when the pool is exhausted", () => {
    // Every candidate is inside the cooldown: a repeat with a notice beats a
    // broken streak.
    const r = selectFallbackProblem({
      ...base,
      candidates: [p("newer"), p("oldest"), p("middle")],
      pastPicks: [
        past("newer", daysAgo(2)),
        past("middle", daysAgo(10)),
        past("oldest", daysAgo(25)),
      ],
    });
    expect(r!.problem.slug).toBe("oldest");
    expect(r!.source).toBe("auto_fallback_exhausted");
    expect(r!.notice).toContain("Widen");
  });

  it("returns null only when there is genuinely nothing to pick", () => {
    expect(
      selectFallbackProblem({ ...base, candidates: [], pastPicks: [] }),
    ).toBeNull();
    expect(
      selectFallbackProblem({
        ...base,
        candidates: [p("locked", { paidOnly: true })],
        pastPicks: [],
      }),
    ).toBeNull();
  });
});

describe("curatorForRound", () => {
  it("rotates in a stable order", () => {
    const order = ["a", "b", "c"];
    expect(curatorForRound({ curatorOrder: order, roundIndex: 0 })).toBe("a");
    expect(curatorForRound({ curatorOrder: order, roundIndex: 1 })).toBe("b");
    expect(curatorForRound({ curatorOrder: order, roundIndex: 3 })).toBe("a");
  });

  it("handles an empty room", () => {
    expect(curatorForRound({ curatorOrder: [], roundIndex: 4 })).toBeNull();
  });
});

describe("selectFallbackSet", () => {
  it("picks the requested number of distinct problems", () => {
    const r = selectFallbackSet({
      ...base,
      candidates: [p("a"), p("b"), p("c"), p("d")],
      pastPicks: [],
      count: 3,
    });
    expect(r!.problems).toHaveLength(3);
    expect(new Set(r!.problems.map((x) => x.slug)).size).toBe(3);
  });

  it("never repeats a problem within one set", () => {
    // The cooldown cannot catch this: the other picks are not past rounds yet.
    const r = selectFallbackSet({
      ...base,
      candidates: [p("only-one")],
      pastPicks: [],
      count: 3,
    });
    expect(r!.problems.map((x) => x.slug)).toEqual(["only-one"]);
  });

  it("returns a short set rather than nothing when the pool runs dry", () => {
    // A smaller set still keeps the day alive, which matters more to a habit
    // than hitting the exact set size.
    const r = selectFallbackSet({
      ...base,
      candidates: [p("a"), p("b")],
      pastPicks: [],
      count: 5,
    });
    expect(r!.problems).toHaveLength(2);
  });

  it("still honours the cooldown across the whole set", () => {
    const r = selectFallbackSet({
      ...base,
      candidates: [p("recent"), p("fresh1"), p("fresh2")],
      pastPicks: [past("recent", daysAgo(3))],
      count: 2,
    });
    expect(r!.problems.map((x) => x.slug)).not.toContain("recent");
  });

  it("reports the most severe source when the pool is exhausted", () => {
    const r = selectFallbackSet({
      ...base,
      candidates: [p("used")],
      pastPicks: [past("used", daysAgo(1))],
      count: 1,
    });
    expect(r!.source).toBe("auto_fallback_exhausted");
    expect(r!.notice).toContain("Widen");
  });

  it("returns null only when there is nothing at all", () => {
    expect(selectFallbackSet({ ...base, candidates: [], pastPicks: [], count: 3 })).toBeNull();
  });
});
