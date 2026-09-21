import { describe, expect, test } from "bun:test";
import { describeConfirmation, validateVersion } from "./release-cut.mjs";

describe("describeConfirmation", () => {
  test("says package.json needs a bump when the current and target versions differ", () => {
    expect(describeConfirmation("1.8.0", "1.9.0")).toBe(
      "Bumping package.json 1.8.0 -> 1.9.0. Tagging v1.9.0 and pushing — this publishes a real release. Continue?",
    );
  });

  test("says the bump is skipped when package.json is already at the target version — the exact case that used to read '1.9.0 -> 1.9.0' and looked like a no-op bug", () => {
    expect(describeConfirmation("1.9.0", "1.9.0")).toBe(
      "package.json is already at 1.9.0 (from an earlier attempt) — skipping the bump. Tagging v1.9.0 and pushing — this publishes a real release. Continue?",
    );
  });
});

describe("validateVersion", () => {
  test("accepts a version strictly greater than the latest released tag", () => {
    expect(validateVersion("1.9.0", ["v1.7.0", "v1.8.0"])).toEqual({ ok: true });
  });

  test("accepts a version equal to package.json's current field when that exact version was never actually tagged", () => {
    // Exactly what happened today: a first release-cut attempt bumped
    // package.json to 1.9.0 and then failed before tagging/pushing. Re-running
    // with the same version must succeed — the source of truth for "already
    // released" is git tags, not whatever package.json happens to say.
    expect(validateVersion("1.9.0", ["v1.7.0", "v1.8.0"])).toEqual({ ok: true });
  });

  test("rejects a non-semver string", () => {
    expect(validateVersion("latest", [])).toEqual({
      ok: false,
      reason: '"latest" is not a valid version — expected X.Y.Z (e.g. 1.9.0)',
    });
  });

  test("rejects a version equal to the latest released tag (the tag-exists check fires first, since they're necessarily the same thing)", () => {
    expect(validateVersion("1.8.0", ["v1.7.0", "v1.8.0"])).toEqual({
      ok: false,
      reason: "Tag v1.8.0 already exists — this version was already released",
    });
  });

  test("rejects a version older than the latest released tag, even when that exact version was never itself tagged", () => {
    expect(validateVersion("1.8.0", ["v1.7.0", "v2.0.0"])).toEqual({
      ok: false,
      reason: "1.8.0 is not newer than the latest released version 2.0.0",
    });
  });

  test("rejects a version whose tag already exists, even if it's numerically newer (duplicate release attempt)", () => {
    expect(validateVersion("1.9.0", ["v1.8.0", "v1.9.0"])).toEqual({
      ok: false,
      reason: "Tag v1.9.0 already exists — this version was already released",
    });
  });

  test("accepts a major or patch bump the same way as a minor bump", () => {
    expect(validateVersion("2.0.0", ["v1.8.0"])).toEqual({ ok: true });
    expect(validateVersion("1.8.1", ["v1.8.0"])).toEqual({ ok: true });
  });

  test("accepts any valid version when there are no tags at all yet", () => {
    expect(validateVersion("0.1.0", [])).toEqual({ ok: true });
  });

  test("ignores tags that don't look like vX.Y.Z when finding the latest released version", () => {
    expect(validateVersion("1.9.0", ["v1.8.0", "not-a-version", "v1.8.0-beta.1"])).toEqual({ ok: true });
  });
});
