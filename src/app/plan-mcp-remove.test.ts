import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { planMcpRemove, UnrecognizedEntryError } from "./plan-mcp-remove";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planremove-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMcpRemove", () => {
  test("removes exactly the entry it recognizes as its own", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/bin/engram", args: ["mcp"] } } }),
    );

    const plan = await planMcpRemove(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(false);
    const parsed = JSON.parse(plan.writes[0].afterContent);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers?.["forge614-engram"]).toBeUndefined();
  });

  test("is a noop when the entry is already absent", async () => {
    writeFileSync(join(home, ".claude.json"), "{}");

    const plan = await planMcpRemove(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(true);
  });

  test("refuses to remove an entry that does not match what it would have installed", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/some/other/path" } } }),
    );

    await expect(
      planMcpRemove(registry, {
        agentId: "claude-code",
        home,
        server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
      }),
    ).rejects.toThrow(UnrecognizedEntryError);
  });
});
