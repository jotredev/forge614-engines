import { describe, expect, test } from "bun:test";
import { appendToArray, jsonConfigFormat, removeArrayItems } from "./json-format";
import { parse } from "jsonc-parser";

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

/** Ten allow rules, one with escaped quotes, inside a JSONC file with a comment: the shape of a real ~/.claude/settings.json. */
const TEN_RULES = [
  "Bash(git status)",
  "Bash(git diff:*)",
  'Bash(echo "quoted \\"inner\\" text")',
  "mcp__notion__notion-fetch",
  "mcp__playwright__browser_click",
  "mcp__playwright__browser_snapshot",
  "mcp__playwright__browser_navigate",
  "mcp__pencil",
  "Read(~/projects/**)",
  "WebFetch(domain:example.com)",
];

function settingsWith(rules: string[]): string {
  const body = rules.map((rule) => `      ${JSON.stringify(rule)}`).join(",\n");
  return `{\n  // user settings, keep this comment\n  "defaultMode": "auto",\n  "permissions": {\n    "allow": [\n${body}\n    ]\n  },\n  "theme": "dark"\n}\n`;
}

describe("jsonConfigFormat array helpers", () => {
  test("appendToArray adds the new rule at the end and leaves every other byte of the file identical", () => {
    const raw = settingsWith(TEN_RULES);
    const next = appendToArray(raw, ["permissions", "allow"], "mcp__forge614-engram");

    const lines = raw.split("\n");
    const nextLines = next.split("\n");
    const lastRuleIndex = lines.findIndex((line) => line.includes('"WebFetch(domain:example.com)"'));
    // the previously-last rule gains a trailing comma; the new rule is one extra line right after it
    const expected = [
      ...lines.slice(0, lastRuleIndex),
      `${lines[lastRuleIndex]},`,
      '      "mcp__forge614-engram"',
      ...lines.slice(lastRuleIndex + 1),
    ];
    expect(nextLines).toEqual(expected);
    expect((parse(next).permissions.allow as string[]).length).toBe(11);
    expect(parse(next).permissions.allow.slice(0, 10)).toEqual(TEN_RULES);
  });

  test("removeArrayItems removes only the indexed items and leaves the others intact", () => {
    const raw = settingsWith([...TEN_RULES, "mcp__forge614-engram", "mcp__forge614-engram__*"]);
    const next = removeArrayItems(raw, ["permissions", "allow"], [10, 11]);

    expect(parse(next).permissions.allow).toEqual(TEN_RULES);
    expect(next).toContain("// user settings, keep this comment");
    expect(parse(next).theme).toBe("dark");
    expect(parse(next).defaultMode).toBe("auto");
  });

  test("removeArrayItems copes with indexes given in any order and in the middle of the array", () => {
    const raw = settingsWith(["a", "b", "c", "d", "e"]);
    const next = removeArrayItems(raw, ["permissions", "allow"], [1, 3]);
    expect(parse(next).permissions.allow).toEqual(["a", "c", "e"]);
  });
});
