/**
 * Contract test for LeetCode's undocumented GraphQL API.
 *
 * Every query the Worker depends on lives here. Schema introspection is
 * disabled on their endpoint (`__type` returns "Query unavailable"), so field
 * and filter names can only be validated empirically — which makes this the
 * early-warning system for "LeetCode changed something".
 *
 * Run: npm run check:api
 * Exits non-zero on the first contract break, so it works as a CI gate.
 */

const ENDPOINT = "https://leetcode.com/graphql";

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://leetcode.com/",
};

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as GqlResponse<T>;
}

let failures = 0;

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name}\n        ${(err as Error).message}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

console.log("LeetCode GraphQL contract check\n");

// ---------------------------------------------------------------------------

await check("activeDailyCodingChallengeQuestion", async () => {
  const r = await gql<{
    activeDailyCodingChallengeQuestion: {
      date: string;
      question: { titleSlug: string; title: string; difficulty: string };
    } | null;
  }>(`query { activeDailyCodingChallengeQuestion {
        date link question { questionFrontendId title titleSlug difficulty } } }`);

  assert(!r.errors, `errors: ${JSON.stringify(r.errors)}`);
  const d = r.data?.activeDailyCodingChallengeQuestion;
  assert(d, "no daily challenge returned");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(d.date), `unexpected date: ${d.date}`);
  assert(d.question.titleSlug, "missing titleSlug");
  return `${d.date} ${d.question.titleSlug}`;
});

await check("questionList + difficulty/tags filters", async () => {
  const r = await gql<{
    questionList: {
      total: number;
      questions: Array<{
        questionFrontendId: string;
        titleSlug: string;
        difficulty: string;
        isPaidOnly: boolean;
        acRate: number;
        topicTags: Array<{ slug: string }>;
      }>;
    } | null;
  }>(
    `query p($categorySlug:String,$limit:Int,$skip:Int,$filters:QuestionListFilterInput){
       questionList(categorySlug:$categorySlug limit:$limit skip:$skip filters:$filters){
         total: totalNum
         questions: data {
           questionFrontendId title titleSlug difficulty isPaidOnly acRate
           topicTags { slug }
         } } }`,
    {
      categorySlug: "",
      limit: 3,
      skip: 0,
      filters: { difficulty: "MEDIUM", tags: ["dynamic-programming"] },
    },
  );

  assert(!r.errors, `errors: ${JSON.stringify(r.errors)}`);
  const list = r.data?.questionList;
  assert(list, "no questionList returned");
  assert(list.total > 0, "filters matched nothing — filter keys may have changed");
  assert(list.questions.length > 0, "empty page");

  const q = list.questions[0]!;
  assert(q.titleSlug, "missing titleSlug");
  assert(typeof q.isPaidOnly === "boolean", "isPaidOnly is not a boolean");
  assert(typeof q.acRate === "number", "acRate is not a number");
  assert(Array.isArray(q.topicTags), "topicTags is not an array");
  // The filter must actually be applied, not silently ignored.
  assert(
    q.difficulty === "Medium",
    `difficulty filter ignored: got ${q.difficulty}`,
  );
  assert(
    list.questions.every((x) => x.topicTags.some((t) => t.slug === "dynamic-programming")),
    "tags filter ignored",
  );
  return `${list.total} matches, first = ${q.titleSlug}`;
});

await check("questionList + status filter is accepted", async () => {
  // Unauthenticated this must return 0 (an anonymous user has solved nothing).
  // We only assert the filter key is still valid; the extension relies on it.
  const r = await gql<{ questionList: { total: number } | null }>(
    `query p($categorySlug:String,$limit:Int,$skip:Int,$filters:QuestionListFilterInput){
       questionList(categorySlug:$categorySlug limit:$limit skip:$skip filters:$filters){
         total: totalNum } }`,
    { categorySlug: "", limit: 1, skip: 0, filters: { status: "AC" } },
  );
  assert(!r.errors, `status filter rejected: ${JSON.stringify(r.errors)}`);
  assert(r.data?.questionList, "no questionList returned");
  return `accepted (anonymous total = ${r.data.questionList.total})`;
});

