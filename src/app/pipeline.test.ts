import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFormats } from "../infrastructure/config-io/formats";
import { resolveHookEvidencePath } from "../modules/agents/hook-command";
import type { AgentId } from "../modules/agents/types";
import { applyPlan } from "./apply-plan";
import { buildDefaultRegistry } from "./default-registry";
import { recordHookEvidence } from "./hook-evidence";
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
  const protocolV4 = {
    id: "forge614-engram-memory",
    version: 4,
    instructions: protocol.instructions,
    mcpInstructions: protocol.instructions,
    startupContext: { command: "x", format: 2, description: "d" },
  };
  // Argv-aware, like the real forge614-engram 1.7.0+: answers --protocol-version 4 with a v4
  // payload, and anything else (including no flag at all) with v1 — see memory-protocol-client.ts.
  writeFileSync(
    script,
    [
      "const args = process.argv.slice(2);",
      'const idx = args.indexOf("--protocol-version");',
      'if (idx !== -1 && args[idx + 1] === "4") {',
      `  console.log(${JSON.stringify(JSON.stringify(protocolV4))});`,
      "} else {",
      `  console.log(${JSON.stringify(JSON.stringify(protocol))});`,
      "}",
    ].join("\n"),
  );
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
      // Neither agent is "complete" at plan time: no real session has run the
      // hook yet, so there is no runtime evidence for either — this is the exact
      // bug this test guards against (a plan that would write a correct hook
      // entry must never itself claim "complete"). status stays structurally
      // "write" for both; only runtimeStatus differs by agent.
      expect(installPlan.metadata?.overallStatus).toBe("partial");
      expect(installPlan.metadata?.hook.status.kind).toBe("write");
      expect(installPlan.metadata?.hook.runtimeStatus?.kind).toBe(agentId === "codex" ? "needs-user-trust" : "pending-runtime-verification");

      const installResult = await applyPlan(home, installPlan.planId);
      expect(installResult.changedFiles.length).toBeGreaterThan(0);

      const afterInstall = await verifyMemoryIntegration(registry, { agentId, home, startupContextOptions });
      expect(afterInstall.mcp.present).toBe(true);
      expect(afterInstall.instructions.present).toBe(true);
      expect(afterInstall.hook.present).toBe(true);
      expect(afterInstall.hook.dryRunOk).toBe(true); // diagnostic only — the hook's own code path works
      // Neither agent is "complete" right after install: no real session has run
      // the hook yet, so there is no execution evidence. Codex additionally shows
      // needs-user-trust (its own separate reason); Claude Code shows
      // pending-runtime-verification (just needs a real session to run once).
      expect(afterInstall.hook.runtimeStatus.kind).toBe(agentId === "codex" ? "needs-user-trust" : "pending-runtime-verification");
      expect(afterInstall.overallStatus).toBe("partial");

      // Simulate a real session actually running the hook and receiving context —
      // for Codex this also stands in for "the user approved it natively", since
      // Engines has no other way to observe that approval.
      await recordHookEvidence(home, agentId, true);
      const afterRealExecution = await verifyMemoryIntegration(registry, { agentId, home, startupContextOptions });
      expect(afterRealExecution.hook.runtimeStatus.kind).toBe("runtime-observed");
      expect(afterRealExecution.overallStatus).toBe("complete");

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
      // Removal also invalidates this agent's own execution evidence — a fresh
      // install later must not silently inherit "complete" from a past session.
      expect(existsSync(resolveHookEvidencePath(home, agentId))).toBe(false);

      const reremovePlan = await planMemoryRemove(registry, { agentId, home });
      expect(reremovePlan.noop).toBe(true);
    });
  }
});
