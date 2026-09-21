import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tomlConfigFormat } from "./toml-format";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-tomlfmt-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tomlConfigFormat", () => {
  test("readOrDefault returns exists:false and '' when the file is missing", async () => {
    const result = await tomlConfigFormat.readOrDefault(join(dir, "missing.toml"));
    expect(result).toEqual({ raw: "", exists: false });
  });

  test("withMcpEntry adds a table entry, preserving unrelated top-level keys", async () => {
    const updated = tomlConfigFormat.withMcpEntry('model = "gpt-5"', ["mcp_servers"], "forge614-engram", {
      command: "/bin/engram",
      args: ["mcp"],
    });
    const entry = tomlConfigFormat.getMcpEntry(updated, ["mcp_servers"], "forge614-engram");
    expect(entry).toEqual({ command: "/bin/engram", args: ["mcp"] });
    expect(updated).toContain('model = "gpt-5"');
  });

  test("withMcpEntry with undefined removes the entry", async () => {
    const withEntry = tomlConfigFormat.withMcpEntry("", ["mcp_servers"], "forge614-engram", { command: "/bin/engram" });
    const removed = tomlConfigFormat.withMcpEntry(withEntry, ["mcp_servers"], "forge614-engram", undefined);
    expect(tomlConfigFormat.getMcpEntry(removed, ["mcp_servers"], "forge614-engram")).toBeUndefined();
  });
});

describe("isParsable", () => {
  test("true for valid TOML", () => {
    expect(tomlConfigFormat.isParsable('a = 1\n')).toBe(true);
  });

  test("true for empty string", () => {
    expect(tomlConfigFormat.isParsable("")).toBe(true);
  });

  test("false for malformed TOML", () => {
    expect(tomlConfigFormat.isParsable("this = is not [valid toml")).toBe(false);
  });
});
