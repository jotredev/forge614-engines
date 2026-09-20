import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { cursorAdapter } from "../infrastructure/agents/cursor";
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
