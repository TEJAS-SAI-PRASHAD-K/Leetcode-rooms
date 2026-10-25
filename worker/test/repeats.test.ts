import { describe, expect, it } from "vitest";
import { ROOM_DEFAULTS } from "@lcr/shared";
import type { Problem } from "@lcr/shared";
import {
  daysBetween,
  evaluatePick,
  humanizeTag,
  unacknowledgedWarnings,
  type PastRound,
} from "../src/repeats.js";

const SETTINGS = {
  repeatCooldownDays: ROOM_DEFAULTS.repeatCooldownDays, // 30
  topicWarnWindow: ROOM_DEFAULTS.topicWarnWindow, // 7
  topicWarnThreshold: ROOM_DEFAULTS.topicWarnThreshold, // 3
  difficultyRunThreshold: ROOM_DEFAULTS.difficultyRunThreshold, // 3
};

const TODAY = "2026-10-25";

function problem(over: Partial<Problem> = {}): Problem {
  return {
    slug: "two-sum",
    frontendId: "1",
    title: "Two Sum",
    difficulty: "Easy",
    paidOnly: false,
    acRate: 55,
    topicTags: ["array", "hash-table"],
    ...over,
  };
}

function round(over: Partial<PastRound> = {}): PastRound {
  return {
    roundDate: "2026-10-24",
    problemSlug: "valid-parentheses",
    problemTitle: "Valid Parentheses",
    difficulty: "Easy",
    topicTags: ["stack", "string"],
    curatorId: "u1",
    curatorName: "Sam",
    ...over,
  };
}

/** Room-local date N days before TODAY. */
function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("daysBetween", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-10-01", "2026-10-25")).toBe(24);
    expect(daysBetween("2026-10-25", "2026-10-25")).toBe(0);
  });

  it("crosses month and year boundaries", () => {
    expect(daysBetween("2026-12-25", "2027-01-01")).toBe(7);
  });
});

describe("humanizeTag", () => {
  it("renders slugs readably", () => {
    expect(humanizeTag("dynamic-programming")).toBe("Dynamic Programming");
    expect(humanizeTag("linked-list")).toBe("Linked List");
  });

  it("upper-cases short acronym-ish segments", () => {
    expect(humanizeTag("bit-manipulation")).toBe("Bit Manipulation");
    expect(humanizeTag("dp")).toBe("DP");
  });
});

describe("evaluatePick — exact repeat cooldown", () => {
  it("blocks a repeat inside the 30-day window", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem(),
      pastRounds: [round({ problemSlug: "two-sum", roundDate: daysAgo(12) })],
      today: TODAY,
    });

    expect(v.blocked).not.toBeNull();
    expect(v.blocked!.code).toBe("repeat_recent");
    expect(v.blocked!.daysAgo).toBe(12);
    expect(v.blocked!.availableInDays).toBe(18);
    // The message has to name the date and the person, or the block feels arbitrary.
    expect(v.blocked!.message).toContain("12 days ago");
    expect(v.blocked!.message).toContain("Sam");
    expect(v.blocked!.message).toContain("18 days");
  });

  it("blocks at the boundary (day 29) and warns just past it (day 31)", () => {
    const at29 = evaluatePick({
      settings: SETTINGS,
      candidate: problem(),
      pastRounds: [round({ problemSlug: "two-sum", roundDate: daysAgo(29) })],
      today: TODAY,
    });
    expect(at29.blocked?.code).toBe("repeat_recent");

    const at31 = evaluatePick({
      settings: SETTINGS,
      candidate: problem(),
      pastRounds: [round({ problemSlug: "two-sum", roundDate: daysAgo(31) })],
      today: TODAY,
    });
    expect(at31.blocked).toBeNull();
    expect(at31.warnings.map((w) => w.code)).toContain("repeat_old");
  });

  it("treats exactly 30 days as expired, matching the inclusive setting name", () => {
    const at30 = evaluatePick({
      settings: SETTINGS,
      candidate: problem(),
      pastRounds: [round({ problemSlug: "two-sum", roundDate: daysAgo(30) })],
      today: TODAY,
    });
    expect(at30.blocked).toBeNull();
    expect(at30.warnings.map((w) => w.code)).toContain("repeat_old");
  });

  it("uses the most recent prior use when a problem was used twice", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem(),
      pastRounds: [
        round({ problemSlug: "two-sum", roundDate: daysAgo(5), curatorName: "Ana" }),
        round({ problemSlug: "two-sum", roundDate: daysAgo(200), curatorName: "Old" }),
      ],
      today: TODAY,
    });
    expect(v.blocked!.daysAgo).toBe(5);
    expect(v.blocked!.lastUsedBy).toBe("Ana");
  });

  it("allows a problem the room has never used", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem(),
      pastRounds: [round(), round({ roundDate: daysAgo(2) })],
      today: TODAY,
    });
    expect(v.blocked).toBeNull();
    expect(v.warnings.map((w) => w.code)).not.toContain("repeat_old");
  });

  it("respects a room's custom cooldown", () => {
    const v = evaluatePick({
      settings: { ...SETTINGS, repeatCooldownDays: 7 },
      candidate: problem(),
      pastRounds: [round({ problemSlug: "two-sum", roundDate: daysAgo(10) })],
      today: TODAY,
    });
    expect(v.blocked).toBeNull();
  });
});

