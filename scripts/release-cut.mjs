import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { commitsSinceTag } from "./lib/git-log.mjs";
import { compareVersions, formatVersion, latestReleasedVersion, parseVersion } from "./lib/semver.mjs";
import { buildReport } from "./verify-release.mjs";

/**
 * Pure — worded differently depending on whether package.json actually needs
 * to change, so "About to bump 1.9.0 -> 1.9.0" (confusing: looks like nothing
 * would happen) never appears for the exact re-run-after-a-failed-attempt case
 * this script exists to support, where package.json is already at the target
 * version and only tagging + pushing remains.
 */
export function describeConfirmation(currentVersion, version) {
  const bumpStep =
    currentVersion === version
      ? `package.json is already at ${version} (from an earlier attempt) — skipping the bump.`
      : `Bumping package.json ${currentVersion} -> ${version}.`;
  return `${bumpStep} Tagging v${version} and pushing — this publishes a real release. Continue?`;
}

/**
 * Pure — no git, no filesystem, no prompts — so it's directly unit-testable.
 * The real lock this exists for: a first release-cut attempt can bump
 * package.json and then fail before tagging or pushing (exactly what happened
 * cutting v1.9.0 — bun test caught docs/notion-map.json out of sync and the
 * script stopped mid-way). Re-running with the same version must then still
 * succeed, so "already released" is judged against git tags — the actual
 * source of truth for what shipped — never against package.json's current
 * field, which can be mid-bump and not yet real. This checks three things a
 * version string alone can't tell you: it parses as semver, it's newer than
 * the highest version any tag actually claims, and that exact tag hasn't
 * already been cut (a duplicate-release guard).
 */
export function validateVersion(version, existingTags) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return { ok: false, reason: `"${version}" is not a valid version — expected X.Y.Z (e.g. 1.9.0)` };
  }
  const tag = `v${version}`;
  if (existingTags.includes(tag)) {
    return { ok: false, reason: `Tag ${tag} already exists — this version was already released` };
  }
  const latest = latestReleasedVersion(existingTags);
  if (latest && compareVersions(parsed, latest) <= 0) {
    return { ok: false, reason: `${version} is not newer than the latest released version ${formatVersion(latest)}` };
  }
  return { ok: true };
}

/**
 * When no version is given: shows `suggested` (computed from the commits
 * since the last tag — see buildReport) as a default the user can accept by
 * just pressing Enter, instead of leaving them to guess a number. In a
 * non-interactive context (no TTY), uses the suggestion directly with no
 * prompt at all — that's what makes `bun run release` with zero arguments
 * work unattended. If there's no suggestion to offer (e.g. no prior tags at
 * all) and stdin isn't interactive, there is nothing reasonable to fall back
 * to, so this refuses rather than guessing.
 */
async function promptForVersion(suggested) {
  if (!process.stdin.isTTY) {
    if (suggested) return suggested;
    throw new Error("No version given, no reasonable version could be suggested, and stdin is not interactive — pass one explicitly: bun scripts/release-cut.mjs <version>");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const hint = suggested ? ` [${suggested}]` : "";
    const answer = (await rl.question(`Version to release${hint}: `)).trim();
    return answer || suggested;
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

const RELEASE_REPO = "jotredev/forge614-engines";

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * GitHub Actions doesn't register the run for a tag push instantly, so the
 * first few list calls right after `git push` can legitimately come back
 * empty — this is not a failure, just a race to poll through.
 */
export async function findReleaseRunId(runCapture, tag) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let runs;
    try {
      const output = runCapture("gh", [
        "run", "list", "-R", RELEASE_REPO, "--workflow=release.yml", "--branch", tag, "--limit", "1", "--json", "databaseId",
      ]);
      runs = JSON.parse(output);
    } catch {
      return null; // gh missing/unauthenticated — caller falls back to the static message
    }
    if (runs.length > 0) return runs[0].databaseId;
    await sleep(2000);
  }
  return null;
}

/**
 * Streams the release build's live progress into the same terminal
 * (`gh run watch`) instead of leaving the user to guess whether it passed,
 * and reports the real GitHub Release URL only once the run has actually
 * succeeded — never claims "published" when the build failed.
 */
export async function watchReleaseRun(run, runCapture, tag) {
  const runId = await findReleaseRunId(runCapture, tag);
  if (runId === null) {
    console.log(`Could not find the workflow run to watch — check manually: https://github.com/${RELEASE_REPO}/actions`);
    return;
  }
  console.log(`\nWatching run ${runId} build ${tag}...\n`);
  try {
    run("gh", ["run", "watch", String(runId), "--exit-status", "-R", RELEASE_REPO]);
    console.log(`\nRelease ${tag} published: https://github.com/${RELEASE_REPO}/releases/tag/${tag}`);
  } catch {
    console.error(`\nThe release build failed or did not publish. See the run: https://github.com/${RELEASE_REPO}/actions/runs/${runId}`);
    process.exitCode = 1;
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const run = (command, args, opts = {}) => execFileSync(command, args, { cwd: root, stdio: "inherit", ...opts });
  const runCapture = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();

  const packageJsonPath = join(root, "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const currentVersion = pkg.version;

  run("git", ["fetch", "--tags"]);
  const existingTags = runCapture("git", ["tag", "--list"]).split("\n").filter(Boolean);

  let version = process.argv[2];
  if (!version) {
    const latest = latestReleasedVersion(existingTags);
    const commitMessages = latest ? commitsSinceTag(runCapture, `v${formatVersion(latest)}`) : [];
    const report = buildReport(latest, commitMessages);
    for (const line of report.lines) console.log(line);
    version = await promptForVersion(report.suggestion?.version ?? null);
  }

  const validation = validateVersion(version, existingTags);
  if (!validation.ok) {
    console.error(`Refusing to release: ${validation.reason}`);
    process.exit(64);
  }

  if (!(await confirm(describeConfirmation(currentVersion, version)))) {
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

  console.log(`\nPushed tag ${tag}.`);
  await watchReleaseRun(run, runCapture, tag);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && relative(scriptPath, process.argv[1]) === "") {
  await main();
}
