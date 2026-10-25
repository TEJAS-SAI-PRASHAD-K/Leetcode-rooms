// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export type Difficulty = "Easy" | "Medium" | "Hard";

export type SelectionSource =
  | "curator"
  /** Curator missed the pick deadline; the fallback picker chose. */
  | "auto_fallback"
  /** Fallback ran out of legal problems and reused the least-recently-used one. */
  | "auto_fallback_exhausted";

export type SolveSource =
  /** Confirmed against LeetCode's public submission feed. Authoritative. */
  | "verified_poll"
  /** Recorded without verification, used only if the LeetCode API is degraded. */
  | "self_reported";

export type MemberRole = "owner" | "member";

/**
 * How a round's problem set is scored.
 *
 * "daily"      — solve the set any time during the room's local day. A day
 *                counts toward your streak once you have solved every problem
 *                in it, which is what makes a multi-problem set a daily goal
 *                rather than a pile of optional extras.
 * "time_trial" — the set opens when it is picked and closes after
 *                timeTrialMinutes. Solves outside that window do not count, and
 *                members are ranked by how many they finished and how fast.
 */
export type RoomMode = "daily" | "time_trial";

export interface Problem {
  slug: string;
  frontendId: string;
  title: string;
  difficulty: Difficulty;
  paidOnly: boolean;
  acRate: number;
  topicTags: string[];
}

export interface RoomSettings {
  mode: RoomMode;
  /** How many problems the curator picks for each round. */
  problemsPerRound: number;
  /** Length of the window in time_trial mode. Ignored in daily mode. */
  timeTrialMinutes: number;
  repeatCooldownDays: number;
  topicWarnWindow: number;
  topicWarnThreshold: number;
  difficultyRunThreshold: number;
  pickDeadlineLocal: string;
  timezone: string;
  /** Candidate pool for the fallback picker. Empty array means "no restriction". */
  difficultyFilter: Difficulty[];
  topicFilter: string[];
}

export interface Room extends RoomSettings {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  /** User ids in rotation order; the curator for a round is derived from this. */
  curatorOrder: string[];
  createdAt: number;
}

export interface Member {
  userId: string;
  leetcodeUsername: string;
  displayName: string;
  role: MemberRole;
  verifiedAt: number | null;
  joinedAt: number;
}

/** One problem within a round's set. */
export interface RoundProblem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** Snapshot, so repeat/topic checks stay correct if the catalog is refreshed. */
  topicTags: string[];
  position: number;
}

export interface Round {
  id: string;
  roomId: string;
  /** YYYY-MM-DD in the room's timezone. The room's day boundary, not UTC's. */
  roundDate: string;
  curatorId: string | null;
  /** Empty until the set is picked. */
  problems: RoundProblem[];
  selectionSource: SelectionSource | null;
  windowStart: number;
  windowEnd: number;
  acknowledged: WarningCode[];
}

export interface Solve {
  roundId: string;
  userId: string;
  slug: string;
  solvedAt: number;
  points: number;
  /** Order among solvers of this problem; 1 earns the first-solver bonus. */
  solveOrder: number;
  source: SolveSource;
}

// ---------------------------------------------------------------------------
// Repeat prevention
// ---------------------------------------------------------------------------

export type WarningCode =
  /** Used before, but outside the cooldown. Overridable; must be acknowledged. */
  | "repeat_old"
  | "topic_concentration"
  | "difficulty_run"
  | "curator_difficulty_pattern"
  | "curator_topic_pattern";

export type BlockCode = "repeat_recent" | "paid_only" | "not_your_turn";

export interface PickBlock {
  code: BlockCode;
  message: string;
  lastUsedDate?: string;
  lastUsedBy?: string;
  daysAgo?: number;
  /** Days until the cooldown lapses and the problem becomes a Revisit. */
  availableInDays?: number;
}

export interface PickWarning {
  code: WarningCode;
  message: string;
}

export interface PickVerdict {
  blocked: PickBlock | null;
  warnings: PickWarning[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  leetcodeUsername: string;
  /** Points inside the current week (resets Monday, room-local). */
  weeklyPoints: number;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  /** Rounds fully completed out of the last 7. */
  solvedOfLast7: number;
  /** Every problem in today's set solved. */
  completedToday: boolean;
  /** Problems solved in today's set. */
  solvedToday: number;
  /** Size of today's set, so the UI can show "2/3". */
  problemsToday: number;
  /**
   * Timestamp of the last solve that completed today's set, for time-trial
   * ranking. Null when the set is not finished.
   */
  finishedAt: number | null;
}

// ---------------------------------------------------------------------------
// API contract
// ---------------------------------------------------------------------------

export interface RegisterRequest {
  displayName?: string;
}
export interface RegisterResponse {
  userId: string;
  token: string;
}

export interface VerifyHandleRequest {
  /** Read from LeetCode's userStatus query by the content script. */
  leetcodeUsername: string;
}
export interface VerifyHandleResponse {
  leetcodeUsername: string;
  verifiedAt: number;
  /** False when the handle exists locally but LeetCode has no such profile. */
  profileExists: boolean;
}

export interface CreateRoomRequest {
  name: string;
  timezone?: string;
  settings?: Partial<RoomSettings>;
}

export interface JoinRoomRequest {
  code: string;
}

export interface RoomStateResponse {
  room: Room;
  members: Member[];
  today: Round | null;
  /** Whose turn it is to pick for `today`. */
  curator: Member | null;
  isMyTurn: boolean;
  /** Null until a problem is picked. */
  problem: Problem | null;
  solves: Solve[];
  leaderboard: LeaderboardEntry[];
  /** Seconds left in a time-trial round; null in daily mode or once closed. */
  timeTrialSecondsLeft: number | null;
  /** Set when the fallback picker had to reuse a problem; prompts widening filters. */
  poolExhaustedNotice: string | null;
}

export interface BrowseProblemsRequest {
  query?: string;
  difficulty?: Difficulty[];
  tags?: string[];
  limit?: number;
  cursor?: number;
}

/** A catalog entry annotated with this room's repeat verdict. */
export interface BrowseProblem extends Problem {
  verdict: PickVerdict;
}

export interface BrowseProblemsResponse {
  problems: BrowseProblem[];
  nextCursor: number | null;
}

export interface PickRequest {
  /** The full set for the round; length must equal the room's problemsPerRound. */
  slugs: string[];
  /** Warning codes the curator has explicitly confirmed. Omission is not consent. */
  acknowledge?: WarningCode[];
}

export type PickResponse =
  | { ok: true; round: Round }
  /** Rejected. `verdict` explains why and what to acknowledge. */
  | { ok: false; verdict: PickVerdict };

export interface VerifyNowResponse {
  /** Solves newly recorded by this check. */
  newSolves: Solve[];
  /** Every solve the caller has in today's set, new or already known. */
  solves: Solve[];
  completed: boolean;
  /** True when LeetCode's API failed, so a negative result is inconclusive. */
  degraded: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
}
