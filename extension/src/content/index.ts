/**
 * Content script on leetcode.com. Two jobs:
 *
 *  1. Detect the signed-in username and hand it to the service worker. The
 *     request is same-origin to leetcode.com, so the session cookie applies and
 *     there is no CORS problem. Because `userStatus` only names a user when the
 *     browser is genuinely signed in as them, this doubles as the ownership
 *     proof for linking a handle.
 *
 *  2. After a submission, ask the server to re-check. We never assert the solve
 *     ourselves — the extension only prompts a verification and the Worker
 *     confirms it against LeetCode's public feed, which keeps scoring
 *     authoritative even though this file is user-modifiable.
 *
 * Every outcome, including failure, is reported so the options page can explain
 * what went wrong instead of silently showing "not linked".
 */
import { detectHandle } from "../lib/detect.js";

async function reportHandle() {
  const result = await detectHandle();
  await chrome.runtime
    .sendMessage({ type: "handle:detected", result })
    .catch(() => {
      // Service worker asleep or reloading; the next page load retries.
    });
}

/** The problem slug for this page, or null if it is not a problem page. */
function currentSlug(): string | null {
  const m = window.location.pathname.match(/^\/problems\/([^/]+)/);
  return m ? m[1]! : null;
}

/**
 * Notice submissions and nudge the server afterwards.
 *
 * Deliberately not DOM-scraping the "Accepted" banner, which LeetCode restyles
 * often. We only detect that a submit happened and let the server decide.
 */
function watchForSubmissions(slug: string) {
  let lastNudge = 0;

  const nudge = () => {
    const now = Date.now();
    if (now - lastNudge < 10_000) return; // one submit fires several requests
    lastNudge = now;

    // Give LeetCode time to finish judging before asking the server to look.
    setTimeout(() => {
      void chrome.runtime
        .sendMessage({ type: "submission:detected", slug })
        .catch(() => {});
    }, 6000);
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url =
      typeof args[0] === "string" ? args[0] : ((args[0] as Request)?.url ?? "");
    if (/\/submit\/?$|\/submissions\/detail\/|interpret_solution/.test(url)) {
      nudge();
    }
    return origFetch.apply(this, args);
  };

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") nudge();
  });
}

void reportHandle();

// LeetCode is a single-page app, so a later sign-in never reloads the page.
// Re-check on navigation so linking does not require a manual refresh.
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    void reportHandle();
  }
}, 3000);

const slug = currentSlug();
if (slug) watchForSubmissions(slug);
