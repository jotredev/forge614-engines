import { describe, expect, test } from "bun:test";
import { buildReport } from "./verify-release.mjs";

describe("buildReport", () => {
  test("reports no tags yet when there is no release history", () => {
    const report = buildReport(null, []);
    expect(report.suggestion).toBeNull();
    expect(report.lines).toEqual(["No release tags found yet — pick any starting version, e.g. 1.0.0."]);
  });

  test("reports nothing to release when there are no commits since the latest tag", () => {
    const report = buildReport([1, 9, 0], []);
    expect(report.suggestion).toBeNull();
    expect(report.lines).toEqual(["No commits since v1.9.0 — nothing to release."]);
  });

  test("lists each commit with its classification and ends with the suggested version", () => {
    const report = buildReport([1, 9, 0], ["feat: add the thing", "fix: correct it"]);
    expect(report.suggestion).toEqual({ severity: "minor", version: "1.10.0" });
    expect(report.lines).toEqual([
      "Changes since v1.9.0 (2 commits):",
      "  - [minor] feat: add the thing",
      "  - [patch] fix: correct it",
      "",
      "Suggested next version (minor bump from 1.9.0): 1.10.0",
    ]);
  });

  test("only shows the subject line for a multi-line commit message, not the full body", () => {
    const report = buildReport([1, 9, 0], ["fix: correct it\n\nBREAKING CHANGE: gone"]);
    expect(report.lines[1]).toBe("  - [major] fix: correct it");
  });

  test("uses singular 'commit' for exactly one commit", () => {
    const report = buildReport([1, 9, 0], ["fix: correct it"]);
    expect(report.lines[0]).toBe("Changes since v1.9.0 (1 commit):");
  });
});
