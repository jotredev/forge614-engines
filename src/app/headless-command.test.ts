import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { MCP_ONLY_ID, mcpOnlyAdapter } from "../../tests/support/mcp-only-adapter";
import type { AgentAdapter, ReasoningLevel } from "../modules/agents/types";
import {
  InvalidReasoningLevelError,
  REASONING_LEVELS,
  ReadOnlyUnsupportedError,
  ReasoningLevelUnsupportedError,
} from "../modules/agents/types";
import { HeadlessUnsupportedError, headlessCommandFor } from "./headless-command";

/**
 * Fictional agent with headless execution whose levels are decided by the test. `levels` undefined means the
 * agent cannot choose a level; a list means it accepts exactly those. `supportsReadOnly` is false unless the
 * test says otherwise. Its command just echoes the level.
 */
function headlessAdapter(
  supportsReasoningLevel: boolean,
  levels?: readonly ReasoningLevel[],
  supportsReadOnly = false,
): AgentAdapter {
  return {
    id: MCP_ONLY_ID,
    label: "Headless test agent",
    capabilities: {
      supportsMcp: false,
      supportsHooks: false,
      supportsHeadlessExec: true,
      supportsReasoningLevel,
      supportsReadOnly,
    },
    reasoningLevels: levels,
    configFormat: "json",
    mcpEntryPath: [],
    candidateExecutableNames: () => [],
    knownInstallPaths: () => [],
    configDir: (home) => home,
    configFile: (home) => home,
    mcpEntryShape: () => ({}),
    headlessCommand: (executable, opts) => ({ command: executable, args: [opts.prompt, `level=${opts.reasoningLevel}`] }),
  };
}

describe("headlessCommandFor", () => {
  test("returns the adapter's headless command for a supported agent", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(headlessCommandFor(registry, "claude-code", "/bin/claude", "hello")).toEqual({
      command: "/bin/claude",
      args: ["-p", "hello"],
    });
  });

  test("forwards an optional timeoutMs to the adapter", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(headlessCommandFor(registry, "claude-code", "/bin/claude", "hello", 5000)).toEqual({
      command: "/bin/claude",
      args: ["-p", "hello"],
    });
  });

  test("forwards an optional model and reasoningLevel to the adapter", () => {
    const registry = new AgentRegistry();
    registry.register(codexAdapter);

    expect(headlessCommandFor(registry, "codex", "/bin/codex", "hello", undefined, "gpt-5-codex", "medium")).toEqual({
      command: "/bin/codex",
      args: ["exec", "--model", "gpt-5-codex", "-c", "model_reasoning_effort=medium", "hello"],
    });
  });

  test("throws ReasoningLevelUnsupportedError for an agent that cannot choose a reasoning level", () => {
    const registry = new AgentRegistry();
    registry.register(headlessAdapter(false));

    expect(() =>
      headlessCommandFor(registry, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, "high"),
    ).toThrow(ReasoningLevelUnsupportedError);
  });

  test("forwards an optional stdinPrompt to the adapter", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(
      headlessCommandFor(registry, "claude-code", "/bin/claude", "hello", undefined, undefined, undefined, true),
    ).toEqual({ command: "/bin/claude", args: ["-p"], stdin: true });
  });

  test("forwards an optional readableDir to claude-code's args, before -p", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(
      headlessCommandFor(
        registry,
        "claude-code",
        "/bin/claude",
        "hello",
        undefined,
        undefined,
        undefined,
        undefined,
        "/tmp/project",
      ),
    ).toEqual({ command: "/bin/claude", args: ["--add-dir", "/tmp/project", "-p", "hello"] });
  });

  test("forwards an optional readableDir to codex's args, before the prompt", () => {
    const registry = new AgentRegistry();
    registry.register(codexAdapter);

    expect(
      headlessCommandFor(
        registry,
        "codex",
        "/bin/codex",
        "hello",
        undefined,
        undefined,
        undefined,
        undefined,
        "/tmp/project",
      ),
    ).toEqual({ command: "/bin/codex", args: ["exec", "--add-dir", "/tmp/project", "hello"] });
  });

  test("throws HeadlessUnsupportedError for an agent that does not support headless exec", () => {
    const registry = new AgentRegistry();
    registry.register(mcpOnlyAdapter);

    expect(() => headlessCommandFor(registry, MCP_ONLY_ID, "/bin/mcp-only", "hello")).toThrow(HeadlessUnsupportedError);
  });

  test("throws for an unregistered agent", () => {
    const registry = new AgentRegistry();
    expect(() => headlessCommandFor(registry, "codex", "/bin/codex", "hello")).toThrow("Unknown agent: codex");
  });

  test("rejects reasoningLevel based solely on capabilities.supportsReasoningLevel, even when the adapter's own headlessCommand doesn't guard against it", () => {
    const registry = new AgentRegistry();
    const noGuardAdapter: AgentAdapter = {
      id: MCP_ONLY_ID,
      label: "No-guard test adapter",
      capabilities: {
        supportsMcp: false,
        supportsHooks: false,
        supportsHeadlessExec: true,
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
      headlessCommand: (executable, opts) => ({ command: executable, args: [opts.prompt] }),
    };
    registry.register(noGuardAdapter);

    expect(() =>
      headlessCommandFor(registry, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, "high"),
    ).toThrow(ReasoningLevelUnsupportedError);
  });
});

