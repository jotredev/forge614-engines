import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import type { AgentAdapter } from "../modules/agents/types";
import { ReasoningLevelUnsupportedError } from "../modules/agents/types";
import { HeadlessUnsupportedError, headlessCommandFor } from "./headless-command";

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

  test("propagates ReasoningLevelUnsupportedError from an adapter that rejects it", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(() =>
      headlessCommandFor(registry, "claude-code", "/bin/claude", "hello", undefined, undefined, "high"),
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
    registry.register(cursorAdapter);

    expect(() => headlessCommandFor(registry, "cursor", "/bin/cursor", "hello")).toThrow(HeadlessUnsupportedError);
  });

  test("throws for an unregistered agent", () => {
    const registry = new AgentRegistry();
    expect(() => headlessCommandFor(registry, "codex", "/bin/codex", "hello")).toThrow("Unknown agent: codex");
  });

  test("rejects reasoningLevel based solely on capabilities.supportsReasoningLevel, even when the adapter's own headlessCommand doesn't guard against it", () => {
    const registry = new AgentRegistry();
    const noGuardAdapter: AgentAdapter = {
      id: "cursor",
      label: "No-guard test adapter",
      capabilities: { supportsMcp: false, supportsHooks: false, supportsHeadlessExec: true, supportsReasoningLevel: false },
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
      headlessCommandFor(registry, "cursor", "/bin/fake", "hello", undefined, undefined, "high"),
    ).toThrow(ReasoningLevelUnsupportedError);
  });
});
