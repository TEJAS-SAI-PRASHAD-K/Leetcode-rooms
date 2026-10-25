import type { Difficulty, Problem } from "@lcr/shared";
import { RECENT_AC_LIMIT } from "@lcr/shared";

const ENDPOINT = "https://leetcode.com/graphql";

/**
 * LeetCode's GraphQL endpoint is undocumented and schema introspection is
 * disabled (`__type` returns "Query unavailable"), so every query here was
 * validated empirically against the live endpoint. scripts/check-leetcode-api.ts
 * re-checks them; treat a failure there as "LeetCode changed something".
 *
 * Browser-ish headers matter: bare requests get dropped by their edge proxy.
 */
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://leetcode.com/",
};

export class LeetCodeError extends Error {}

/**
 * The user genuinely does not exist, as opposed to LeetCode being unreachable.
 *
 * Worth its own type because LeetCode reports an unknown user as a GraphQL
 * *error* ("That user does not exist.") alongside a null field, rather than
 * just a null. Collapsing that into a generic failure would make "no such
 * handle" indistinguishable from "LeetCode is down" — and since the sensible
 * response to an outage is to proceed, that would let anyone link a handle
 * that does not exist.
 */
export class LeetCodeNotFoundError extends LeetCodeError {}

const NOT_FOUND_PATTERN = /does not exist|no such user|user not found/i;

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new LeetCodeError(`LeetCode returned HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (body.errors?.length) {
    const message = body.errors.map((e) => e.message).join("; ");
    throw NOT_FOUND_PATTERN.test(message)
      ? new LeetCodeNotFoundError(message)
      : new LeetCodeError(message);
  }
  if (!body.data) {
    throw new LeetCodeError("LeetCode returned no data");
  }
  return body.data;
}

// ---------------------------------------------------------------------------
// Solve verification — the load-bearing query.
//
// Returns a user's recent accepted submissions with no credentials at all,
// which is what lets the server be the authority on scoring instead of trusting
// the extension. Capped at ~20 entries by LeetCode, so a user grinding many
// problems can push a target off their feed between polls; the 10-minute cron
// plus the post-submit fast path covers that.
// ---------------------------------------------------------------------------

export interface RecentAc {
  titleSlug: string;
  timestamp: number;
}

const RECENT_AC_QUERY = `
  query recentAc($username: String!, $limit: Int) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      titleSlug
      timestamp
    }
  }`;

export async function fetchRecentAccepted(
  username: string,
  limit: number = RECENT_AC_LIMIT,
): Promise<RecentAc[]> {
  const data = await gql<{
    recentAcSubmissionList: Array<{ titleSlug: string; timestamp: string }> | null;
  }>(RECENT_AC_QUERY, { username, limit });

  // An empty list means "no recent activity", not "blocked" — verified by
  // cross-checking inactive users against their (also empty) activity calendars.
  return (data.recentAcSubmissionList ?? []).map((s) => ({
    titleSlug: s.titleSlug,
    timestamp: Number(s.timestamp),
  }));
}

/**
 * Did `username` accept `slug` inside [windowStart, windowEnd]?
 * Returns the submission timestamp so solve ordering uses LeetCode's clock,
 * not ours.
 */
export async function findSolveInWindow(
  username: string,
  slug: string,
  windowStart: number,
  windowEnd: number,
): Promise<number | null> {
  const recent = await fetchRecentAccepted(username);
  const hit = recent.find(
    (s) =>
      s.titleSlug === slug &&
      s.timestamp >= windowStart &&
      s.timestamp <= windowEnd,
  );
  return hit ? hit.timestamp : null;
}

// ---------------------------------------------------------------------------
// Handle existence
// ---------------------------------------------------------------------------

const MATCHED_USER_QUERY = `
  query matchedUser($username: String!) {
    matchedUser(username: $username) {
      username
      profile { realName userAvatar }
      submitStatsGlobal { acSubmissionNum { difficulty count } }
    }
  }`;

export interface LeetCodeProfile {
  username: string;
  realName: string | null;
  avatar: string | null;
  totalSolved: number;
}

/** Returns null when no such profile exists; throws only on a real failure. */
export async function fetchProfile(
  username: string,
): Promise<LeetCodeProfile | null> {
  let data: {
    matchedUser: {
      username: string;
      profile: { realName: string | null; userAvatar: string | null } | null;
      submitStatsGlobal: {
        acSubmissionNum: Array<{ difficulty: string; count: number }>;
      } | null;
    } | null;
  };

  try {
    data = await gql<typeof data>(MATCHED_USER_QUERY, { username });
  } catch (err) {
    // A definitive "no such user" is an answer, not a failure.
    if (err instanceof LeetCodeNotFoundError) return null;
    throw err;
  }

  const u = data.matchedUser;
  if (!u) return null;

  const all = u.submitStatsGlobal?.acSubmissionNum.find(
    (d) => d.difficulty === "All",
  );
  return {
    username: u.username,
    realName: u.profile?.realName ?? null,
    avatar: u.profile?.userAvatar ?? null,
    totalSolved: all?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Problem catalog
//
// Note the field is `questionList`, aliased to problemsetQuestionList in most
// community examples. Filter keys confirmed working: difficulty, tags, status.
// ---------------------------------------------------------------------------

const PROBLEM_LIST_QUERY = `
  query problemList(
    $categorySlug: String
    $limit: Int
    $skip: Int
    $filters: QuestionListFilterInput
  ) {
    questionList(
      categorySlug: $categorySlug
      limit: $limit
      skip: $skip
      filters: $filters
    ) {
      total: totalNum
      questions: data {
        questionFrontendId
        title
        titleSlug
        difficulty
        isPaidOnly
        acRate
        topicTags { slug }
      }
    }
  }`;

export interface ProblemPage {
  total: number;
  problems: Problem[];
}

export async function fetchProblemPage(opts: {
  limit?: number;
  skip?: number;
  difficulty?: Difficulty;
  tags?: string[];
}): Promise<ProblemPage> {
  const filters: Record<string, unknown> = {};
  if (opts.difficulty) filters["difficulty"] = opts.difficulty.toUpperCase();
  if (opts.tags?.length) filters["tags"] = opts.tags;

  const data = await gql<{
    questionList: {
      total: number;
      questions: Array<{
        questionFrontendId: string;
        title: string;
        titleSlug: string;
        difficulty: string;
        isPaidOnly: boolean;
        acRate: number;
        topicTags: Array<{ slug: string }>;
      }> | null;
    } | null;
  }>(PROBLEM_LIST_QUERY, {
    categorySlug: "",
    limit: opts.limit ?? 100,
    skip: opts.skip ?? 0,
    filters,
  });

  const list = data.questionList;
  return {
    total: list?.total ?? 0,
    problems: (list?.questions ?? []).map((q) => ({
      slug: q.titleSlug,
      frontendId: q.questionFrontendId,
      title: q.title,
      difficulty: q.difficulty as Difficulty,
      paidOnly: q.isPaidOnly,
      acRate: q.acRate,
      topicTags: q.topicTags.map((t) => t.slug),
    })),
  };
}

// ---------------------------------------------------------------------------
// Official daily — not used by the curator flow, but kept for the optional
// "official daily" selection mode and handy as a cheap liveness probe.
// ---------------------------------------------------------------------------

const DAILY_QUERY = `
  query daily {
    activeDailyCodingChallengeQuestion {
      date
      link
      question { questionFrontendId title titleSlug difficulty }
    }
  }`;

export async function fetchDailyChallenge(): Promise<{
  date: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
} | null> {
  const data = await gql<{
    activeDailyCodingChallengeQuestion: {
      date: string;
      question: {
        title: string;
        titleSlug: string;
        difficulty: string;
      };
    } | null;
  }>(DAILY_QUERY);

  const d = data.activeDailyCodingChallengeQuestion;
  if (!d) return null;
  return {
    date: d.date,
    slug: d.question.titleSlug,
    title: d.question.title,
    difficulty: d.question.difficulty as Difficulty,
  };
}
