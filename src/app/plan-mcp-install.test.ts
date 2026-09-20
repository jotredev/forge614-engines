import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { ConfigConflictError } from "../modules/config-writer/types";
import { planMcpInstall } from "./plan-mcp-install";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planinstall-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMcpInstall", () => {
  test("adds a new MCP entry, preserving unrelated existing content", async () => {
    writeFileSync(join(home, ".claude.json"), '{"other":true}');

    const plan = await planMcpInstall(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(false);
    expect(plan.writes).toHaveLength(1);
    const parsed = JSON.parse(plan.writes[0].afterContent);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers["forge614-engram"]).toEqual({ command: "/bin/engram", args: ["mcp"] });
  });

  test("is a noop when the exact same entry is already installed", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/bin/engram", args: ["mcp"] } } }),
    );

    const plan = await planMcpInstall(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });

  test("throws ConfigConflictError when a different entry already uses that name", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/other/path" } } }),
    );

    await expect(
      planMcpInstall(registry, {
        agentId: "claude-code",
        home,
        server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
      }),
    ).rejects.toThrow(ConfigConflictError);
  });
});
