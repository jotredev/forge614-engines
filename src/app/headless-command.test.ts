import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
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

  test("throws HeadlessUnsupportedError for an agent that does not support headless exec", () => {
    const registry = new AgentRegistry();
    registry.register(cursorAdapter);

    expect(() => headlessCommandFor(registry, "cursor", "/bin/cursor", "hello")).toThrow(HeadlessUnsupportedError);
  });

  test("throws for an unregistered agent", () => {
    const registry = new AgentRegistry();
    expect(() => headlessCommandFor(registry, "codex", "/bin/codex", "hello")).toThrow("Unknown agent: codex");
  });
});
