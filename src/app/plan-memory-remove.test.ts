import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { planMemoryInstall } from "./plan-memory-install";
import { planMemoryRemove } from "./plan-memory-remove";

let home: string;
let registry: AgentRegistry;

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
  home = mkdtempSync(join(tmpdir(), "engines-planmemoryremove-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(cursorAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMemoryRemove", () => {
  test("is a noop when nothing was ever installed", async () => {
    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });
    expect(plan.noop).toBe(true);
    expect(plan.metadata?.overallStatus).toBe("complete");
  });

  test("removes a full prior install and needs no Engram executable at all", async () => {
    const script = join(home, "engram.js");
    writeFileSync(script, PROTOCOL_SCRIPT_CONTENT);
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      // Mirror what applyPlan's atomicWrite does in production: ensure the parent
      // directory exists before writing (planMemoryInstall only plans, it never
      // creates directories itself). See plan-memory-install.test.ts for the same pattern.
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });

    expect(plan.noop).toBe(false);
    const claudeMdWrite = plan.writes.find((w) => w.path === join(home, ".claude.json"))!;
    expect(JSON.parse(claudeMdWrite.afterContent).mcpServers?.engram).toBeUndefined();
    const contentWrite = plan.writes.find((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))!;
    expect(contentWrite.delete).toBe(true);
  });

  test("blocks the mcp component as data (not a thrown error) when the entry is unrecognized", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { engram: { command: "/something/else" } } }));

    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });

    expect(plan.metadata?.mcp.status.kind).toBe("blocked");
    expect(plan.writes.some((w) => w.path === join(home, ".claude.json"))).toBe(false);
  });

  test("cursor's instructions component is unsupported, mcp still removes", async () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { engram: { command: "forge614-engram", args: ["mcp"] } } }));

    const plan = await planMemoryRemove(registry, { agentId: "cursor", home });

    expect(plan.metadata?.instructions.status.kind).toBe("unsupported");
    expect(plan.writes.some((w) => w.path === join(home, ".cursor", "mcp.json"))).toBe(true);
  });
});
