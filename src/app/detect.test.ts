import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { detectAgents } from "./detect";
import type { AgentAdapter } from "../modules/agents/types";

function fakeAdapter(id: AgentAdapter["id"]): AgentAdapter {
  return {
    id,
    label: id,
    capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false, supportsReasoningLevel: false },
    configFormat: "json",
    mcpEntryPath: ["mcpServers"],
    candidateExecutableNames: () => [],
    knownInstallPaths: () => [],
    configDir: (h) => `${h}/.${id}`,
    configFile: (h) => `${h}/.${id}.json`,
    mcpEntryShape: (server) => ({ command: server.command, args: server.args }),
  };
}

describe("detectAgents", () => {
  test("runs detection for every registered adapter", async () => {
    const registry = new AgentRegistry();
    registry.register(fakeAdapter("claude-code"));
    registry.register(fakeAdapter("codex"));

    const results = await detectAgents(registry, "/home/u", { PATH: "" }, "darwin");
    expect(results.map((r) => r.id).sort()).toEqual(["claude-code", "codex"]);
  });
});
