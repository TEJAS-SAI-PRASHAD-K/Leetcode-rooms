import { defineManifest } from "@crxjs/vite-plugin";

/**
 * The Worker the extension talks to. Set VITE_API_BASE when building for a
 * deployed Worker:
 *
 *   VITE_API_BASE=https://leetcode-rooms.<subdomain>.workers.dev npm run build
 *
 * It has to appear in host_permissions as well as in the client, otherwise
 * Chrome blocks the cross-origin fetch at runtime — and that failure only
 * shows up once the extension is loaded, not at build time.
 */
const API_BASE = process.env["VITE_API_BASE"] ?? "http://127.0.0.1:8787";
const apiOrigin = new URL(API_BASE).origin + "/*";

export default defineManifest({
  manifest_version: 3,
  name: "LeetCode Rooms",
  version: "0.1.0",
  description:
    "Practise LeetCode daily with friends: a rotating curator picks the problem, solves are verified automatically, and streaks keep everyone showing up.",
  // Opening the popup is the only action; no tabs/history/cookies permissions,
  // because solve verification happens server-side from public data.
  // "scripting" powers the explicit "Detect now" button, which runs the
  // sign-in check in the page's own context on an open leetcode.com tab.
  permissions: ["storage", "alarms", "notifications", "scripting"],
  host_permissions: ["https://leetcode.com/*", apiOrigin],
  action: {
    default_popup: "src/popup/index.html",
    default_title: "LeetCode Rooms",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      // Reads the signed-in username via a same-origin userStatus call, and
      // nudges the server to re-check after a submission.
      matches: ["https://leetcode.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
});