describe("evaluatePick — premium", () => {
  it("blocks Premium-only problems so nobody is locked out", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ paidOnly: true }),
      pastRounds: [],
      today: TODAY,
    });
    expect(v.blocked?.code).toBe("paid_only");
  });
});

describe("evaluatePick — topic concentration", () => {
  it("warns when a tag dominates the recent window", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", topicTags: ["array"] }),
      pastRounds: [
        round({ roundDate: daysAgo(1), problemSlug: "a", topicTags: ["array"] }),
        round({ roundDate: daysAgo(2), problemSlug: "b", topicTags: ["array"] }),
        round({ roundDate: daysAgo(3), problemSlug: "c", topicTags: ["array"] }),
      ],
      today: TODAY,
    });
    const w = v.warnings.find((w) => w.code === "topic_concentration");
    expect(w).toBeDefined();
    expect(w!.message).toContain("3 Array problems");
  });

  it("stays quiet below the threshold", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", topicTags: ["array"] }),
      pastRounds: [
        round({ roundDate: daysAgo(1), problemSlug: "a", topicTags: ["array"] }),
        round({ roundDate: daysAgo(2), problemSlug: "b", topicTags: ["stack"] }),
      ],
      today: TODAY,
    });
    expect(v.warnings.map((w) => w.code)).not.toContain("topic_concentration");
  });

  it("ignores rounds outside the lookback window", () => {
    const old = Array.from({ length: 4 }, (_, i) =>
      round({ roundDate: daysAgo(10 + i), problemSlug: `old${i}`, topicTags: ["array"] }),
    );
    const recent = Array.from({ length: 7 }, (_, i) =>
      round({ roundDate: daysAgo(1 + i), problemSlug: `new${i}`, topicTags: ["graph"] }),
    );
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", topicTags: ["array"] }),
      pastRounds: [...recent, ...old], // newest first; the 4 array rounds fall outside
      today: TODAY,
    });
    expect(v.warnings.map((w) => w.code)).not.toContain("topic_concentration");
  });
});

describe("evaluatePick — difficulty run", () => {
  it("warns on a run of the same difficulty", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", difficulty: "Easy" }),
      pastRounds: [
        round({ roundDate: daysAgo(1), problemSlug: "a", difficulty: "Easy" }),
        round({ roundDate: daysAgo(2), problemSlug: "b", difficulty: "Easy" }),
        round({ roundDate: daysAgo(3), problemSlug: "c", difficulty: "Easy" }),
      ],
      today: TODAY,
    });
    const w = v.warnings.find((w) => w.code === "difficulty_run");
    expect(w?.message).toContain("4 Easy problems in a row");
  });

  it("requires the run to be consecutive and most-recent", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", difficulty: "Easy" }),
      pastRounds: [
        round({ roundDate: daysAgo(1), problemSlug: "a", difficulty: "Hard" }),
        round({ roundDate: daysAgo(2), problemSlug: "b", difficulty: "Easy" }),
        round({ roundDate: daysAgo(3), problemSlug: "c", difficulty: "Easy" }),
        round({ roundDate: daysAgo(4), problemSlug: "d", difficulty: "Easy" }),
      ],
      today: TODAY,
    });
    expect(v.warnings.map((w) => w.code)).not.toContain("difficulty_run");
  });
});

