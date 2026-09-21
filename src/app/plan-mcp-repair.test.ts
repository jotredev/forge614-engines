import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { resolveEngramExecutable } from "../modules/memory-protocol/constants";
import { planMcpRepair } from "./plan-mcp-repair";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planrepair-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMcpRepair", () => {
  test("not-installed when the config file does not exist", async () => {
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("not-installed");
    expect(plan.noop).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });

  test("not-installed when the file exists but has no forge614-engram entry", async () => {
    writeFileSync(join(home, ".claude.json"), '{"mcpServers":{"other":{"command":"x","args":[]}}}');
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("not-installed");
  });

  test("already-correct when the canonical entry is already installed", async () => {
    const canonical = resolveEngramExecutable(home);
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: canonical, args: ["mcp"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("already-correct");
    expect(plan.noop).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });

  test("repairable-conflict for a stale Claude Code entry, preserving unrelated content", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("repairable-conflict");
    expect(plan.repair?.existing).toEqual({ command: "/old/path", args: ["serve"] });
    expect(plan.repair?.canonical).toEqual({ name: "forge614-engram", command: resolveEngramExecutable(home), args: ["mcp"] });
    expect(plan.noop).toBe(false);
    expect(plan.writes).toHaveLength(1);
    const parsed = JSON.parse(plan.writes[0].afterContent);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers.keep).toEqual({ command: "y", args: [] });
    expect(parsed.mcpServers["forge614-engram"]).toEqual({ command: resolveEngramExecutable(home), args: ["mcp"] });
  });

  test("repairable-conflict for a stale Codex entry", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `[mcp_servers.other]\ncommand = "z"\nargs = []\n\n[mcp_servers.forge614-engram]\ncommand = "/old/path"\nargs = ["serve"]\n`,
    );
    const plan = await planMcpRepair(registry, { agentId: "codex", home });
    expect(plan.repair?.status).toBe("repairable-conflict");
    expect(plan.writes).toHaveLength(1);

    const parsed = parseToml(plan.writes[0].afterContent) as {
      mcp_servers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcp_servers.other).toEqual({ command: "z", args: [] });
    expect(parsed.mcp_servers["forge614-engram"]).toEqual({ command: resolveEngramExecutable(home), args: ["mcp"] });
  });

  test("redacts non-command/args keys in the existing-entry preview", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"], env: { TOKEN: "secret" } } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.existing).toEqual({ command: "/old/path", args: ["serve"], env: "<redacted>" });
  });

  test("blocked with unparsable-config when the file is corrupt", async () => {
    writeFileSync(join(home, ".claude.json"), "{ not json at all");
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("blocked");
    expect(plan.repair?.blockedReason).toBe("unparsable-config");
    expect(plan.writes).toHaveLength(0);
  });

  test.skipIf(process.platform === "win32")("blocked with not-writable when the file cannot be written", async () => {
    const path = join(home, ".claude.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }));
    chmodSync(path, 0o444);
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    chmodSync(path, 0o644);
    expect(plan.repair?.status).toBe("blocked");
    expect(plan.repair?.blockedReason).toBe("not-writable");
    expect(plan.writes).toHaveLength(0);
  });

  test("throws for an unknown agent", async () => {
    await expect(planMcpRepair(registry, { agentId: "cursor" as never, home })).rejects.toThrow("Unknown agent");
  });
});
