/**
 * Build the extension and zip it for distribution.
 *
 *   VITE_API_BASE=https://your-worker.workers.dev npm run package
 *
 * The worker url is baked into the bundle at build time and also drives
 * host_permissions, so a zip built without it points at localhost and is
 * useless to anyone else. That failure only shows up once someone installs it,
 * so this refuses to build rather than shipping a broken archive.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const apiBase = process.env["VITE_API_BASE"];

if (!apiBase) {
  console.error(
    "VITE_API_BASE is not set.\n\n" +
      "  VITE_API_BASE=https://<your-worker>.workers.dev npm run package\n\n" +
      "without it the zip would point at http://127.0.0.1:8787 and fail for\n" +
      "everyone who installs it.",
  );
  process.exit(1);
}

if (apiBase.includes("127.0.0.1") || apiBase.includes("localhost")) {
  console.error(`refusing to package a build pointed at ${apiBase}`);
  process.exit(1);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });

console.log(`building extension v${version} against ${apiBase}`);
run("npm", ["run", "build", "--workspace", "extension"], {
  env: { ...process.env, VITE_API_BASE: apiBase },
});

const dist = resolve(root, "extension/dist");
if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("build produced no manifest.json");
  process.exit(1);
}

const outDir = resolve(root, "releases");
mkdirSync(outDir, { recursive: true });
const zipPath = resolve(outDir, `leetcode-rooms-v${version}.zip`);
rmSync(zipPath, { force: true });

// Zipped from inside dist so manifest.json sits at the archive root; chrome
// needs the folder it loads to contain the manifest directly.
run("zip", ["-r", "-q", "-X", zipPath, "."], { cwd: dist });

const size = (readFileSync(zipPath).length / 1024).toFixed(0);
console.log(`\nwrote releases/leetcode-rooms-v${version}.zip (${size} kb)`);
console.log("install: unzip it, then chrome://extensions > developer mode > load unpacked");
