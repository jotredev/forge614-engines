import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { tomlConfigFormat } from "../infrastructure/config-io/toml-format";
import { EngramProtocolUnavailableError } from "../infrastructure/engram/memory-protocol-client";
import { resolveEngramExecutable, resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { recordHookEvidence } from "./hook-evidence";
import { planMemoryInstall } from "./plan-memory-install";

let home: string;
let registry: AgentRegistry;
let okScript: string;
let missingCommand: string;
let previousForgeHome: string | undefined;

const PROTOCOL = {
  id: "forge614-engram-memory",
  version: 1,
  instructions: "Call memory_context at the start of a conversation.",
  lifecycle: {
    start: ["Call memory_context."],
    save: ["Save explicit remember requests."],
    compact: ["Call memory_session_summary before compacting."],
    resume: ["Call memory_context after compaction."],
    end: ["Call memory_session_end."],
  },
  scopes: { shared: "Cross-client.", project: "Repository-specific." },
  security: { neverSave: ["passwords"] },
};

beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  delete process.env.FORGE614_HOME;
  home = mkdtempSync(join(tmpdir(), "engines-planmemoryinstall-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(cursorAdapter);
  okScript = join(home, "ok-engram.js");
  writeFileSync(okScript, `console.log(${JSON.stringify(JSON.stringify(PROTOCOL))});`);
  missingCommand = join(home, "does-not-exist-engram");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME;
  else process.env.FORGE614_HOME = previousForgeHome;
});

const protocolOptions = () => ({ command: process.execPath, args: [okScript] });

describe("planMemoryInstall", () => {
  test("is only partial for claude-code right after install — a structurally-correct, never-executed hook is not complete", async () => {
    // This is the exact bug this test guards against: Shell must never see
    // "complete" for a hook that has not actually run yet, even though the
    // config write itself is entirely correct.
    const plan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(plan.writes.length).toBeGreaterThanOrEqual(4);
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".claude.json"))!;
    expect(JSON.parse(mcpWrite.afterContent).mcpServers["forge614-engram"]).toEqual({
      command: resolveEngramMcpServer(home).command,
      args: ["mcp"],
    });
    const hookWrite = plan.writes.find((w) => w.path === join(home, ".claude", "settings.json"))!;
    expect(hookWrite).toBeDefined();
    const written = JSON.parse(hookWrite.afterContent);
    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.SessionStart[0].hooks[0].type).toBe("command");
    expect(written.hooks.SessionStart[0].hooks[0].command).toContain("memory-hook-run --agent claude-code");

    expect(plan.metadata?.hook.status.kind).toBe("write"); // structural: the config entry itself is correct
    expect(plan.metadata?.hook.runtimeStatus?.kind).toBe("pending-runtime-verification"); // but not yet proven to run
    if (plan.metadata?.hook.runtimeStatus?.kind === "pending-runtime-verification") {
      expect(plan.metadata.hook.runtimeStatus.reason).toBe("no-evidence");
    }
    expect(plan.metadata?.overallStatus).toBe("partial");
  });

  test("claude-code reaches complete once a prior real hook execution left valid evidence", async () => {
    await recordHookEvidence(home, "claude-code", true);

    const plan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.hook.runtimeStatus?.kind).toBe("runtime-observed");
    expect(plan.metadata?.overallStatus).toBe("complete");
  });

  test("is partial for codex — a structurally-correct hook still reports needs-user-trust, never complete", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "codex", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.hook.status.kind).toBe("write"); // structural: the config entry itself is correct
    expect(plan.metadata?.hook.runtimeStatus?.kind).toBe("needs-user-trust");
    expect(plan.metadata?.overallStatus).toBe("partial");
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".codex", "config.toml"))!;
    expect(tomlConfigFormat.getMcpEntry(mcpWrite.afterContent, ["mcp_servers"], "forge614-engram")).toEqual({
      command: resolveEngramMcpServer(home).command,
      args: ["mcp"],
    });
    const configWrite = plan.writes.find((w) => w.path === join(home, ".codex", "config.toml"))!;
    expect(tomlConfigFormat.getValueAtPath(configWrite.afterContent, ["hooks", "SessionStart"])).toEqual([
      {
        matcher: "^(startup|resume|clear|compact)$",
        hooks: [{ type: "command", command: expect.stringContaining("memory-hook-run --agent codex"), additionalContextLimit: 4000 }],
      },
    ]);
  });

  test("codex reaches complete once evidence proves the real, user-approved hook executed and received context", async () => {
    await recordHookEvidence(home, "codex", true);

    const plan = await planMemoryInstall(registry, { agentId: "codex", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.hook.runtimeStatus?.kind).toBe("runtime-observed");
    expect(plan.metadata?.overallStatus).toBe("complete");
  });

  test("is still partial for cursor after this change: hook is unsupported same as instructions", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "cursor", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("partial");
    expect(plan.metadata?.instructions.status.kind).toBe("unsupported");
    expect(plan.metadata?.hook.status.kind).toBe("unsupported");
    expect(plan.metadata?.hook.runtimeStatus?.kind).toBe("unsupported");
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".cursor", "mcp.json"))!;
    expect(JSON.parse(mcpWrite.afterContent).mcpServers["forge614-engram"]).toEqual({
      command: resolveEngramMcpServer(home).command,
      args: ["mcp"],
    });
  });

  test("an install made before this feature existed (mcp + instructions only) picks up the hook on the next plan + apply, but still needs a real run to reach complete", async () => {
    const firstPlan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });
    for (const write of firstPlan.writes) {
      if (write.path === join(home, ".claude", "settings.json")) continue; // simulate: hook never existed
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    const secondPlan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });
    expect(secondPlan.metadata?.mcp.status.kind).toBe("noop");
    expect(secondPlan.metadata?.instructions.status.kind).toBe("noop");
    expect(secondPlan.metadata?.hook.status.kind).toBe("write");
    expect(secondPlan.metadata?.hook.runtimeStatus?.kind).toBe("pending-runtime-verification");
    expect(secondPlan.metadata?.overallStatus).toBe("partial");
  });

  test("recognizes a forge614-engram entry Forge614 Shell already installed at the canonical path (no false conflict)", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { "forge614-engram": { command: resolveEngramMcpServer(home).command, args: ["mcp"] } },
      }),
    );

    const plan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.mcp.status.kind).toBe("noop");
    expect(plan.writes.some((w) => w.path === join(home, ".claude.json"))).toBe(false);
  });

  test("still blocks as a real conflict when an entry has the same name but a genuinely different command", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/opt/some-other-tool", args: [] } } }),
    );

    const plan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.mcp.status.kind).toBe("blocked");
    expect(plan.writes.some((w) => w.path === join(home, ".claude.json"))).toBe(false);
  });

  test("is a noop end to end the second time nothing changed, but still partial without runtime evidence", async () => {
    const first = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });
    for (const write of first.writes) {
      // Mirror what applyPlan's atomicWrite does in production: ensure the parent
      // directory exists before writing (planMemoryInstall only plans, it never
      // creates directories itself).
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    const second = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(second.noop).toBe(true);
    expect(second.metadata?.overallStatus).toBe("partial"); // nothing to write, but still no execution evidence

    await recordHookEvidence(home, "claude-code", true);
    const third = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });
    expect(third.noop).toBe(true);
    expect(third.metadata?.overallStatus).toBe("complete");
  });

  test("throws EngramProtocolUnavailableError and writes nothing when Engram is not installed", async () => {
    writeFileSync(join(home, ".claude.json"), "{}");

    await expect(
      planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: { command: missingCommand, args: [] } }),
    ).rejects.toThrow(EngramProtocolUnavailableError);

    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe("{}");
  });

  test.skipIf(process.platform === "win32")(
    "works without protocolOptions when Engram is installed only at the canonical FORGE614_HOME path, no PATH needed",
    async () => {
      const canonicalPath = resolveEngramExecutable(home);
      mkdirSync(dirname(canonicalPath), { recursive: true });
      writeFileSync(canonicalPath, `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(PROTOCOL))});\n`);
      chmodSync(canonicalPath, 0o755);

      const plan = await planMemoryInstall(registry, { agentId: "claude-code", home });

      // The point of this test is that the canonical-path Engram lookup works
      // with no protocolOptions seam — not runtime evidence, which is covered
      // elsewhere. Structural presence is enough to prove that part.
      expect(plan.metadata?.hook.status.kind).toBe("write");
      expect(plan.metadata?.overallStatus).toBe("partial");
    },
  );

  test("throws EngramProtocolUnavailableError and writes nothing when no protocolOptions is given and the canonical binary is absent", async () => {
    writeFileSync(join(home, ".claude.json"), "{}");

    await expect(planMemoryInstall(registry, { agentId: "claude-code", home })).rejects.toThrow(
      EngramProtocolUnavailableError,
    );

    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe("{}");
  });
});
