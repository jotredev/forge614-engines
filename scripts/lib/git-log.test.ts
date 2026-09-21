import { describe, expect, test } from "bun:test";
import { commitsSinceTag } from "./git-log.mjs";

describe("commitsSinceTag", () => {
  test("splits on the null-byte separator and trims each message", () => {
    const runCapture = () => "feat: add the thing\0fix: correct it\n\nBREAKING CHANGE: gone\0";
    expect(commitsSinceTag(runCapture, "v1.9.0")).toEqual(["feat: add the thing", "fix: correct it\n\nBREAKING CHANGE: gone"]);
  });

  test("returns an empty array when there are no commits since the tag", () => {
    const runCapture = () => "";
    expect(commitsSinceTag(runCapture, "v1.9.0")).toEqual([]);
  });

  test("passes the correct git log arguments", () => {
    let capturedArgs;
    const runCapture = (command, args) => {
      capturedArgs = args;
      return "";
    };
    commitsSinceTag(runCapture, "v1.9.0");
    expect(capturedArgs).toEqual(["log", "v1.9.0..HEAD", "--reverse", "--pretty=%B%x00"]);
  });
});
