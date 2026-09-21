import { describe, expect, test } from "bun:test";
import { classifyCommit, suggestBump, suggestNextVersion } from "./release-suggestion.mjs";

describe("classifyCommit", () => {
  test("classifies feat: as minor", () => {
    expect(classifyCommit("feat: add the thing")).toBe("minor");
  });

  test("classifies fix:, docs:, chore:, test:, refactor: as patch by default", () => {
    expect(classifyCommit("fix: correct the thing")).toBe("patch");
    expect(classifyCommit("docs: explain the thing")).toBe("patch");
    expect(classifyCommit("chore: tidy the thing")).toBe("patch");
    expect(classifyCommit("test: cover the thing")).toBe("patch");
    expect(classifyCommit("refactor: reshape the thing")).toBe("patch");
  });

  test("classifies a scoped conventional commit the same as an unscoped one", () => {
    expect(classifyCommit("feat(hooks): add the thing")).toBe("minor");
  });

  test("classifies a ! after the type/scope as major, regardless of type", () => {
    expect(classifyCommit("feat!: remove the old API")).toBe("major");
    expect(classifyCommit("fix(core)!: remove the old API")).toBe("major");
  });

  test("classifies a BREAKING CHANGE: footer as major, even on a fix: subject", () => {
    expect(classifyCommit("fix: correct the thing\n\nBREAKING CHANGE: the old signature is gone")).toBe("major");
  });

  test("classifies a non-conventional subject as patch by default (conservative: something changed)", () => {
    expect(classifyCommit("just a plain commit message")).toBe("patch");
  });
});

describe("suggestBump", () => {
  test("returns null for an empty commit list — nothing to release", () => {
    expect(suggestBump([])).toBeNull();
  });

  test("returns minor when any commit is feat: and none are breaking", () => {
    expect(suggestBump(["fix: a", "feat: b", "docs: c"])).toBe("minor");
  });

  test("returns patch when nothing is feat: or breaking", () => {
    expect(suggestBump(["fix: a", "docs: b"])).toBe("patch");
  });

  test("returns major when anything is breaking, even alongside feat: commits", () => {
    expect(suggestBump(["feat: a", "fix!: b"])).toBe("major");
  });
});

describe("suggestNextVersion", () => {
  test("bumps the latest version by the right severity", () => {
    const result = suggestNextVersion([1, 9, 0], ["feat: add the thing", "fix: correct it"]);
    expect(result).toEqual({ severity: "minor", version: "1.10.0" });
  });

  test("returns null when there are no commits to suggest from", () => {
    expect(suggestNextVersion([1, 9, 0], [])).toBeNull();
  });
});
