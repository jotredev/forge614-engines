import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { capabilitiesFor } from "./capabilities";

describe("capabilitiesFor", () => {
  test("reports the adapter's declared capabilities", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(capabilitiesFor(registry, "claude-code")).toEqual({
      id: "claude-code",
      label: "Claude Code",
      supportsMcp: true,
      supportsHooks: true,
      supportsHeadlessExec: true,
    });
  });

  test("throws for an unregistered agent", () => {
    const registry = new AgentRegistry();
    expect(() => capabilitiesFor(registry, "codex")).toThrow("Unknown agent: codex");
  });
});
