/**
 * Service worker: bridges the content script to the Worker, keeps the toolbar
 * badge current, and nudges people who have not solved yet.
 *
 * MV3 service workers are killed aggressively, so all state lives in
 * chrome.storage and every entry point re-reads it rather than caching.
 */
import { api } from "../lib/api.js";
import type { DetectResult } from "../lib/detect.js";
import { applyDetection, detectAndLink } from "../lib/link.js";
import { readStore, writeStore } from "../lib/storage.js";

const REFRESH_ALARM = "lcr:refresh";
const HANDLE_RECHECK_DAYS = 7;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 30 });
  void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refreshBadge();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void (async () => {
    try {
      if (msg?.type === "handle:detected") {
        sendResponse(await onHandleDetected(msg.result as DetectResult));
        return;
      }
      if (msg?.type === "handle:detectNow") {
        const outcome = await detectAndLink();
        if (outcome.ok) await refreshBadge();
        sendResponse(outcome);
        return;
      }
      if (msg?.type === "ping") {
        // Lets the options page tell a live service worker from a stale one.
        sendResponse({ ok: true, build: __BUILD_ID__ });
        return;
      }
      if (msg?.type === "submission:detected") {
        sendResponse(await onSubmission(String(msg.slug)));
        return;
      }
      if (msg?.type === "badge:refresh") {
        await refreshBadge();
        sendResponse({ ok: true });
        return;
      }
      // Name the type and the build: a bare "unknown message" gives no way
      // to tell a typo from a service worker still running older code.
      sendResponse({
        ok: false,
        error: `Background (build ${__BUILD_ID__}) does not handle "${String(msg?.type)}". Reload the extension at chrome://extensions.`,
      });
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message });
    }
  })();
  return true; // keep the channel open for the async reply
});

/** Content-script path: record the outcome, link if a handle was found. */
async function onHandleDetected(result: DetectResult) {
  const outcome = await applyDetection(result, { recheckDays: HANDLE_RECHECK_DAYS });
  if (outcome.ok) await refreshBadge();
  return outcome;
}


/** Ask the server to verify, if the submitted problem is today's problem. */
async function onSubmission(slug: string) {
  const store = await readStore();
  if (!store.activeRoomId) return { ok: true, skipped: "no room" };

  const state = await api.state(store.activeRoomId).catch(() => null);
  if (!state?.today?.problemSlug) return { ok: true, skipped: "no problem" };
  if (state.today.problemSlug !== slug) return { ok: true, skipped: "other problem" };

  const result = await api.verifyNow(store.activeRoomId).catch(() => null);
  if (result?.solved) {
    await notify(
      "Solved — nice one",
      `${state.today.problemTitle} counted for ${state.room.name}.`,
    );
    await refreshBadge();
  }
  return { ok: true, solved: result?.solved ?? false };
}

/**
 * Badge shows a dot while today's problem is unsolved, and clears once it is.
 * A quiet nudge every time the browser is open beats a notification people
 * learn to dismiss.
 */
async function refreshBadge() {
  const store = await readStore();
  if (!store.activeRoomId) {
    await setBadge("", "#6b7280");
    return;
  }

  const state = await api.state(store.activeRoomId).catch(() => null);
  if (!state) {
    await setBadge("", "#6b7280");
    return;
  }

  const me = state.leaderboard.find((e) => e.userId === store.identity?.userId);

  if (!state.today?.problemSlug) {
    // Waiting on a pick. Flag it specifically when it is this user's turn.
    await setBadge(state.isMyTurn ? "!" : "", state.isMyTurn ? "#ffa116" : "#6b7280");
    return;
  }
  await setBadge(me?.solvedToday ? "" : "•", me?.solvedToday ? "#00b8a3" : "#ff375f");
}

async function setBadge(text: string, color: string) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    // Badge APIs can throw while the action is mid-teardown; harmless.
  }
}

async function notify(title: string, message: string) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
    });
  } catch {
    // Notifications may be denied; the badge still carries the signal.
  }
}