describe("evaluatePick — per-curator patterns", () => {
  it("flags one curator defaulting to the same difficulty across their turns", () => {
    // Interleaved curators: the room-wide run is broken, but u1's own is not.
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", difficulty: "Easy" }),
      pastRounds: [
        round({ roundDate: daysAgo(1), problemSlug: "a", difficulty: "Hard", curatorId: "u2" }),
        round({ roundDate: daysAgo(2), problemSlug: "b", difficulty: "Easy", curatorId: "u1" }),
        round({ roundDate: daysAgo(3), problemSlug: "c", difficulty: "Hard", curatorId: "u2" }),
        round({ roundDate: daysAgo(4), problemSlug: "d", difficulty: "Easy", curatorId: "u1" }),
        round({ roundDate: daysAgo(5), problemSlug: "e", difficulty: "Hard", curatorId: "u2" }),
        round({ roundDate: daysAgo(6), problemSlug: "f", difficulty: "Easy", curatorId: "u1" }),
      ],
      today: TODAY,
      curatorId: "u1",
    });

    expect(v.warnings.map((w) => w.code)).not.toContain("difficulty_run");
    const w = v.warnings.find((w) => w.code === "curator_difficulty_pattern");
    expect(w?.message).toContain("last 3 turns");
  });

  it("does not flag a curator for other people's picks", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", difficulty: "Easy" }),
      pastRounds: [
        round({ roundDate: daysAgo(1), problemSlug: "a", difficulty: "Easy", curatorId: "u2" }),
        round({ roundDate: daysAgo(2), problemSlug: "b", difficulty: "Easy", curatorId: "u2" }),
        round({ roundDate: daysAgo(3), problemSlug: "c", difficulty: "Easy", curatorId: "u2" }),
      ],
      today: TODAY,
      curatorId: "u1",
    });
    expect(v.warnings.map((w) => w.code)).not.toContain("curator_difficulty_pattern");
  });
});

describe("unacknowledgedWarnings", () => {
  const oldRepeat = () =>
    evaluatePick({
      settings: SETTINGS,
      candidate: problem(),
      pastRounds: [round({ problemSlug: "two-sum", roundDate: daysAgo(200) })],
      today: TODAY,
    });

  it("requires an explicit acknowledgement for an old repeat", () => {
    expect(unacknowledgedWarnings(oldRepeat(), [])).toEqual(["repeat_old"]);
  });

  it("passes once acknowledged", () => {
    expect(unacknowledgedWarnings(oldRepeat(), ["repeat_old"])).toEqual([]);
  });

  it("fails closed: omitting the ack is not consent", () => {
    // An old client that does not know the code must not slip through.
    expect(unacknowledgedWarnings(oldRepeat(), undefined)).toEqual(["repeat_old"]);
  });

  it("does not demand acknowledgement for advisory nudges", () => {
    const v = evaluatePick({
      settings: SETTINGS,
      candidate: problem({ slug: "x", difficulty: "Easy" }),
      pastRounds: [
        round({ roundDate: daysAgo(1), problemSlug: "a", difficulty: "Easy" }),
        round({ roundDate: daysAgo(2), problemSlug: "b", difficulty: "Easy" }),
        round({ roundDate: daysAgo(3), problemSlug: "c", difficulty: "Easy" }),
      ],
      today: TODAY,
    });
    expect(v.warnings.length).toBeGreaterThan(0);
    expect(unacknowledgedWarnings(v, [])).toEqual([]);
  });
});
