/** Points per difficulty. Rewards stretching rather than speed. */
export const DIFFICULTY_POINTS = { Easy: 1, Medium: 3, Hard: 5 } as const;

/**
 * Bonus for being first to solve a round. Deliberately tiny: this is a daily
 * practice group with "a little bit of competitiveness", not a race, so being
 * first should be a nudge rather than something worth optimising for.
 */
export const FIRST_SOLVER_BONUS = 1;

/** Room defaults. All are per-room settings so they can be tuned without a deploy. */
export const ROOM_DEFAULTS = {
  /** Exact repeats are blocked outright inside this window. */
  repeatCooldownDays: 30,
  /** How many recent rounds the topic/difficulty warnings look back over. */
  topicWarnWindow: 7,
  /** Shared-tag count within that window that triggers the topic warning. */
  topicWarnThreshold: 3,
  /** Consecutive same-difficulty rounds that trigger the difficulty warning. */
  difficultyRunThreshold: 3,
  /** Local time by which the curator must pick, else the fallback picker runs. */
  pickDeadlineLocal: "20:00",
  timezone: "UTC",
  mode: "daily",
  problemsPerRound: 1,
  timeTrialMinutes: 90,
} as const;

/** Guard rails for room settings, enforced server-side. */
export const LIMITS = {
  minProblemsPerRound: 1,
  /** Enough for a themed set without turning a daily habit into a chore. */
  maxProblemsPerRound: 5,
  minTimeTrialMinutes: 15,
  maxTimeTrialMinutes: 360,
} as const;

/**
 * Room codes avoid 0/O/1/I/L so they survive being read aloud or typed from a
 * screenshot, which is how friends will actually share them.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

/** LeetCode caps this feed at ~20 entries; see docs/verification notes. */
export const RECENT_AC_LIMIT = 20;

/** Workers Free allows 50 subrequests per invocation. Stay clear of the ceiling. */
export const MAX_CHECKS_PER_CRON_RUN = 40;

/**
 * Quick topic filters for the picker, ordered by how many free problems carry
 * each tag in LeetCode's catalog, so the first row is the one people reach for.
 * Counts were measured against the live catalog (3,308 non-premium problems)
 * rather than guessed.
 */
export const QUICK_TOPICS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "array", label: "Arrays" },
  { slug: "string", label: "Strings" },
  { slug: "hash-table", label: "Hash Table" },
  { slug: "dynamic-programming", label: "DP" },
  { slug: "math", label: "Math" },
  { slug: "sorting", label: "Sorting" },
  { slug: "greedy", label: "Greedy" },
  { slug: "binary-search", label: "Binary Search" },
  { slug: "two-pointers", label: "Two Pointers" },
  { slug: "sliding-window", label: "Sliding Window" },
  { slug: "tree", label: "Trees" },
  { slug: "graph", label: "Graphs" },
  { slug: "depth-first-search", label: "DFS" },
  { slug: "breadth-first-search", label: "BFS" },
  { slug: "stack", label: "Stack" },
  { slug: "heap-priority-queue", label: "Heap" },
  { slug: "matrix", label: "Matrix" },
  { slug: "bit-manipulation", label: "Bit Manipulation" },
  { slug: "prefix-sum", label: "Prefix Sum" },
  { slug: "linked-list", label: "Linked List" },
  { slug: "backtracking", label: "Backtracking" },
  { slug: "design", label: "Design" },
];
