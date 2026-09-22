import { describe, expect, test } from "bun:test";
import { AgentRegistry, InvalidCapabilityManifestError } from "./registry";
import type { AgentAdapter } from "./types";

function baseAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    id: "claude-code",
    label: "Test Agent",
    capabilities: { supportsMcp: false, supportsHooks: false, supportsHeadlessExec: false, supportsReasoningLevel: false },
    configFormat: "json",
    mcpEntryPath: [],
    candidateExecutableNames: () => [],
    knownInstallPaths: () => [],
    configDir: (home) => home,
    configFile: (home) => home,
    mcpEntryShape: () => ({}),
    ...overrides,
  };
}

describe("validateCapabilityManifest — hooks", () => {
  test("rejects supportsHooks: true with no hooks target implemented", () => {
    const registry = new AgentRegistry();
    const adapter = baseAdapter({
      capabilities: { supportsMcp: false, supportsHooks: true, supportsHeadlessExec: false, supportsReasoningLevel: false },
    });
    expect(() => registry.register(adapter)).toThrow(InvalidCapabilityManifestError);
  });

  test("accepts supportsHooks: true with a hooks target implemented", () => {
    const registry = new AgentRegistry();
    const adapter = baseAdapter({
      capabilities: { supportsMcp: false, supportsHooks: true, supportsHeadlessExec: false, supportsReasoningLevel: false },
      hooks: {
        configFile: (home) => home,
        configFormat: "json",
        entryPath: ["hooks", "SessionStart"],
        entryShape: (command) => ({ hooks: [{ type: "command", command }] }),
        requiresUserTrust: false,
      },
    });
    expect(() => registry.register(adapter)).not.toThrow();
  });
});
