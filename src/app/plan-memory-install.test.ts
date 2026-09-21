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
  test("is complete for claude-code: installs the MCP entry and the instructions block", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("complete");
    expect(plan.writes.length).toBeGreaterThanOrEqual(3);
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".claude.json"))!;
    expect(JSON.parse(mcpWrite.afterContent).mcpServers["forge614-engram"]).toEqual({
      command: resolveEngramMcpServer(home).command,
      args: ["mcp"],
    });
  });

  test("is complete for codex: installs the MCP entry under the canonical name", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "codex", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("complete");
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".codex", "config.toml"))!;
    expect(tomlConfigFormat.getMcpEntry(mcpWrite.afterContent, ["mcp_servers"], "forge614-engram")).toEqual({
      command: resolveEngramMcpServer(home).command,
      args: ["mcp"],
    });
  });

  test("is partial for cursor: mcp installs under the canonical name, instructions are unsupported", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "cursor", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("partial");
    expect(plan.metadata?.instructions.status.kind).toBe("unsupported");
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".cursor", "mcp.json"))!;
    expect(JSON.parse(mcpWrite.afterContent).mcpServers["forge614-engram"]).toEqual({
      command: resolveEngramMcpServer(home).command,
      args: ["mcp"],
    });
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

  test.skipIf(process.platform === "win32")(
    "works without protocolOptions when Engram is installed only at the canonical FORGE614_HOME path, no PATH needed",
    async () => {
      const canonicalPath = resolveEngramExecutable(home);
      mkdirSync(dirname(canonicalPath), { recursive: true });
      writeFileSync(canonicalPath, `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(PROTOCOL))});\n`);
      chmodSync(canonicalPath, 0o755);

      const plan = await planMemoryInstall(registry, { agentId: "claude-code", home });

      expect(plan.metadata?.overallStatus).toBe("complete");
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
