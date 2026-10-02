import { describe, expect, test } from "bun:test";
import { AgentRegistry, InvalidCapabilityManifestError } from "./registry";
import type { AgentAdapter, ReasoningLevel } from "./types";

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

describe("validateCapabilityManifest — reasoning levels", () => {
  /** Adapter with no other capability, so only the reasoning-level rules of the manifest are exercised. */
  const withLevels = (supportsReasoningLevel: boolean, reasoningLevels?: readonly ReasoningLevel[]): AgentAdapter =>
    baseAdapter({
      capabilities: { supportsMcp: false, supportsHooks: false, supportsHeadlessExec: false, supportsReasoningLevel },
      reasoningLevels,
    });

  test("rejects supportsReasoningLevel: true with no reasoningLevels list", () => {
    expect(() => new AgentRegistry().register(withLevels(true))).toThrow(
      "Invalid capability manifest for claude-code: supportsReasoningLevel is true but reasoningLevels is missing or empty",
    );
  });

  test("rejects supportsReasoningLevel: true with an empty reasoningLevels list", () => {
    expect(() => new AgentRegistry().register(withLevels(true, []))).toThrow(
      "Invalid capability manifest for claude-code: supportsReasoningLevel is true but reasoningLevels is missing or empty",
    );
  });

  test("rejects a reasoningLevels list holding a value outside REASONING_LEVELS", () => {
    expect(() => new AgentRegistry().register(withLevels(true, ["low", "banana" as ReasoningLevel]))).toThrow(
      'Invalid capability manifest for claude-code: reasoningLevels contains "banana", which is not one of low, medium, high, xhigh, max',
    );
  });

  test("rejects a reasoningLevels list declared with supportsReasoningLevel: false", () => {
    expect(() => new AgentRegistry().register(withLevels(false, ["low"]))).toThrow(
      "Invalid capability manifest for claude-code: reasoningLevels is declared but supportsReasoningLevel is false",
    );
  });

  test("accepts a subset of the levels, and no list at all when the agent cannot choose a level", () => {
    expect(() => new AgentRegistry().register(withLevels(true, ["low", "medium"]))).not.toThrow();
    expect(() => new AgentRegistry().register(withLevels(false))).not.toThrow();
  });
});
