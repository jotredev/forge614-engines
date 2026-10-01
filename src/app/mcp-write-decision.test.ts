import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { mkdirSync } from "node:fs";
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

describe("Codex entries carrying default_tools_approval_mode", () => {
  const codexServer = { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] };

  function writeCodexConfig(body: string): void {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), body);
  }

  const WITH_KEY =
    '[mcp_servers.forge614-engram]\ncommand = "/bin/engram"\nargs = [ "mcp" ]\ndefault_tools_approval_mode = "approve"\n';

  test("install: the entry with the approval key is ours (noop, not conflict)", async () => {
    writeCodexConfig(WITH_KEY);
    const result = await decideMcpInstall(codexAdapter, home, codexServer);
    expect(result.decision).toEqual({ kind: "noop" });
  });

  test("install: a different command is still a conflict even with the approval key", async () => {
    writeCodexConfig(WITH_KEY.replace("/bin/engram", "/other"));
    const result = await decideMcpInstall(codexAdapter, home, codexServer);
    expect(result.decision).toEqual({ kind: "conflict" });
  });

  test("remove: the entry with the approval key is recognized (write, not unrecognized) and goes away whole", async () => {
    writeCodexConfig(WITH_KEY);
    const result = await decideMcpRemove(codexAdapter, home, codexServer);
    expect(result.decision).toEqual({ kind: "write" });
    expect(result.write!.afterContent).not.toContain("forge614-engram");
    expect(result.write!.afterContent).not.toContain("default_tools_approval_mode");
  });

  test("remove: a different command is still unrecognized even with the approval key", async () => {
    writeCodexConfig(WITH_KEY.replace("/bin/engram", "/other"));
    const result = await decideMcpRemove(codexAdapter, home, codexServer);
    expect(result.decision).toEqual({ kind: "unrecognized" });
  });
});
