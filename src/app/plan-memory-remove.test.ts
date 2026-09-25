import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { planMemoryRemove } from "./plan-memory-remove";

let home: string;
let registry: AgentRegistry;
let previousForgeHome: string | undefined;

// Argv-aware, like the real forge614-engram 1.7.0+: answers --protocol-version 4 with a v4
// payload, and anything else (including no flag at all) with v1 — see memory-protocol-client.ts.
const PROTOCOL_SCRIPT_CONTENT = [
  "const args = process.argv.slice(2);",
  'const idx = args.indexOf("--protocol-version");',
  'if (idx !== -1 && args[idx + 1] === "4") {',
  `  console.log(${JSON.stringify(
    JSON.stringify({
      id: "forge614-engram-memory",
      version: 4,
      instructions: "Call memory_context.",
      mcpInstructions: "Call memory_context.",
      startupContext: { command: "x", format: 2, description: "d" },
    }),
  )});`,
  "} else {",
  `  console.log(${JSON.stringify(
    JSON.stringify({
      id: "forge614-engram-memory",
      version: 1,
      instructions: "Call memory_context.",
      lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
      scopes: { shared: "s", project: "p" },
      security: { neverSave: ["passwords"] },
    }),
  )});`,
  "}",
].join("\n");

beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  delete process.env.FORGE614_HOME;
  home = mkdtempSync(join(tmpdir(), "engines-planmemoryremove-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(cursorAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME;
  else process.env.FORGE614_HOME = previousForgeHome;
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
    expect(JSON.parse(claudeMdWrite.afterContent).mcpServers?.["forge614-engram"]).toBeUndefined();
    // D5: Claude Code embeds the manual directly now, so removal is a single CLAUDE.md
    // block-strip — no satellite file to delete (see instructions-write-decision.test.ts for
    // the legacy-satellite migration/removal cleanup path).
    expect(plan.writes.some((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))).toBe(false);
  });

  test("blocks the mcp component as data (not a thrown error) when the entry is unrecognized", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/something/else" } } }),
    );

    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });

    expect(plan.metadata?.mcp.status.kind).toBe("blocked");
    expect(plan.writes.some((w) => w.path === join(home, ".claude.json"))).toBe(false);
  });

  test("cursor's instructions component is unsupported, mcp still removes", async () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: resolveEngramMcpServer(home).command, args: ["mcp"] } } }),
    );

    const plan = await planMemoryRemove(registry, { agentId: "cursor", home });

    expect(plan.metadata?.instructions.status.kind).toBe("unsupported");
    expect(plan.metadata?.hook.status.kind).toBe("unsupported");
    expect(plan.writes.some((w) => w.path === join(home, ".cursor", "mcp.json"))).toBe(true);
    // Cursor structurally has no instructions to remove, so removing its MCP entry is the whole job.
    expect(plan.metadata?.overallStatus).toBe("complete");
  });

  test("removes only Forge614's own hook entry, preserving a foreign one already in the file", async () => {
    const script = join(home, "engram.js");
    writeFileSync(script, PROTOCOL_SCRIPT_CONTENT);
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }
    const hookConfigPath = join(home, ".claude", "settings.json");
    const before = JSON.parse(readFileSync(hookConfigPath, "utf8"));
    const foreign = { matcher: "startup", hooks: [{ type: "command", command: "/opt/some-other-tool" }] };
    before.hooks.SessionStart.push(foreign);
    writeFileSync(hookConfigPath, JSON.stringify(before));

    const removePlan = await planMemoryRemove(registry, { agentId: "claude-code", home });
    for (const write of removePlan.writes) {
      if (write.delete) rmSync(write.path, { force: true });
      else {
        mkdirSync(dirname(write.path), { recursive: true });
        writeFileSync(write.path, write.afterContent);
      }
    }

    const after = JSON.parse(readFileSync(hookConfigPath, "utf8"));
    expect(after.hooks.SessionStart).toEqual([foreign]);
  });

  test("removal never reports needs-user-trust — trust concerns whether Codex runs a hook, not whether Engines can delete it", async () => {
    const script = join(home, "engram.js");
    writeFileSync(script, PROTOCOL_SCRIPT_CONTENT);
    const installed = await planMemoryInstall(registry, {
      agentId: "codex",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }

    const removePlan = await planMemoryRemove(registry, { agentId: "codex", home });
    expect(removePlan.metadata?.hook.status.kind).toBe("write");
    // Only one physical write to the shared config.toml, and it reflects both
    // removals — same shallow-delete convention as MCP removal already uses
    // (the now-empty mcp_servers/hooks tables are left behind, only their
    // forge614-owned leaf entries are gone).
    const configWrites = removePlan.writes.filter((w) => w.path === join(home, ".codex", "config.toml"));
    expect(configWrites).toHaveLength(1);
    const { tomlConfigFormat } = await import("../infrastructure/config-io/toml-format");
    expect(tomlConfigFormat.getMcpEntry(configWrites[0]!.afterContent, ["mcp_servers"], "forge614-engram")).toBeUndefined();
    expect(tomlConfigFormat.getValueAtPath(configWrites[0]!.afterContent, ["hooks", "SessionStart"])).toBeUndefined();
  });

  // Scenario 8: removal deletes or invalidates only this agent's own evidence.
  test("removal deletes this agent's own execution evidence", async () => {
    const script = join(home, "engram.js");
    writeFileSync(script, PROTOCOL_SCRIPT_CONTENT);
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }
    await recordHookEvidence(home, "claude-code", true);
    expect(existsSync(resolveHookEvidencePath(home, "claude-code"))).toBe(true);

    const removePlan = await planMemoryRemove(registry, { agentId: "claude-code", home });
    const evidenceWrite = removePlan.writes.find((w) => w.path === resolveHookEvidencePath(home, "claude-code"));
    expect(evidenceWrite).toBeDefined();
    expect(evidenceWrite!.delete).toBe(true);

    for (const write of removePlan.writes) {
      if (write.delete) rmSync(write.path, { force: true });
      else {
        mkdirSync(dirname(write.path), { recursive: true });
        writeFileSync(write.path, write.afterContent);
      }
    }
    expect(existsSync(resolveHookEvidencePath(home, "claude-code"))).toBe(false);
  });

  test("removal never touches a different agent's evidence", async () => {
    const script = join(home, "engram.js");
    writeFileSync(script, PROTOCOL_SCRIPT_CONTENT);
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) {
      mkdirSync(dirname(write.path), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }
    await recordHookEvidence(home, "claude-code", true);
    await recordHookEvidence(home, "codex", true);

    const removePlan = await planMemoryRemove(registry, { agentId: "claude-code", home });
    expect(removePlan.writes.some((w) => w.path === resolveHookEvidencePath(home, "codex"))).toBe(false);

    for (const write of removePlan.writes) {
      if (write.delete) rmSync(write.path, { force: true });
      else {
        mkdirSync(dirname(write.path), { recursive: true });
        writeFileSync(write.path, write.afterContent);
      }
    }
    expect(existsSync(resolveHookEvidencePath(home, "codex"))).toBe(true);
  });

  test("removal is a noop for evidence when none was ever recorded", async () => {
    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });
    expect(plan.writes.some((w) => w.path === resolveHookEvidencePath(home, "claude-code"))).toBe(false);
  });
});
