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

/**
 * Argv-aware, like the real forge614-engram 1.7.0+: answers --protocol-version 4 with a v4
 * payload built from `instructions`, and anything else (including no flag at all) with v1 —
 * see memory-protocol-client.ts. `rejectV4` instead mimics an Engram older than 1.7.0, which
 * rejects the flag outright with Engram's own `{code:"INVALID_INPUT",...}` stderr envelope.
 */
function protocolScript(instructions: string, options?: { rejectV4?: boolean }): string {
  const v1 = {
    id: "forge614-engram-memory",
    version: 1,
    instructions,
    lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
    scopes: { shared: "s", project: "p" },
    security: { neverSave: ["passwords"] },
  };
  const v4 = {
    id: "forge614-engram-memory",
    version: 4,
    instructions,
    mcpInstructions: instructions,
    startupContext: { command: "x", format: 2, description: "d" },
  };
  return [
    "const args = process.argv.slice(2);",
    'const idx = args.indexOf("--protocol-version");',
    'const wantsV4 = idx !== -1 && args[idx + 1] === "4";',
    options?.rejectV4
      ? [
          "if (wantsV4) {",
          `  process.stderr.write(${JSON.stringify(JSON.stringify({ code: "INVALID_INPUT", error: "protocol-version debe ser 1, 2, 3 o 4." }))});`,
          "  process.exit(1);",
          "}",
        ].join("\n")
      : "",
    `console.log(wantsV4 ? ${JSON.stringify(JSON.stringify(v4))} : ${JSON.stringify(JSON.stringify(v1))});`,
  ].join("\n");
}

const PROTOCOL_SCRIPT_CONTENT = protocolScript("Call memory_context.");

/**
 * Argv-aware, like the real forge614-engram 1.7.0+: rejects --format 2 with Engram's own
 * INVALID_INPUT envelope (this fixture always plays a pre-1.7.0 Engram — see startup-context-client.ts's
 * fetchStartupBlock), so a caller that goes through the hook (fetchStartupBlock) falls back to
 * format 1, exactly as it did before format 2 existed. A direct format-1 caller (probeEcosystemBlock)
 * is unaffected either way, since it never requests --format at all.
 */
function startupScript(payload: unknown): string {
  return [
    "const args = process.argv.slice(2);",
    'if (args.includes("--format")) {',
    `  process.stderr.write(${JSON.stringify(JSON.stringify({ code: "INVALID_INPUT", error: "format debe ser 1 o 2." }))});`,
    "  process.exit(1);",
    "}",
    `console.log(${JSON.stringify(JSON.stringify(payload))});`,
  ].join("\n");
}

beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  delete process.env.FORGE614_HOME;
  home = mkdtempSync(join(tmpdir(), "engines-verifymemory-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(cursorAdapter);
  startupContextScript = join(home, "startup-context.js");
  writeFileSync(startupContextScript, startupScript(STARTUP_CONTEXT_RESULT));
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

  // D5: Claude Code embeds the manual directly now (no satellite file — see
  // instructions-write-decision.test.ts for the migration itself). A machine that still has the
  // pre-D5 "@<file>" reference block is reported present (the block is there) but D3's drift check
  // must treat that reference shape as an outdated manual, never as up to date.
  test("treats a pre-D5 '@<file>' reference block as present but outdated, with the exact refresh command", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "CLAUDE.md"),
      "<!-- forge614-engines:begin engram-memory-protocol -->\n@forge614-engram-memory-protocol.md\n<!-- forge614-engines:end engram-memory-protocol -->\n",
    );
    writeFileSync(
      join(home, ".claude", "forge614-engram-memory-protocol.md"),
      "<!-- Managed by Forge614 Engines. Do not edit by hand; changes are overwritten on the next apply. -->\n\nOld manual text.",
    );

    const d5Script = join(home, "d5-drift.js");
    writeFileSync(d5Script, protocolScript("Call memory_context."));

    const result = await verifyMemoryIntegration(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [d5Script] },
    });

    expect(result.instructions.present).toBe(true);
    expect(result.instructions.upToDate).toBe(false);
    expect(result.instructions.driftNotice).toContain("plan memory-install --agent claude-code");
  });

  describe("engram ecosystem block (structural, never by version)", () => {
    const withStartupContext = (payload: unknown) => {
      const script = join(home, "startup-context-variant.js");
      writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(payload))});`);
      return { command: process.execPath, args: [script] };
    };

    test("reports published when startup-context carries a valid ecosystem block (member)", async () => {
      const options = withStartupContext({ ...STARTUP_CONTEXT_RESULT, ecosystem: { status: "member", group: { id: "g", name: "forge614" }, context: { pinned: [], recent: [] } } });
      const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: options });
      expect(result.engram.ecosystemBlock).toBe("published");
    });

    test("reports published for status none too: the block exists even for a project without a group", async () => {
      const options = withStartupContext({ ...STARTUP_CONTEXT_RESULT, ecosystem: { status: "none" } });
      const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: options });
      expect(result.engram.ecosystemBlock).toBe("published");
    });

    test("reports not-published for an Engram whose startup-context has no ecosystem block", async () => {
      const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });
      expect(result.engram.ecosystemBlock).toBe("not-published");
    });

    test("reports unavailable, without failing, when Engram cannot be run", async () => {
      const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });
      expect(result.engram.ecosystemBlock).toBe("unavailable");
    });

    test("never changes overallStatus", async () => {
      const options = withStartupContext({ ...STARTUP_CONTEXT_RESULT, ecosystem: { status: "none" } });
      const withBlock = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: options });
      const without = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });
      expect(withBlock.overallStatus).toBe(without.overallStatus);
    });
  });

  // D3: verify never trusted the installed manual's content before — it only checked block
  // presence. Now it re-fetches the protocol fresh and warns (never fails) when what's on
  // disk has drifted from what Engram serves today.
  describe("instructions drift against Engram's current protocol (never a failure, never overallStatus)", () => {
    function scriptPath(name: string, content: string): string {
      const path = join(home, name);
      writeFileSync(path, content);
      return path;
    }

    test("does not compute drift when nothing is installed (behaves as before)", async () => {
      const result = await verifyMemoryIntegration(registry, {
        agentId: "claude-code",
        home,
        protocolOptions: { command: process.execPath, args: [scriptPath("unused.js", protocolScript("Call memory_context."))] },
      });
      expect(result.instructions.present).toBe(false);
      expect(result.instructions.upToDate).toBeUndefined();
      expect(result.instructions.driftNotice).toBeUndefined();
    });

    test("reports upToDate true when the installed manual still matches what Engram serves", async () => {
      await installFor("claude-code");

      const result = await verifyMemoryIntegration(registry, {
        agentId: "claude-code",
        home,
        protocolOptions: { command: process.execPath, args: [scriptPath("same.js", protocolScript("Call memory_context."))] },
      });

      expect(result.instructions.present).toBe(true);
      expect(result.instructions.upToDate).toBe(true);
      expect(result.instructions.driftNotice).toBeUndefined();
    });

    test("reports upToDate false with the exact refresh command when Engram's manual changed since install", async () => {
      await installFor("claude-code");

      const result = await verifyMemoryIntegration(registry, {
        agentId: "claude-code",
        home,
        protocolOptions: { command: process.execPath, args: [scriptPath("changed.js", protocolScript("A brand-new manual text."))] },
      });

      expect(result.instructions.upToDate).toBe(false);
      expect(result.instructions.driftNotice).toContain("plan memory-install --agent claude-code");
      expect(result.overallStatus).not.toBe("absent"); // informational only: never demotes overallStatus
    });

    test("stays silent (no upToDate, no refresh command) when a refresh would be blocked anyway", async () => {
      await installFor("codex");
      writeFileSync(join(home, ".codex", "AGENTS.override.md"), "some override content");

      const result = await verifyMemoryIntegration(registry, {
        agentId: "codex",
        home,
        protocolOptions: { command: process.execPath, args: [scriptPath("blocked.js", protocolScript("A brand-new manual text."))] },
      });

      expect(result.instructions.present).toBe(true);
      expect(result.instructions.upToDate).toBeUndefined();
      expect(result.instructions.driftNotice).toBeUndefined();
    });

    test("stays silent (no upToDate, no failure) when Engram cannot be reached for the comparison", async () => {
      await installFor("claude-code");

      const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home }); // no protocolOptions, no canonical binary either

      expect(result.instructions.present).toBe(true);
      expect(result.instructions.upToDate).toBeUndefined();
      expect(result.instructions.driftNotice).toBeUndefined();
    });

    test("surfaces the bilingual legacy-protocol notice when the drift check itself needs the v1 fallback", async () => {
      // Installed originally against a v4-serving Engram (installFor's default script succeeds
      // at --protocol-version 4); now Engram behind it has regressed to pre-1.7.0, so re-fetching
      // for the drift check itself needs the fallback. The v1 render legitimately differs in shape
      // from the v4 render (it adds Lifecycle/Scopes/Security sections v4 has none of), so drift is
      // correctly reported too — the point of this test is the notice, not upToDate's value.
      await installFor("claude-code");

      const result = await verifyMemoryIntegration(registry, {
        agentId: "claude-code",
        home,
        protocolOptions: {
          command: process.execPath,
          args: [scriptPath("legacy.js", protocolScript("Call memory_context.", { rejectV4: true }))],
        },
      });

      expect(result.instructions.upToDate).toBe(false);
      expect(result.engram.protocolNotice).toBeDefined();
      expect(result.engram.protocolNotice).toContain("actualiza Engram");
      expect(result.engram.protocolNotice).toContain("upgrade Engram");
    });
  });
});
