import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProfile,
  fetchRecentAccepted,
  findSolveInWindow,
  LeetCodeError,
  LeetCodeNotFoundError,
} from "../src/leetcode.js";

/** Stub the single fetch the client makes. */
function stubFetch(body: unknown, init: { status?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchProfile", () => {
  it("returns a profile for a real user", async () => {
    stubFetch({
      data: {
        matchedUser: {
          username: "someone",
          profile: { realName: "Some One", userAvatar: "http://a/b.png" },
          submitStatsGlobal: {
            acSubmissionNum: [
              { difficulty: "All", count: 253 },
              { difficulty: "Easy", count: 60 },
            ],
          },
        },
      },
    });

    const p = await fetchProfile("someone");
    expect(p).toMatchObject({ username: "someone", totalSolved: 253 });
  });

  it("returns null for a user that does not exist", async () => {
    // This is the exact shape LeetCode returns: a GraphQL error *plus* a null
    // field. Treating it as a generic failure previously let a nonexistent
    // handle be linked, because an outage is meant to fail open.
    stubFetch({
      errors: [{ message: "That user does not exist." }],
      data: { matchedUser: null },
    });

    await expect(fetchProfile("definitely-not-real-zzz")).resolves.toBeNull();
  });

  it("still throws when LeetCode is genuinely broken", async () => {
    stubFetch({ errors: [{ message: "Internal server error" }], data: null });
    await expect(fetchProfile("someone")).rejects.toBeInstanceOf(LeetCodeError);
    await expect(fetchProfile("someone")).rejects.not.toBeInstanceOf(
      LeetCodeNotFoundError,
    );
  });

  it("throws on a transport failure", async () => {
    stubFetch({}, { status: 503 });
    await expect(fetchProfile("someone")).rejects.toBeInstanceOf(LeetCodeError);
  });
});

describe("fetchRecentAccepted", () => {
  it("coerces LeetCode's string timestamps to numbers", async () => {
    stubFetch({
      data: {
        recentAcSubmissionList: [
          { id: "1", titleSlug: "two-sum", timestamp: "1787289798" },
        ],
      },
    });
    const list = await fetchRecentAccepted("someone");
    expect(list).toEqual([{ titleSlug: "two-sum", timestamp: 1787289798 }]);
  });

  it("treats an empty feed as no activity, not an error", async () => {
    stubFetch({ data: { recentAcSubmissionList: [] } });
    await expect(fetchRecentAccepted("someone")).resolves.toEqual([]);
  });

  it("tolerates a null feed", async () => {
    stubFetch({ data: { recentAcSubmissionList: null } });
    await expect(fetchRecentAccepted("someone")).resolves.toEqual([]);
  });
});

describe("findSolveInWindow", () => {
  const feed = (slug: string, ts: number) => ({
    data: { recentAcSubmissionList: [{ id: "1", titleSlug: slug, timestamp: String(ts) }] },
  });

  it("returns LeetCode's timestamp for a solve inside the window", async () => {
    stubFetch(feed("two-sum", 1500));
    await expect(findSolveInWindow("u", "two-sum", 1000, 2000)).resolves.toBe(1500);
  });

  it("ignores a solve of the right problem outside the window", async () => {
    // A solve from before the round opened must not count.
    stubFetch(feed("two-sum", 999));
    await expect(findSolveInWindow("u", "two-sum", 1000, 2000)).resolves.toBeNull();
  });

  it("includes the window boundaries", async () => {
    stubFetch(feed("two-sum", 1000));
    await expect(findSolveInWindow("u", "two-sum", 1000, 2000)).resolves.toBe(1000);
    stubFetch(feed("two-sum", 2000));
    await expect(findSolveInWindow("u", "two-sum", 1000, 2000)).resolves.toBe(2000);
  });

  it("ignores a different problem solved in the window", async () => {
    stubFetch(feed("other-problem", 1500));
    await expect(findSolveInWindow("u", "two-sum", 1000, 2000)).resolves.toBeNull();
  });
});
