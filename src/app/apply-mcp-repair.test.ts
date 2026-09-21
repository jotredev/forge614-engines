import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { planMcpRepair } from "./plan-mcp-repair";
import { planMcpInstall } from "./plan-mcp-install";
import { applyMcpRepair, NotRepairableError } from "./apply-mcp-repair";
import { StalePlanError } from "./apply-plan";
import { resolveEngramExecutable } from "../modules/memory-protocol/constants";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-applyrepair-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("applyMcpRepair", () => {
  test("writes nothing and reports confirmed:false when not confirmed", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const result = await applyMcpRepair(home, plan.planId, false);
    expect(result.confirmed).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.status).toBe("repairable-conflict");
    const stillOld = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    expect(stillOld.mcpServers["forge614-engram"]).toEqual({ command: "/old/path", args: ["serve"] });
  });

  test("applies the write when confirmed, preserving other content", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const result = await applyMcpRepair(home, plan.planId, true);
    expect(result.confirmed).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.changedFiles).toEqual([join(home, ".claude.json")]);
    const written = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    expect(written.other).toBe(true);
    expect(written.mcpServers.keep).toEqual({ command: "y", args: [] });
    expect(written.mcpServers["forge614-engram"]).toEqual({ command: resolveEngramExecutable(home), args: ["mcp"] });
  });

  test("fails closed with StalePlanError when the file changed since the plan", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, extra: { command: "z", args: [] } } }),
    );
    await expect(applyMcpRepair(home, plan.planId, true)).rejects.toThrow(StalePlanError);
  });

  test("is a no-write success for an already-correct plan even when confirmed", async () => {
    const canonical = resolveEngramExecutable(home);
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "forge614-engram": { command: canonical, args: ["mcp"] } } }));
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const result = await applyMcpRepair(home, plan.planId, true);
    expect(result.applied).toBe(true);
    expect(result.changedFiles).toHaveLength(0);
    expect(result.status).toBe("already-correct");
  });

  test.skipIf(process.platform === "win32")(
    "a confirmed apply of a blocked plan reports status:'blocked', distinguishable from already-correct",
    async () => {
      const path = join(home, ".claude.json");
      writeFileSync(path, JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }));
      chmodSync(path, 0o444);
      const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
      chmodSync(path, 0o644);
      expect(plan.repair?.status).toBe("blocked");

      const result = await applyMcpRepair(home, plan.planId, true);
      expect(result.applied).toBe(true);
      expect(result.changedFiles).toHaveLength(0);
      expect(result.status).toBe("blocked");
      expect(result.status).not.toBe("already-correct");
    },
  );

  test("rejects a planId that is not a repair plan", async () => {
    const plan = await planMcpInstall(registry, { agentId: "claude-code", home, server: { name: "forge614-engram", command: "/x", args: ["mcp"] } });
    await expect(applyMcpRepair(home, plan.planId, true)).rejects.toThrow(NotRepairableError);
  });
});
