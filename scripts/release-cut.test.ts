import { describe, expect, test } from "bun:test";
import { validateVersion } from "./release-cut.mjs";

describe("validateVersion", () => {
  test("accepts a version strictly greater than the current one, with no existing tag", () => {
    expect(validateVersion("1.9.0", "1.8.0", ["v1.7.0", "v1.8.0"])).toEqual({ ok: true });
  });

  test("rejects a non-semver string", () => {
    expect(validateVersion("latest", "1.8.0", [])).toEqual({
      ok: false,
      reason: '"latest" is not a valid version — expected X.Y.Z (e.g. 1.9.0)',
    });
  });

  test("rejects a version equal to the current one", () => {
    expect(validateVersion("1.8.0", "1.8.0", ["v1.8.0"])).toEqual({
      ok: false,
      reason: "1.8.0 is not newer than the current version 1.8.0",
    });
  });

  test("rejects a version older than the current one", () => {
    expect(validateVersion("1.7.0", "1.8.0", ["v1.7.0", "v1.8.0"])).toEqual({
      ok: false,
      reason: "1.7.0 is not newer than the current version 1.8.0",
    });
  });

  test("rejects a version whose tag already exists, even if it's numerically newer (duplicate release attempt)", () => {
    expect(validateVersion("1.9.0", "1.8.0", ["v1.8.0", "v1.9.0"])).toEqual({
      ok: false,
      reason: "Tag v1.9.0 already exists — this version was already released",
    });
  });

  test("accepts a major or patch bump the same way as a minor bump", () => {
    expect(validateVersion("2.0.0", "1.8.0", [])).toEqual({ ok: true });
    expect(validateVersion("1.8.1", "1.8.0", [])).toEqual({ ok: true });
  });
});
