import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { planMcpRepair } from "./plan-mcp-repair";
import { applyMcpRepair } from "./apply-mcp-repair";
import { verifyMcpRepair } from "./verify-mcp-repair";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-verifyrepair-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("verifyMcpRepair", () => {
  test("end-to-end for Claude Code: present, canonical, foreign entries preserved", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    await applyMcpRepair(home, plan.planId, true);

    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.present).toBe(true);
    expect(verification.commandCanonical).toBe(true);
    expect(verification.argsCanonical).toBe(true);
    expect(verification.foreignPreserved).toBe(true);
    expect(verification.status).toBe("ok");
  });

  test("end-to-end for Codex", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `[mcp_servers.other]\ncommand = "z"\nargs = []\n\n[mcp_servers.forge614-engram]\ncommand = "/old/path"\nargs = ["serve"]\n`,
    );
    const plan = await planMcpRepair(registry, { agentId: "codex", home });
    await applyMcpRepair(home, plan.planId, true);

    const verification = await verifyMcpRepair(registry, { agentId: "codex", home, planId: plan.planId });
    expect(verification.status).toBe("ok");
    expect(verification.foreignPreserved).toBe(true);
  });

  test("reports missing when the entry was never installed", async () => {
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.present).toBe(false);
    expect(verification.status).toBe("missing");
    expect(verification.foreignPreserved).toBe(true);
  });

  test("reports mismatch when not confirmed (conflict never repaired)", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    await applyMcpRepair(home, plan.planId, false);

    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.status).toBe("mismatch");
    expect(verification.commandCanonical).toBe(false);
  });

  test("reports foreignPreserved false when foreign content was mutated after the repair", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    await applyMcpRepair(home, plan.planId, true);

    // Independently mutate the current config after the repair: keep the now-canonical
    // forge614-engram entry intact, but change the unrelated "keep" entry — this simulates
    // foreign content that should have been preserved but wasn't.
    const configPath = join(home, ".claude.json");
    const current = JSON.parse(readFileSync(configPath, "utf8"));
    current.mcpServers.keep = { command: "mutated", args: ["changed"] };
    writeFileSync(configPath, JSON.stringify(current));

    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.commandCanonical).toBe(true);
    expect(verification.argsCanonical).toBe(true);
    expect(verification.foreignPreserved).toBe(false);
  });

  test("returns a clean result with foreignPreserved:false instead of throwing when the current config is corrupted", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    await applyMcpRepair(home, plan.planId, true);

    // Corrupt the config file on disk after the repair, simulating something else
    // mangling it — this must not surface a raw parser error to the CLI.
    const configPath = join(home, ".claude.json");
    writeFileSync(configPath, "{ this is not valid json at all");

    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.foreignPreserved).toBe(false);
    expect(verification.present).toBe(false);
    expect(verification.status).toBe("missing");
  });

  test("throws NotRepairableError for a non-repair plan", async () => {
    const { planMcpInstall } = await import("./plan-mcp-install");
    const { NotRepairableError } = await import("./apply-mcp-repair");
    const plan = await planMcpInstall(registry, { agentId: "claude-code", home, server: { name: "forge614-engram", command: "/x", args: ["mcp"] } });
    await expect(verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId })).rejects.toThrow(NotRepairableError);
  });
});
