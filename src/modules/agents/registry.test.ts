import { describe, expect, test } from "bun:test";
import { AgentRegistry, InvalidCapabilityManifestError } from "./registry";
import type { AgentAdapter, ReasoningLevel } from "./types";

function baseAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    id: "claude-code",
    label: "Test Agent",
    capabilities: {
      supportsMcp: false,
      supportsHooks: false,
      supportsHeadlessExec: false,
      supportsReasoningLevel: false,
      supportsReadOnly: false,
    },
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
      capabilities: {
        supportsMcp: false,
        supportsHooks: true,
        supportsHeadlessExec: false,
        supportsReasoningLevel: false,
        supportsReadOnly: false,
      },
    });
    expect(() => registry.register(adapter)).toThrow(InvalidCapabilityManifestError);
  });

  test("accepts supportsHooks: true with a hooks target implemented", () => {
    const registry = new AgentRegistry();
    const adapter = baseAdapter({
      capabilities: {
        supportsMcp: false,
        supportsHooks: true,
        supportsHeadlessExec: false,
        supportsReasoningLevel: false,
        supportsReadOnly: false,
      },
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
      capabilities: {
        supportsMcp: false,
        supportsHooks: false,
        supportsHeadlessExec: false,
        supportsReasoningLevel,
        supportsReadOnly: false,
      },
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

describe("validateCapabilityManifest — read-only", () => {
  /** Adapter with no other capability, so only the read-only rule of the manifest is exercised. */
  const withReadOnly = (supportsReadOnly: boolean, supportsHeadlessExec: boolean): AgentAdapter =>
    baseAdapter({
      capabilities: {
        supportsMcp: false,
        supportsHooks: false,
        supportsHeadlessExec,
        supportsReasoningLevel: false,
        supportsReadOnly,
      },
      headlessCommand: supportsHeadlessExec
        ? (executable, opts) => ({ command: executable, args: [opts.prompt] })
        : undefined,
    });

  test("rejects supportsReadOnly: true with supportsHeadlessExec: false", () => {
    expect(() => new AgentRegistry().register(withReadOnly(true, false))).toThrow(
      "Invalid capability manifest for claude-code: supportsReadOnly is true but supportsHeadlessExec is false",
    );
  });

  test("accepts supportsReadOnly: true with headless execution, and false with or without it", () => {
    expect(() => new AgentRegistry().register(withReadOnly(true, true))).not.toThrow();
    expect(() => new AgentRegistry().register(withReadOnly(false, true))).not.toThrow();
    expect(() => new AgentRegistry().register(withReadOnly(false, false))).not.toThrow();
  });
});
