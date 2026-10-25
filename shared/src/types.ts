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

export interface Round {
  id: string;
  roomId: string;
  /** YYYY-MM-DD in the room's timezone. The room's day boundary, not UTC's. */
  roundDate: string;
  curatorId: string | null;
  problemSlug: string | null;
  problemTitle: string | null;
  difficulty: Difficulty | null;
  /** Snapshot, so repeat/topic checks stay correct if the catalog is refreshed. */
  topicTags: string[];
  selectionSource: SelectionSource | null;
  windowStart: number;
  windowEnd: number;
  acknowledged: WarningCode[];
}

export interface Solve {
  roundId: string;
  userId: string;
  solvedAt: number;
  points: number;
  /** 1 = first to solve this round. Drives the first-solver bonus. */
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
  /** Rounds solved out of the last 7. */
  solvedOfLast7: number;
  solvedToday: boolean;
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
  slug: string;
  /** Warning codes the curator has explicitly confirmed. Omission is not consent. */
  acknowledge?: WarningCode[];
}

export type PickResponse =
  | { ok: true; round: Round }
  /** Rejected. `verdict` explains why and what to acknowledge. */
  | { ok: false; verdict: PickVerdict };

export interface VerifyNowResponse {
  solved: boolean;
  solve: Solve | null;
  /** True when LeetCode's API failed, so a negative result is inconclusive. */
  degraded: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
}
