import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { decideMcpInstall, decideMcpRemove } from "./mcp-write-decision";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-mcpdecision-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const server = { name: "forge614-engram", command: "forge614-engram", args: ["mcp"] };

describe("decideMcpInstall", () => {
  test("proposes a write when no entry exists", async () => {
    const result = await decideMcpInstall(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("write");
    expect(result.write?.path).toBe(join(home, ".claude.json"));
  });

  test("is a noop when the exact entry already exists", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "forge614-engram", args: ["mcp"] } } }),
    );
    const result = await decideMcpInstall(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("noop");
    expect(result.write).toBeUndefined();
  });

  test("reports a conflict without proposing a write", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "forge614-engram": { command: "/other" } } }));
    const result = await decideMcpInstall(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("conflict");
    expect(result.write).toBeUndefined();
  });
});

describe("decideMcpRemove", () => {
  test("is a noop when the entry is absent", async () => {
    const result = await decideMcpRemove(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("noop");
  });

  test("proposes a write when the recognized entry exists", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "forge614-engram", args: ["mcp"] } } }),
    );
    const result = await decideMcpRemove(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("write");
    expect(JSON.parse(result.write!.afterContent).mcpServers?.["forge614-engram"]).toBeUndefined();
  });

  test("reports unrecognized without proposing a write", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "forge614-engram": { command: "/other" } } }));
    const result = await decideMcpRemove(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("unrecognized");
    expect(result.write).toBeUndefined();
  });
});
