import { bumpVersion, formatVersion } from "./semver.mjs";

const CONVENTIONAL_TYPE_PATTERN = /^(\w+)(\([^)]*\))?(!)?:\s*.*/;
const BREAKING_FOOTER_PATTERN = /^BREAKING CHANGE:/m;

/**
 * Classifies one commit message (subject line, or the full message including
 * body/footer) into the semver severity it implies, conservatively: anything
 * that isn't recognizably a feature or a breaking change still counts as at
 * least `patch` (something changed), never `null` — only an empty commit list
 * as a whole (see suggestBump) means "nothing to release".
 */
export function classifyCommit(message) {
  const match = CONVENTIONAL_TYPE_PATTERN.exec(message.split("\n")[0] ?? "");
  const hasBreakingMarker = match?.[3] === "!";
  const hasBreakingFooter = BREAKING_FOOTER_PATTERN.test(message);
  if (hasBreakingMarker || hasBreakingFooter) return "major";
  if (match?.[1] === "feat") return "minor";
  return "patch";
}

/** The overall severity across a batch of commit messages — the most severe classification wins. Returns null only when there are no commits at all. */
export function suggestBump(commitMessages) {
  if (commitMessages.length === 0) return null;
  const severities = commitMessages.map(classifyCommit);
  if (severities.includes("major")) return "major";
  if (severities.includes("minor")) return "minor";
  return "patch";
}

/**
 * Combines suggestBump with the actual version math: given the latest
 * released version (a [major, minor, patch] triple, e.g. from
 * latestReleasedVersion) and the commit messages since that release, returns
 * `{ severity, version }` for the next version, or null when there is nothing
 * to release. This is the one function both `release-cut.mjs` (to default the
 * version instead of asking the user to guess one) and `verify-release.mjs`
 * (to preview it without publishing) build on — one brain, not two.
 */
export function suggestNextVersion(latestVersion, commitMessages) {
  const severity = suggestBump(commitMessages);
  if (!severity) return null;
  return { severity, version: formatVersion(bumpVersion(latestVersion, severity)) };
}
