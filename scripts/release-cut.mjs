import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Pure — no git, no filesystem, no prompts — so it's directly unit-testable.
 * The real lock this exists for: today's release (v1.9.0) got tagged with
 * package.json bumped but docs/notion-map.json still pointing at the old
 * version, because nothing checked the new version against reality before
 * committing. This checks three things a version string alone can't tell you:
 * it parses as semver, it's actually newer than what's released today, and
 * that exact tag hasn't already been cut (a duplicate-release guard).
 */
export function validateVersion(version, currentVersion, existingTags) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return { ok: false, reason: `"${version}" is not a valid version — expected X.Y.Z (e.g. 1.9.0)` };
  }
  const current = parseVersion(currentVersion);
  if (current && compareVersions(parsed, current) <= 0) {
    return { ok: false, reason: `${version} is not newer than the current version ${currentVersion}` };
  }
  const tag = `v${version}`;
  if (existingTags.includes(tag)) {
    return { ok: false, reason: `Tag ${tag} already exists — this version was already released` };
  }
  return { ok: true };
}

async function promptForVersion(currentVersion) {
  if (!process.stdin.isTTY) {
    throw new Error("No version given and stdin is not interactive — pass it explicitly: bun scripts/release-cut.mjs <version>");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`Version to release (current: ${currentVersion}): `)).trim();
  } finally {
    rl.close();
  }
}

async function confirm(question) {
  if (!process.stdin.isTTY) return true; // non-interactive callers already opted in by construction
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const run = (command, args, opts = {}) => execFileSync(command, args, { cwd: root, stdio: "inherit", ...opts });
  const runCapture = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();

  const packageJsonPath = join(root, "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const currentVersion = pkg.version;

  let version = process.argv[2];
  if (!version) version = await promptForVersion(currentVersion);

  run("git", ["fetch", "--tags"]);
  const existingTags = runCapture("git", ["tag", "--list"]).split("\n").filter(Boolean);

  const validation = validateVersion(version, currentVersion, existingTags);
  if (!validation.ok) {
    console.error(`Refusing to release: ${validation.reason}`);
    process.exit(64);
  }

  if (!(await confirm(`About to bump ${currentVersion} -> ${version}, tag it, and push — this publishes a real release. Continue?`))) {
    console.log("Aborted.");
    process.exit(1);
  }

  pkg.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Bumped package.json to ${version}`);

  // Keeps docs/notion-map.json's productVersion in lockstep with the real
  // package.json version automatically — the exact drift that made today's
  // first release-cut attempt fail its own bun test run.
  const notionMapPath = join(root, "docs", "notion-map.json");
  const notionMap = JSON.parse(await readFile(notionMapPath, "utf8"));
  if (notionMap.productVersion !== version) {
    notionMap.productVersion = version;
    await writeFile(notionMapPath, `${JSON.stringify(notionMap, null, 2)}\n`);
    console.log(`Synced docs/notion-map.json productVersion to ${version}`);
  }

  run("bun", ["install"]);
  run("bun", ["test"]);
  run("bun", ["run", "typecheck"]);

  // Building and publishing happen in CI (.github/workflows/release.yml),
  // triggered by the tag push below — each platform's binary is compiled and
  // smoke-tested on its own native runner (including a real Windows machine
  // for windows-x64), which is more trustworthy than cross-compiling all
  // targets from one developer's machine and catches bugs a single-host build
  // can't (this replaced an earlier local-only version of this script after a
  // stale-output bug leaked old assets into the v1.0.0 release).
  const status = runCapture("git", ["status", "--porcelain", "--", "package.json", "bun.lock", "docs/notion-map.json"]);
  if (status) {
    run("git", ["add", "package.json", "bun.lock", "docs/notion-map.json"]);
    run("git", ["commit", "-m", `chore: release v${version}\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`]);
  }

  const tag = `v${version}`;
  run("git", ["tag", tag]);
  run("git", ["push", "origin", "HEAD"]);
  run("git", ["push", "origin", tag]);

  console.log(`\nPushed tag ${tag} — GitHub Actions will build, verify, and publish the release:`);
  console.log(`https://github.com/jotredev/forge614-engines/actions`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && relative(scriptPath, process.argv[1]) === "") {
  await main();
}
