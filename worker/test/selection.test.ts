import { describe, expect, it } from "vitest";
import type { Problem } from "@lcr/shared";
import { curatorForRound, selectFallbackProblem } from "../src/selection.js";
import type { PastRound } from "../src/repeats.js";

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

function past(slug: string, date: string): PastRound {
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
      pastRounds: [past("recent", daysAgo(5))],
    });
    expect(r!.problem.slug).toBe("fresh");
    expect(r!.source).toBe("auto_fallback");
    expect(r!.notice).toBeNull();
  });

  it("will reuse a problem once past the cooldown", () => {
    const r = selectFallbackProblem({
      ...base,
      candidates: [p("old")],
      pastRounds: [past("old", daysAgo(60))],
    });
    expect(r!.problem.slug).toBe("old");
    expect(r!.source).toBe("auto_fallback");
  });

  it("skips Premium problems", () => {
    const r = selectFallbackProblem({
      ...base,
      candidates: [p("locked", { paidOnly: true }), p("free")],
      pastRounds: [],
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
      pastRounds: [],
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
      pastRounds: [],
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
      pastRounds: [],
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
      pastRounds: [
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
      selectFallbackProblem({ ...base, candidates: [], pastRounds: [] }),
    ).toBeNull();
    expect(
      selectFallbackProblem({
        ...base,
        candidates: [p("locked", { paidOnly: true })],
        pastRounds: [],
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
