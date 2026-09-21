import { describe, expect, test } from "bun:test";
import { jsonConfigFormat } from "./json-format";

describe("jsonConfigFormat.getValueAtPath / withValueAtPath", () => {
  test("reads a nested array value", () => {
    const raw = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "a" }] }] } });
    expect(jsonConfigFormat.getValueAtPath(raw, ["hooks", "SessionStart"])).toEqual([
      { hooks: [{ type: "command", command: "a" }] },
    ]);
  });

  test("returns undefined for a missing path", () => {
    expect(jsonConfigFormat.getValueAtPath("{}", ["hooks", "SessionStart"])).toBeUndefined();
  });

  test("writes a nested array value, creating intermediate objects, and preserves unrelated keys", () => {
    const raw = JSON.stringify({ otherKey: "untouched" });
    const next = jsonConfigFormat.withValueAtPath(raw, ["hooks", "SessionStart"], [{ hooks: [{ type: "command", command: "a" }] }]);
    const parsed = JSON.parse(next);
    expect(parsed.otherKey).toBe("untouched");
    expect(parsed.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: "a" }] }]);
  });

  test("deletes the leaf key when value is undefined", () => {
    const raw = JSON.stringify({ hooks: { SessionStart: [{ a: 1 }], other: true } });
    const next = jsonConfigFormat.withValueAtPath(raw, ["hooks", "SessionStart"], undefined);
    const parsed = JSON.parse(next);
    expect(parsed.hooks).toEqual({ other: true });
  });
});
