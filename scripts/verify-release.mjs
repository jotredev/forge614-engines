import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commitsSinceTag } from "./lib/git-log.mjs";
import { classifyCommit, suggestNextVersion } from "./lib/release-suggestion.mjs";
import { formatVersion, latestReleasedVersion } from "./lib/semver.mjs";
import { bold, dim } from "./lib/tty.mjs";

/**
 * Pure: given the latest released version (a [major, minor, patch] triple, or
 * null if nothing has ever been tagged) and the commit messages since it,
 * builds the human-readable report lines and the suggested version. This is
 * the one place that decides "what's the reasonable next version" — both this
 * script (read-only preview) and release-cut.mjs (which uses the same
 * suggestion as its default when no version is passed) call it, so the two
 * can never disagree about what's reasonable.
 */
export function buildReport(latest, commitMessages) {
  if (!latest) {
    return { suggestion: null, lines: ["No release tags found yet — pick any starting version, e.g. 1.0.0."] };
  }
  const latestTag = `v${formatVersion(latest)}`;
  if (commitMessages.length === 0) {
    return { suggestion: null, lines: [`No commits since ${latestTag} — nothing to release.`] };
  }
  const suggestion = suggestNextVersion(latest, commitMessages);
  const lines = [
    `Changes since ${latestTag} (${commitMessages.length} commit${commitMessages.length === 1 ? "" : "s"}):`,
    ...commitMessages.map((message) => `  - [${classifyCommit(message)}] ${message.split("\n")[0]}`),
    "",
    `Suggested next version (${suggestion.severity} bump from ${formatVersion(latest)}): ${suggestion.version}`,
  ];
  return { suggestion, lines };
}

/**
 * Prints the report to stdout — never stderr: most terminals color stderr
 * red by default, which made a perfectly successful run look like an error.
 * Every line but the last (the per-commit breakdown, all diagnostic) is
 * dimmed; the final "Suggested next version" line is bold, so it's the one
 * thing that visually stands out as the actual answer. release-cut.mjs
 * reuses this so its own version-suggestion prompt looks identical.
 */
export function printReport(lines, isTTY = process.stdout.isTTY) {
  lines.forEach((line, index) => {
    console.log(index === lines.length - 1 ? bold(line, isTTY) : dim(line, isTTY));
  });
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const runCapture = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();

  execFileSync("git", ["fetch", "--tags"], { cwd: root, stdio: "inherit" });
  const existingTags = runCapture("git", ["tag", "--list"]).split("\n").filter(Boolean);
  const latest = latestReleasedVersion(existingTags);
  const commitMessages = latest ? commitsSinceTag(runCapture, `v${formatVersion(latest)}`) : [];

  const report = buildReport(latest, commitMessages);
  printReport(report.lines);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && relative(scriptPath, process.argv[1]) === "") {
  await main();
}
