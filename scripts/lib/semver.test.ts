import { describe, expect, test } from "bun:test";
import { bumpVersion, compareVersions, formatVersion, latestReleasedVersion, parseVersion } from "./semver.mjs";

describe("parseVersion", () => {
  test("parses a valid X.Y.Z string", () => {
    expect(parseVersion("1.9.0")).toEqual([1, 9, 0]);
  });

  test("rejects anything that isn't exactly X.Y.Z", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.9")).toBeNull();
    expect(parseVersion("1.9.0-beta.1")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("compareVersions", () => {
  test("orders by major, then minor, then patch", () => {
    expect(compareVersions([2, 0, 0], [1, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 9, 0], [1, 10, 0])).toBeLessThan(0);
    expect(compareVersions([1, 9, 1], [1, 9, 0])).toBeGreaterThan(0);
    expect(compareVersions([1, 9, 0], [1, 9, 0])).toBe(0);
  });
});

describe("formatVersion", () => {
  test("joins the triple back into X.Y.Z", () => {
    expect(formatVersion([1, 9, 0])).toBe("1.9.0");
  });
});

describe("latestReleasedVersion", () => {
  test("picks the highest version across all vX.Y.Z tags, regardless of list order", () => {
    expect(latestReleasedVersion(["v1.8.0", "v1.10.0", "v1.9.0"])).toEqual([1, 10, 0]);
  });

  test("ignores tags that aren't exactly vX.Y.Z", () => {
    expect(latestReleasedVersion(["v1.8.0", "not-a-version", "v1.9.0-beta.1"])).toEqual([1, 8, 0]);
  });

  test("returns null when there are no release tags at all", () => {
    expect(latestReleasedVersion([])).toBeNull();
    expect(latestReleasedVersion(["not-a-version"])).toBeNull();
  });
});

describe("bumpVersion", () => {
  test("major resets minor and patch to 0", () => {
    expect(bumpVersion([1, 9, 3], "major")).toEqual([2, 0, 0]);
  });

  test("minor resets patch to 0", () => {
    expect(bumpVersion([1, 9, 3], "minor")).toEqual([1, 10, 0]);
  });

  test("patch only increments patch", () => {
    expect(bumpVersion([1, 9, 3], "patch")).toEqual([1, 9, 4]);
  });
});