describe("headlessCommandFor — reasoning level validation", () => {
  test("sends each of the five levels to claude-code as --effort", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    for (const level of REASONING_LEVELS) {
      expect(headlessCommandFor(registry, "claude-code", "/bin/claude", "hello", undefined, undefined, level)).toEqual({
        command: "/bin/claude",
        args: ["-p", "hello", "--effort", level],
      });
    }
  });

  test("sends each of the five levels to codex as a config override", () => {
    const registry = new AgentRegistry();
    registry.register(codexAdapter);

    for (const level of REASONING_LEVELS) {
      expect(headlessCommandFor(registry, "codex", "/bin/codex", "hello", undefined, undefined, level)).toEqual({
        command: "/bin/codex",
        args: ["exec", "-c", `model_reasoning_effort=${level}`, "hello"],
      });
    }
  });

  test('rejects "banana" and "minimal" with the exact message, for claude-code and codex', () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);
    registry.register(codexAdapter);

    for (const [agentId, executable] of [
      ["claude-code", "/bin/claude"],
      ["codex", "/bin/codex"],
    ] as const) {
      for (const level of ["banana", "minimal"]) {
        const call = () =>
          headlessCommandFor(registry, agentId, executable, "hello", undefined, undefined, level as ReasoningLevel);
        expect(call).toThrow(InvalidReasoningLevelError);
        expect(call).toThrow(
          `"${level}" is not a valid reasoning level for ${agentId}; valid levels: low, medium, high, xhigh, max`,
        );
      }
    }
  });

  test("rejects a level outside the adapter's own list, naming that list in the message", () => {
    const registry = new AgentRegistry();
    registry.register(headlessAdapter(true, ["low", "medium"]));

    expect(headlessCommandFor(registry, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, "medium")).toEqual({
      command: "/bin/fake",
      args: ["hello", "level=medium"],
    });
    expect(() =>
      headlessCommandFor(registry, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, "high"),
    ).toThrow(`"high" is not a valid reasoning level for ${MCP_ONLY_ID}; valid levels: low, medium`);
  });

  test("an agent that cannot choose a level throws ReasoningLevelUnsupportedError even when the level is invalid", () => {
    const registry = new AgentRegistry();
    registry.register(headlessAdapter(false));

    const call = () =>
      headlessCommandFor(registry, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, "banana" as ReasoningLevel);
    expect(call).toThrow(ReasoningLevelUnsupportedError);
    expect(call).not.toThrow(InvalidReasoningLevelError);
  });

  test("checks in order: unknown agent, no headless, cannot choose a level, then invalid level", () => {
    const banana = "banana" as ReasoningLevel;

    // 1. Unknown agent wins over everything else.
    expect(() =>
      headlessCommandFor(new AgentRegistry(), "codex", "/bin/codex", "hello", undefined, undefined, banana),
    ).toThrow("Unknown agent: codex");

    // 2. An agent without headless execution fails with HEADLESS_UNSUPPORTED before looking at the level.
    const noHeadless = new AgentRegistry();
    noHeadless.register(mcpOnlyAdapter);
    expect(() => headlessCommandFor(noHeadless, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, banana)).toThrow(
      HeadlessUnsupportedError,
    );

    // 3. An agent that cannot choose a level fails with REASONING_LEVEL_UNSUPPORTED before validating the value.
    const noLevel = new AgentRegistry();
    noLevel.register(headlessAdapter(false));
    expect(() => headlessCommandFor(noLevel, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, banana)).toThrow(
      ReasoningLevelUnsupportedError,
    );

    // 4. Only then is the value itself validated.
    const withLevel = new AgentRegistry();
    withLevel.register(headlessAdapter(true, ["low"]));
    expect(() => headlessCommandFor(withLevel, MCP_ONLY_ID, "/bin/fake", "hello", undefined, undefined, banana)).toThrow(
      InvalidReasoningLevelError,
    );
  });
});