await check("matchedUser for a real profile", async () => {
  const r = await gql<{
    matchedUser: {
      username: string;
      submitStatsGlobal: {
        acSubmissionNum: Array<{ difficulty: string; count: number }>;
      } | null;
    } | null;
  }>(
    `query u($username:String!){ matchedUser(username:$username){
        username profile { realName userAvatar }
        submitStatsGlobal { acSubmissionNum { difficulty count } } } }`,
    { username: "neal_wu" },
  );

  assert(!r.errors, `errors: ${JSON.stringify(r.errors)}`);
  assert(r.data?.matchedUser?.username === "neal_wu", "profile not returned");
  const all = r.data.matchedUser.submitStatsGlobal?.acSubmissionNum.find(
    (d) => d.difficulty === "All",
  );
  assert(all, "no 'All' bucket in acSubmissionNum");
  return `neal_wu, ${all.count} solved`;
});

await check("matchedUser signals an unknown user via errors", async () => {
  // The Worker depends on this distinction: an unknown user comes back as a
  // GraphQL *error* plus a null field, not merely a null. Conflating it with a
  // transport failure would let a nonexistent handle be linked, because the
  // sensible response to a LeetCode outage is to fail open.
  const r = await gql<{ matchedUser: unknown }>(
    `query u($username:String!){ matchedUser(username:$username){ username } }`,
    { username: "definitely-not-a-real-user-zzz99" },
  );
  assert(r.errors?.length, "expected an error for an unknown user");
  assert(
    /does not exist|no such user|user not found/i.test(
      r.errors.map((e) => e.message).join("; "),
    ),
    `unrecognised not-found message: ${r.errors.map((e) => e.message).join("; ")}`,
  );
  return `"${r.errors[0]!.message}"`;
});

await check("recentAcSubmissionList shape", async () => {
  // The load-bearing query: it is what lets the server verify solves from
  // public data, with no credentials. Probe a few active users, since any one
  // of them may simply have no recent activity.
  const candidates = await gql<{
    globalRanking: { rankingNodes: Array<{ user: { username: string } }> } | null;
  }>(`query { globalRanking(page:1){ rankingNodes { user { username } } } }`);

  const usernames =
    candidates.data?.globalRanking?.rankingNodes
      ?.slice(0, 8)
      .map((n) => n.user.username) ?? [];
  assert(usernames.length > 0, "could not fetch candidate usernames");

  for (const username of usernames) {
    const r = await gql<{
      recentAcSubmissionList: Array<{
        id: string;
        titleSlug: string;
        timestamp: string;
      }> | null;
    }>(
      `query r($username:String!,$limit:Int){
         recentAcSubmissionList(username:$username limit:$limit){
           id title titleSlug timestamp } }`,
      { username, limit: 5 },
    );

    assert(!r.errors, `errors for ${username}: ${JSON.stringify(r.errors)}`);
    assert(
      r.data && Array.isArray(r.data.recentAcSubmissionList),
      `recentAcSubmissionList missing for ${username}`,
    );

    const list = r.data.recentAcSubmissionList!;
    if (list.length === 0) continue; // inactive user; try the next

    const s = list[0]!;
    assert(typeof s.titleSlug === "string" && s.titleSlug, "missing titleSlug");
    // Timestamps come back as strings and are coerced in the client.
    assert(
      Number.isFinite(Number(s.timestamp)) && Number(s.timestamp) > 1_000_000_000,
      `implausible timestamp: ${s.timestamp}`,
    );
    return `${username}: ${list.length} entries, newest = ${s.titleSlug}`;
  }

  throw new Error(
    "no probed user had recent accepted submissions — inconclusive, re-run later",
  );
});

// ---------------------------------------------------------------------------

console.log();
if (failures > 0) {
  console.error(
    `${failures} contract check(s) failed. The Worker's LeetCode queries likely need updating;\n` +
      `solve verification degrades to self-reported until they are fixed.`,
  );
  process.exit(1);
}
console.log("All LeetCode API contracts hold.");
