import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
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

describe("verifyMemoryIntegration", () => {
  test("reports absent for both components when nothing is installed", async () => {
    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });
    expect(result.mcp.present).toBe(false);
    expect(result.instructions.present).toBe(false);
    expect(result.overallStatus).toBe("absent");
  });

  test("reports complete after a real install for claude-code", async () => {
    const script = join(home, "engram.js");
    writeFileSync(
      script,
      `console.log(${JSON.stringify(
        JSON.stringify({
          id: "forge614-engram-memory",
          version: 1,
          instructions: "Call memory_context.",
          lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
          scopes: { shared: "s", project: "p" },
          security: { neverSave: ["passwords"] },
        }),
      )});`,
    );
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      // Mirror what applyPlan's atomicWrite does in production: ensure the parent
      // directory exists before writing (planMemoryInstall only plans, it never
      // creates directories itself).
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.mcp.present).toBe(true);
    expect(result.instructions.present).toBe(true);
    expect(result.hook.present).toBe(true);
    expect(result.hook.dryRunOk).toBe(true);
    expect(result.hook.trustPending).toBe(false);
    expect(result.overallStatus).toBe("complete");
  });

  test("never reports complete when mcp and instructions are installed but the hook is missing", async () => {
    const script = join(home, "engram.js");
    writeFileSync(
      script,
      `console.log(${JSON.stringify(
        JSON.stringify({
          id: "forge614-engram-memory",
          version: 1,
          instructions: "Call memory_context.",
          lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
          scopes: { shared: "s", project: "p" },
          security: { neverSave: ["passwords"] },
        }),
      )});`,
    );
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      if (write.path === join(home, ".claude", "settings.json")) continue; // simulate a pre-hook-feature install
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.present).toBe(false);
    expect(result.overallStatus).toBe("partial");
  });

  test("never reports complete for codex — a working, present hook still shows trustPending, so overall stays partial", async () => {
    const script = join(home, "engram.js");
    writeFileSync(
      script,
      `console.log(${JSON.stringify(
        JSON.stringify({
          id: "forge614-engram-memory",
          version: 1,
          instructions: "Call memory_context.",
          lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
          scopes: { shared: "s", project: "p" },
          security: { neverSave: ["passwords"] },
        }),
      )});`,
    );
    const installed = await planMemoryInstall(registry, {
      agentId: "codex",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    const result = await verifyMemoryIntegration(registry, { agentId: "codex", home, startupContextOptions: startupContextOptions() });

    expect(result.hook.present).toBe(true);
    expect(result.hook.dryRunOk).toBe(true);
    expect(result.hook.trustPending).toBe(true);
    expect(result.overallStatus).toBe("partial");
  });

  test("hook is reported unsupported (not absent/blocked) for cursor", async () => {
    const result = await verifyMemoryIntegration(registry, { agentId: "cursor", home });
    expect(result.hook.supported).toBe(false);
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
    // Cursor structurally cannot have instructions installed, so a present MCP entry is the complete achievable state for this agent.
    expect(result.overallStatus).toBe("complete");
  });

  test("reports instructions absent when the satellite content file is missing, even though CLAUDE.md still references it", async () => {
    const script = join(home, "engram.js");
    writeFileSync(
      script,
      `console.log(${JSON.stringify(
        JSON.stringify({
          id: "forge614-engram-memory",
          version: 1,
          instructions: "Call memory_context.",
          lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
          scopes: { shared: "s", project: "p" },
          security: { neverSave: ["passwords"] },
        }),
      )});`,
    );
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    rmSync(join(home, ".claude", "forge614-engram-memory-protocol.md"));

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });

    expect(result.instructions.present).toBe(false);
    expect(result.overallStatus).toBe("partial");
  });
});
