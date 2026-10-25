/**
 * LeetCode handle detection, shared by the content script and the explicit
 * "Detect now" button.
 *
 * Written as a single self-contained function with no imports, because it is
 * also injected verbatim via chrome.scripting.executeScript, which serialises
 * the function body and cannot carry module bindings with it.
 */

export interface DetectResult {
  ok: boolean;
  username: string | null;
  /** Human-readable reason, shown in the options page when detection fails. */
  reason: string;
}

export function detectHandle(): Promise<DetectResult> {
  // `credentials: "include"` rather than "same-origin": in a content script's
  // isolated world the environment's origin is the extension's, so
  // "same-origin" can drop the leetcode.com session cookie and the query then
  // reports a signed-in user as anonymous. "include" is unambiguous.
  const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];

  return fetch("https://leetcode.com/graphql", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      // LeetCode's own frontend sends this. Harmless when unused.
      ...(csrf ? { "x-csrftoken": csrf } : {}),
    },
    body: JSON.stringify({
      query: "query { userStatus { userId username isSignedIn } }",
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        return {
          ok: false,
          username: null,
          reason: `LeetCode returned HTTP ${res.status} for the sign-in check.`,
        };
      }
      const body = await res.json();
      const status = body?.data?.userStatus;

      if (!status) {
        return {
          ok: false,
          username: null,
          reason: "LeetCode did not return a sign-in status (their API may have changed).",
        };
      }
      if (!status.isSignedIn || !status.username) {
        return {
          ok: false,
          username: null,
          reason:
            "LeetCode reports you are not signed in on this page. Sign in at leetcode.com, then try again.",
        };
      }
      return { ok: true, username: status.username as string, reason: "Signed in." };
    })
    .catch((err) => ({
      ok: false,
      username: null,
      reason: `Could not reach LeetCode from the page: ${String(err)}`,
    }));
}
