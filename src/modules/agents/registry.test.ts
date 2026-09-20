import { describe, expect, test } from "bun:test";
import { AgentRegistry, DuplicateAgentError, InvalidCapabilityManifestError } from "./registry";
import type { AgentAdapter } from "./types";

function fakeAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    id: "claude-code",
    label: "Fake",
    capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false },
    configFormat: "json",
    mcpEntryPath: ["mcpServers"],
    candidateExecutableNames: () => ["fake"],
    knownInstallPaths: () => [],
    configDir: (home) => `${home}/.fake`,
    configFile: (home) => `${home}/.fake.json`,
    mcpEntryShape: (server) => ({ command: server.command, args: server.args }),
    ...overrides,
  };
}

describe("AgentRegistry", () => {
  test("registers and retrieves a valid adapter", () => {
    const registry = new AgentRegistry();
    registry.register(fakeAdapter());
    expect(registry.get("claude-code")?.label).toBe("Fake");
    expect(registry.list()).toHaveLength(1);
  });

  test("rejects duplicate registration", () => {
    const registry = new AgentRegistry();
    registry.register(fakeAdapter());
    expect(() => registry.register(fakeAdapter())).toThrow(DuplicateAgentError);
  });

  test("rejects an adapter claiming headless support without headlessCommand", () => {
    const registry = new AgentRegistry();
    const adapter = fakeAdapter({
      capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: true },
    });
    expect(() => registry.register(adapter)).toThrow(InvalidCapabilityManifestError);
  });

  test("rejects an adapter claiming MCP support with an empty mcpEntryPath", () => {
    const registry = new AgentRegistry();
    const adapter = fakeAdapter({ mcpEntryPath: [] });
    expect(() => registry.register(adapter)).toThrow(InvalidCapabilityManifestError);
  });
});
