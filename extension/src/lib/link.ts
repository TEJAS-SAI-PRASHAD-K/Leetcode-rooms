import { api, ApiError } from "./api.js";
import { detectHandle, type DetectResult } from "./detect.js";
import { readStore, writeStore } from "./storage.js";

export interface LinkOutcome {
  ok: boolean;
  linked?: string;
  /** This install took over an existing account rather than linking a new one. */
  reclaimed?: boolean;
  error?: string;
}

/**
 * Record a detection outcome and, if it found a handle, link it.
 *
 * Every outcome is written to storage — including failures — so the options
 * page can explain why linking did not happen instead of just showing
 * "not linked".
 */
export async function applyDetection(
  result: DetectResult,
  opts: { recheckDays?: number } = {},
): Promise<LinkOutcome> {
  const recheckDays = opts.recheckDays ?? 7;

  await writeStore({
    lastDetect: {
      at: Date.now(),
      ok: result.ok,
      reason: result.reason,
      username: result.username,
    },
  });

  if (!result.ok || !result.username) {
    return { ok: false, error: result.reason };
  }

  const username = result.username;
  const store = await readStore();
  const fresh =
    store.leetcodeUsername === username &&
    store.handleCheckedAt &&
    Date.now() - store.handleCheckedAt < recheckDays * 86_400_000;

  if (fresh) return { ok: true, linked: username };

  try {
    const res = await api.linkHandle(username);

    if (res.reclaimed) {
      /*
       * This install took over an account that already held the handle — a
       * reinstall getting its rooms back. The bearer token now belongs to that
       * account, so the stored user id has to follow it, otherwise "is this me"
       * checks on the leaderboard would silently stop matching.
       *
       * activeRoomId is cleared so the popup re-picks from the rooms the
       * reclaimed account is actually in, rather than a stale id from before.
       */
      const current = await readStore();
      await writeStore({
        identity: current.identity
          ? { ...current.identity, userId: res.userId }
          : current.identity,
        activeRoomId: undefined,
        leetcodeUsername: username,
        handleCheckedAt: Date.now(),
      });
      return { ok: true, linked: username, reclaimed: true };
    }

    await writeStore({ leetcodeUsername: username, handleCheckedAt: Date.now() });
    return { ok: true, linked: username };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : (err as Error).message;
    // Distinguish "the server refused this handle" from "not signed in" —
    // very different problems with very different fixes.
    await writeStore({
      lastDetect: { at: Date.now(), ok: false, reason: message, username },
    });
    return { ok: false, error: message };
  }
}

/**
 * Find or open a leetcode.com tab and run the sign-in check inside it.
 *
 * Runs in the page's MAIN world, where cookie and origin semantics are
 * unambiguous, unlike a content script's isolated world.
 *
 * Callable from any extension page that has the `scripting` permission. The
 * options page calls it directly rather than messaging the service worker,
 * which removes a whole class of MV3 lifecycle problems — a suspended or stale
 * worker can otherwise swallow or misanswer the request.
 */
export async function detectAndLink(): Promise<LinkOutcome> {
  let tab = (await chrome.tabs.query({ url: "https://leetcode.com/*" }))[0];

  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: "https://leetcode.com/", active: false });
    await new Promise<void>((resolve) => {
      const done = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tab!.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }, 15_000);
    });
  }

  if (!tab?.id) return { ok: false, error: "Could not open a leetcode.com tab." };

  let result: DetectResult | undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: detectHandle,
    });
    result = injection?.result as DetectResult | undefined;
  } catch (err) {
    return {
      ok: false,
      error: `Could not run the check on leetcode.com: ${(err as Error).message}`,
    };
  }

  if (!result) return { ok: false, error: "The sign-in check returned nothing." };
  return applyDetection(result);
}
