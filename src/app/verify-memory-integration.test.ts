import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { resolveHookEvidencePath } from "../modules/agents/hook-command";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { recordHookEvidence } from "./hook-evidence";
import { planMemoryInstall } from "./plan-memory-install";
import { verifyMemoryIntegration } from "./verify-memory-integration";

let home: string;
let registry: AgentRegistry;
let previousForgeHome: string | undefined;
let startupContextScript: string;

const STARTUP_CONTEXT_RESULT = {
  format: 1,
  shared: { pinned: [], recent: [], sessions: [], truncated: false },
  project: { status: "unbound", projectId: null, context: null },
};

const PROTOCOL_SCRIPT_CONTENT = `console.log(${JSON.stringify(
  JSON.stringify({
    id: "forge614-engram-memory",
    version: 1,
    instructions: "Call memory_context.",
    lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
    scopes: { shared: "s", project: "p" },
    security: { neverSave: ["passwords"] },
  }),
)});`;

beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  delete process.env.FORGE614_HOME;
  home = mkdtempSync(join(tmpdir(), "engines-verifymemory-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(cursorAdapter);
  startupContextScript = join(home, "startup-context.js");
  writeFileSync(startupContextScript, `console.log(${JSON.stringify(JSON.stringify(STARTUP_CONTEXT_RESULT))});`);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME;
  else process.env.FORGE614_HOME = previousForgeHome;
});

const startupContextOptions = () => ({ command: process.execPath, args: [startupContextScript] });

async function installFor(agentId: "claude-code" | "codex") {
  const script = join(home, "engram.js");
  writeFileSync(script, PROTOCOL_SCRIPT_CONTENT);
  const installed = await planMemoryInstall(registry, { agentId, home, protocolOptions: { command: process.execPath, args: [script] } });
  for (const write of installed.writes) {
    mkdirSync(dirname(write.path), { recursive: true });
    writeFileSync(write.path, write.afterContent);
  }
}

