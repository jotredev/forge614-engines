import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFormats } from "../infrastructure/config-io/formats";
import type { AgentId } from "../modules/agents/types";
import { applyPlan } from "./apply-plan";
import { buildDefaultRegistry } from "./default-registry";
import { planMcpInstall } from "./plan-mcp-install";
import { planMcpRemove } from "./plan-mcp-remove";
import { planMemoryInstall } from "./plan-memory-install";
import { planMemoryRemove } from "./plan-memory-remove";
import { verifyMemoryIntegration } from "./verify-memory-integration";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-pipeline-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const AGENT_IDS: AgentId[] = ["claude-code", "codex", "cursor"];

// Cursor is covered by the MCP-only describe block above: it has no instructions component to
// round-trip, so its memory lifecycle is exactly its MCP lifecycle.
const MEMORY_AGENT_IDS: AgentId[] = ["claude-code", "codex"];

function writeProtocolFixtureScript(home: string): string {
  const script = join(home, "engram-fixture.js");
  const protocol = {
    id: "forge614-engram-memory",
    version: 1,
    instructions: "Call memory_context at the start of a conversation.",
    lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
    scopes: { shared: "s", project: "p" },
    security: { neverSave: ["passwords"] },
  };
  writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(protocol))});`);
  return script;
}

describe("install → apply → remove → apply, against a home with no agent config directory", () => {
  for (const agentId of AGENT_IDS) {
    test(`${agentId}`, async () => {
      const registry = buildDefaultRegistry();
      const adapter = registry.get(agentId)!;
      const configPath = adapter.configFile(home);
      const format = configFormats[adapter.configFormat];
      const server = { name: "forge614", command: "/bin/forge614", args: ["mcp"] };

      // Precondition: this is a fresh machine — neither the config file nor its
      // parent directory exists yet.
      expect(existsSync(configPath)).toBe(false);

      const installPlan = await planMcpInstall(registry, { agentId, home, server });
      expect(installPlan.noop).toBe(false);

      const installResult = await applyPlan(home, installPlan.planId);
      expect(installResult.changedFiles).toEqual([configPath]);
      expect(existsSync(configPath)).toBe(true);
      expect(format.getMcpEntry(readFileSync(configPath, "utf8"), adapter.mcpEntryPath, server.name)).toEqual(
        adapter.mcpEntryShape(server) as never,
      );

      const removePlan = await planMcpRemove(registry, { agentId, home, server });
      expect(removePlan.noop).toBe(false);

      const removeResult = await applyPlan(home, removePlan.planId);
      expect(removeResult.changedFiles).toEqual([configPath]);
      expect(
        format.getMcpEntry(readFileSync(configPath, "utf8"), adapter.mcpEntryPath, server.name),
      ).toBeUndefined();
    });
  }
});

describe("memory-install → apply → verify → memory-remove → apply → verify, through the real applyPlan", () => {
  for (const agentId of MEMORY_AGENT_IDS) {
    test(`${agentId}`, async () => {
      const registry = buildDefaultRegistry();
      const script = writeProtocolFixtureScript(home);
      const protocolOptions = { command: process.execPath, args: [script] };
      const startupContextScript = join(home, "startup-context-fixture.js");
      writeFileSync(
        startupContextScript,
        `console.log(${JSON.stringify(
          JSON.stringify({
            format: 1,
            shared: { pinned: [], recent: [], sessions: [], truncated: false },
            project: { status: "unbound", projectId: null, context: null },
          }),
        )});`,
      );
      const startupContextOptions = { command: process.execPath, args: [startupContextScript] };

      const before = await verifyMemoryIntegration(registry, { agentId, home, startupContextOptions });
      expect(before.mcp.present).toBe(false);
      expect(before.hook.present).toBe(false);

      const installPlan = await planMemoryInstall(registry, { agentId, home, protocolOptions });
      expect(installPlan.noop).toBe(false);
      // Codex's hook is structurally correct here but still needs one-time
      // interactive trust Engines cannot grant or verify — so it's "partial",
      // never "complete", unlike Claude Code which has no such trust gate.
      expect(installPlan.metadata?.overallStatus).toBe(agentId === "codex" ? "partial" : "complete");
      if (agentId === "codex") expect(installPlan.metadata?.hook.status.kind).toBe("needs-user-trust");

      const installResult = await applyPlan(home, installPlan.planId);
      expect(installResult.changedFiles.length).toBeGreaterThan(0);

      const afterInstall = await verifyMemoryIntegration(registry, { agentId, home, startupContextOptions });
      expect(afterInstall.mcp.present).toBe(true);
      expect(afterInstall.instructions.present).toBe(true);
      expect(afterInstall.hook.present).toBe(true);
      expect(afterInstall.hook.dryRunOk).toBe(true);
      // Same split as the plan-time check: Claude Code reaches "complete", Codex
      // never does because trustPending stays true until a stable, documented way
      // to verify Codex's own hook trust exists — which it does not today.
      expect(afterInstall.hook.trustPending).toBe(agentId === "codex");
      expect(afterInstall.overallStatus).toBe(agentId === "codex" ? "partial" : "complete");

      const reinstallPlan = await planMemoryInstall(registry, { agentId, home, protocolOptions });
      expect(reinstallPlan.noop).toBe(true);

      const removePlan = await planMemoryRemove(registry, { agentId, home });
      expect(removePlan.noop).toBe(false);

      const removeResult = await applyPlan(home, removePlan.planId);
      expect(removeResult.changedFiles.length).toBeGreaterThan(0);

      const afterRemove = await verifyMemoryIntegration(registry, { agentId, home, startupContextOptions });
      expect(afterRemove.mcp.present).toBe(false);
      expect(afterRemove.instructions.present).toBe(false);
      expect(afterRemove.hook.present).toBe(false);

      const reremovePlan = await planMemoryRemove(registry, { agentId, home });
      expect(reremovePlan.noop).toBe(true);
    });
  }
});