describe("headlessCommandFor — read-only", () => {
  const banana = "banana" as ReasoningLevel;

  /** Calls headlessCommandFor() with only the options these cases care about. */
  function build(registry: AgentRegistry, agentId: string, reasoningLevel?: ReasoningLevel, readOnly?: boolean) {
    return headlessCommandFor(
      registry,
      agentId as "claude-code",
      "/bin/fake",
      "hello",
      undefined,
      undefined,
      reasoningLevel,
      undefined,
      undefined,
      readOnly,
    );
  }

  test("an agent that cannot guarantee read-only execution throws ReadOnlyUnsupportedError with the exact message", () => {
    const registry = new AgentRegistry();
    registry.register(headlessAdapter(false));

    const call = () => build(registry, MCP_ONLY_ID, undefined, true);
    expect(call).toThrow(ReadOnlyUnsupportedError);
    expect(call).toThrow(`${MCP_ONLY_ID} cannot guarantee read-only execution`);
  });

  test("the same agent still builds its command when readOnly is not requested", () => {
    const registry = new AgentRegistry();
    registry.register(headlessAdapter(false));

    expect(build(registry, MCP_ONLY_ID)).toEqual({ command: "/bin/fake", args: ["hello", "level=undefined"] });
    expect(build(registry, MCP_ONLY_ID, undefined, false)).toEqual({
      command: "/bin/fake",
      args: ["hello", "level=undefined"],
    });
  });

  test("an agent that declares supportsReadOnly is not rejected and builds its command", () => {
    const registry = new AgentRegistry();
    registry.register(headlessAdapter(false, undefined, true));

    expect(build(registry, MCP_ONLY_ID, undefined, true)).toEqual({
      command: "/bin/fake",
      args: ["hello", "level=undefined"],
    });
  });

  test("forwards readOnly to claude-code, which puts its lock before -p", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(build(registry, "claude-code", undefined, true)).toEqual({
      command: "/bin/fake",
      args: ["--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk", "--strict-mcp-config", "-p", "hello"],
    });
  });

  test("forwards readOnly to codex, which puts its lock right after exec", () => {
    const registry = new AgentRegistry();
    registry.register(codexAdapter);

    expect(build(registry, "codex", undefined, true)).toEqual({
      command: "/bin/fake",
      args: ["exec", "--sandbox", "read-only", "--ignore-user-config", "hello"],
    });
  });

  test("checks in order: unknown agent, no headless, read-only, then the reasoning level errors", () => {
    // 1. Unknown agent wins over a read-only request.
    expect(() => build(new AgentRegistry(), "codex", undefined, true)).toThrow("Unknown agent: codex");

    // 2. An agent without headless execution fails with HEADLESS_UNSUPPORTED before read-only is looked at.
    const noHeadless = new AgentRegistry();
    noHeadless.register(mcpOnlyAdapter);
    expect(() => build(noHeadless, MCP_ONLY_ID, undefined, true)).toThrow(HeadlessUnsupportedError);

    // 3. Read-only wins over a level the agent cannot choose, and over a level it does not list.
    const noLevel = new AgentRegistry();
    noLevel.register(headlessAdapter(false));
    expect(() => build(noLevel, MCP_ONLY_ID, "high", true)).toThrow(ReadOnlyUnsupportedError);
    expect(() => build(noLevel, MCP_ONLY_ID, banana, true)).toThrow(ReadOnlyUnsupportedError);
    const withLevel = new AgentRegistry();
    withLevel.register(headlessAdapter(true, ["low"]));
    const invalidLevel = () => build(withLevel, MCP_ONLY_ID, banana, true);
    expect(invalidLevel).toThrow(ReadOnlyUnsupportedError);
    expect(invalidLevel).not.toThrow(InvalidReasoningLevelError);

    // 4. Without a read-only request, the level errors are the ones from before.
    expect(() => build(noLevel, MCP_ONLY_ID, banana)).toThrow(ReasoningLevelUnsupportedError);
    expect(() => build(withLevel, MCP_ONLY_ID, banana)).toThrow(InvalidReasoningLevelError);
  });
});