describe("verifyMemoryIntegration", () => {
  test("reports absent for both components when nothing is installed", async () => {
    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });
    expect(result.mcp.present).toBe(false);
    expect(result.instructions.present).toBe(false);
    expect(result.overallStatus).toBe("absent");
  });

  // Scenario 1: hook installed, no execution evidence yet -> never complete.
  test("a structurally-correct, freshly-installed hook is never complete without real execution evidence", async () => {
    await installFor("claude-code");

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.present).toBe(true);
    expect(result.hook.dryRunOk).toBe(true); // the code path itself works — diagnostic only, does not drive completeness
    expect(result.hook.runtimeStatus.kind).toBe("pending-runtime-verification");
    expect(result.overallStatus).toBe("partial");
  });

  // Scenario 2: Claude Code hook genuinely executed, with valid evidence -> complete.
  test("claude-code reaches complete once a real hook execution left valid evidence", async () => {
    await installFor("claude-code");
    await recordHookEvidence(home, "claude-code", true);

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).toBe("runtime-observed");
    expect(result.overallStatus).toBe("complete");
  });

  test("claude-code reaching complete requires evidence to say Engram context was actually received, not just that the hook ran", async () => {
    await installFor("claude-code");
    await recordHookEvidence(home, "claude-code", false); // hook ran, but Engram itself failed that time

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).toBe("pending-runtime-verification");
    if (result.hook.runtimeStatus.kind === "pending-runtime-verification") {
      expect(result.hook.runtimeStatus.reason).toBe("evidence-context-not-received");
    }
    expect(result.overallStatus).toBe("partial");
  });

  // Scenario 3: Codex without evidence -> needs-user-trust, never complete.
  test("codex without any execution evidence reports needs-user-trust, never complete", async () => {
    await installFor("codex");

    const result = await verifyMemoryIntegration(registry, { agentId: "codex", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.present).toBe(true);
    expect(result.hook.runtimeStatus.kind).toBe("needs-user-trust");
    expect(result.overallStatus).toBe("partial");
  });

  // Scenario 4: Codex with valid evidence recorded after the user approved it natively -> complete.
  test("codex reaches complete once evidence proves the real, user-approved hook executed and received context", async () => {
    await installFor("codex");
    await recordHookEvidence(home, "codex", true);

    const result = await verifyMemoryIntegration(registry, { agentId: "codex", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).toBe("runtime-observed");
    expect(result.overallStatus).toBe("complete");
  });

  // Scenario 5: stale/corrupt/wrong-agent evidence never counts.
  test("evidence whose fingerprint no longer matches the current hook config does not count, and codex falls back to needs-user-trust", async () => {
    await installFor("codex");
    await recordHookEvidence(home, "codex", true);
    // Simulate the config identity changing (e.g. FORGE614_HOME relocated) after evidence was recorded.
    process.env.FORGE614_HOME = join(home, "different-forge-home");
    mkdirSync(join(home, "different-forge-home"), { recursive: true });

    const result = await verifyMemoryIntegration(registry, { agentId: "codex", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).not.toBe("runtime-observed");
  });

  test("corrupt evidence does not count as proof of execution", async () => {
    await installFor("claude-code");
    mkdirSync(dirname(resolveHookEvidencePath(home, "claude-code")), { recursive: true });
    writeFileSync(resolveHookEvidencePath(home, "claude-code"), "not valid evidence json");

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).toBe("pending-runtime-verification");
    if (result.hook.runtimeStatus.kind === "pending-runtime-verification") {
      expect(result.hook.runtimeStatus.reason).toBe("evidence-corrupt");
    }
  });

  // Scenario 4 of the vigencia correction: expired evidence never counts, even
  // for Claude Code where nothing else about it is wrong.
  test("expired evidence reports pending-runtime-verification with reason evidence-expired, never complete", async () => {
    const { HOOK_EVIDENCE_MAX_AGE_MS } = await import("./hook-evidence");
    await installFor("claude-code");
    await recordHookEvidence(home, "claude-code", true);
    const evidencePath = resolveHookEvidencePath(home, "claude-code");
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    evidence.timestamp = new Date(Date.now() - HOOK_EVIDENCE_MAX_AGE_MS - 60_000).toISOString();
    writeFileSync(evidencePath, JSON.stringify(evidence));

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).toBe("pending-runtime-verification");
    if (result.hook.runtimeStatus.kind === "pending-runtime-verification") {
      expect(result.hook.runtimeStatus.reason).toBe("evidence-expired");
    }
    expect(result.overallStatus).toBe("partial");
  });

  test("expired evidence for codex falls back to pending-runtime-verification, not needs-user-trust — expiry isn't a trust question", async () => {
    const { HOOK_EVIDENCE_MAX_AGE_MS } = await import("./hook-evidence");
    await installFor("codex");
    await recordHookEvidence(home, "codex", true);
    const evidencePath = resolveHookEvidencePath(home, "codex");
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    evidence.timestamp = new Date(Date.now() - HOOK_EVIDENCE_MAX_AGE_MS - 60_000).toISOString();
    writeFileSync(evidencePath, JSON.stringify(evidence));

    const result = await verifyMemoryIntegration(registry, { agentId: "codex", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).toBe("pending-runtime-verification");
    if (result.hook.runtimeStatus.kind === "pending-runtime-verification") {
      expect(result.hook.runtimeStatus.reason).toBe("evidence-expired");
    }
  });

  test("another agent's evidence never counts for this agent", async () => {
    await installFor("claude-code");
    await recordHookEvidence(home, "codex", true);
    const codexEvidence = readFileSync(resolveHookEvidencePath(home, "codex"), "utf8");
    mkdirSync(dirname(resolveHookEvidencePath(home, "claude-code")), { recursive: true });
    writeFileSync(resolveHookEvidencePath(home, "claude-code"), codexEvidence);

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.runtimeStatus.kind).toBe("pending-runtime-verification");
    if (result.hook.runtimeStatus.kind === "pending-runtime-verification") {
      expect(result.hook.runtimeStatus.reason).toBe("evidence-wrong-agent");
    }
  });

  test("hook is reported unsupported (not absent/blocked) for cursor", async () => {
    const result = await verifyMemoryIntegration(registry, { agentId: "cursor", home });
    expect(result.hook.supported).toBe(false);
    expect(result.hook.runtimeStatus.kind).toBe("unsupported");
  });

  test("cursor's instructions are always reported unsupported", async () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: resolveEngramMcpServer(home).command, args: ["mcp"] } } }),
    );

    const result = await verifyMemoryIntegration(registry, { agentId: "cursor", home });

    expect(result.mcp.present).toBe(true);
    expect(result.instructions.supported).toBe(false);
    // Cursor structurally cannot have instructions or a hook installed, so a present MCP entry is the complete achievable state for this agent.
    expect(result.overallStatus).toBe("complete");
  });

  test("reports instructions absent when the satellite content file is missing, even though CLAUDE.md still references it", async () => {
    await installFor("claude-code");

    rmSync(join(home, ".claude", "forge614-engram-memory-protocol.md"));

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });

    expect(result.instructions.present).toBe(false);
    expect(result.overallStatus).toBe("partial");
  });
});
