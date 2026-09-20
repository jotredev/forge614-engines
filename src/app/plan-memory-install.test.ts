import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { EngramProtocolUnavailableError } from "../infrastructure/engram/memory-protocol-client";
import { planMemoryInstall } from "./plan-memory-install";

let home: string;
let registry: AgentRegistry;
let okScript: string;
let missingCommand: string;

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
});

const protocolOptions = () => ({ command: process.execPath, args: [okScript] });

describe("planMemoryInstall", () => {
  test("is complete for claude-code: installs the MCP entry and the instructions block", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("complete");
    expect(plan.writes.length).toBeGreaterThanOrEqual(3);
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".claude.json"))!;
    expect(JSON.parse(mcpWrite.afterContent).mcpServers.engram).toEqual({ command: "forge614-engram", args: ["mcp"] });
  });

  test("is partial for cursor: mcp installs, instructions are unsupported", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "cursor", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("partial");
    expect(plan.metadata?.instructions.status.kind).toBe("unsupported");
    expect(plan.writes.some((w) => w.path === join(home, ".cursor", "mcp.json"))).toBe(true);
  });

  test("is a noop end to end the second time nothing changed", async () => {
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
    expect(second.metadata?.overallStatus).toBe("complete");
  });

  test("throws EngramProtocolUnavailableError and writes nothing when Engram is not installed", async () => {
    writeFileSync(join(home, ".claude.json"), "{}");

    await expect(
      planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: { command: missingCommand, args: [] } }),
    ).rejects.toThrow(EngramProtocolUnavailableError);

    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe("{}");
  });
});
