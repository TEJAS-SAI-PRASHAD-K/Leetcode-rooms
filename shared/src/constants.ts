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
