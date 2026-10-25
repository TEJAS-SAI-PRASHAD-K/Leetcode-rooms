/**
 * Bump the version across every package in the workspace.
 *
 * The version lives in four package.json files and is read from the
 * extension's by manifest.config.ts, so bumping by hand reliably leaves one
 * behind — which is how the published extension ends up claiming a version it
 * is not.
 *
 *   node scripts/bump-version.mjs patch|minor|major|<explicit version>
 */
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGES = [
  "package.json",
  "shared/package.json",
  "worker/package.json",
  "extension/package.json",
];

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/bump-version.mjs patch|minor|major|<version>");
  process.exit(1);
}

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const [major, minor, patch] = current.split(".").map(Number);

const next =
  arg === "major" ? `${major + 1}.0.0`
  : arg === "minor" ? `${major}.${minor + 1}.0`
  : arg === "patch" ? `${major}.${minor}.${patch + 1}`
  : arg;

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`not a valid semver version: ${next}`);
  process.exit(1);
}

for (const file of PACKAGES) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = next;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${file} -> ${next}`);
}

console.log(`\n${current} -> ${next}`);
