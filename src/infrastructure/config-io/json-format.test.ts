import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonConfigFormat } from "./json-format";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-jsonfmt-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("jsonConfigFormat", () => {
  test("readOrDefault returns exists:false and '{}' when the file is missing", async () => {
    const result = await jsonConfigFormat.readOrDefault(join(dir, "missing.json"));
    expect(result).toEqual({ raw: "{}", exists: false });
  });

  test("readOrDefault returns the real content when the file exists", async () => {
    const path = join(dir, "config.json");
    writeFileSync(path, '{"other":true}');
    const result = await jsonConfigFormat.readOrDefault(path);
    expect(result).toEqual({ raw: '{"other":true}', exists: true });
  });

  test("getMcpEntry reads a nested value, undefined if absent", () => {
    expect(jsonConfigFormat.getMcpEntry('{"mcpServers":{"foo":{"command":"x"}}}', ["mcpServers"], "foo")).toEqual({
      command: "x",
    });
    expect(jsonConfigFormat.getMcpEntry("{}", ["mcpServers"], "foo")).toBeUndefined();
  });

  test("withMcpEntry inserts a new entry without touching unrelated keys", () => {
    const updated = jsonConfigFormat.withMcpEntry('{"other":true}', ["mcpServers"], "foo", { command: "x", args: [] });
    const parsed = JSON.parse(updated);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers.foo).toEqual({ command: "x", args: [] });
  });

  test("withMcpEntry removes an entry when given undefined", () => {
    const updated = jsonConfigFormat.withMcpEntry('{"mcpServers":{"foo":{"command":"x"}}}', ["mcpServers"], "foo", undefined);
    const parsed = JSON.parse(updated);
    expect(parsed.mcpServers?.foo).toBeUndefined();
  });
});

describe("isParsable", () => {
  test("true for valid JSON", () => {
    expect(jsonConfigFormat.isParsable('{"a":1}')).toBe(true);
  });

  test("true for empty string (treated as empty document)", () => {
    expect(jsonConfigFormat.isParsable("")).toBe(true);
  });

  test("false for malformed JSON", () => {
    expect(jsonConfigFormat.isParsable("{ this is not json")).toBe(false);
  });
});
