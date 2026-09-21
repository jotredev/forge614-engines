import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { planMemoryInstall } from "./plan-memory-install";
import { verifyMemoryIntegration } from "./verify-memory-integration";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-verifymemory-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(cursorAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

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

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });

    expect(result.mcp.present).toBe(true);
    expect(result.instructions.present).toBe(true);
    expect(result.overallStatus).toBe("complete");
  });

  test("cursor's instructions are always reported unsupported", async () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "forge614-engram", args: ["mcp"] } } }),
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
