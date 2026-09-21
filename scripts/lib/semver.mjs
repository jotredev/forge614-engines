export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function formatVersion(version) {
  return version.join(".");
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** The highest version any `vX.Y.Z` tag actually claims — the real source of "what shipped", never package.json's current field (which can be mid-bump and not yet real). Tags that aren't exactly `vX.Y.Z` are ignored. */
export function latestReleasedVersion(existingTags) {
  const versions = existingTags
    .map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1])
    .filter((v) => v !== undefined)
    .map(parseVersion);
  if (versions.length === 0) return null;
  return versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
}

export function bumpVersion(version, severity) {
  const [major, minor, patch] = version;
  if (severity === "major") return [major + 1, 0, 0];
  if (severity === "minor") return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}
