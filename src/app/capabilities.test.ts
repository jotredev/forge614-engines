import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { capabilitiesFor, listAgents } from "./capabilities";

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
      supportsReasoningLevel: false,
    });
  });

  test("throws for an unregistered agent", () => {
    const registry = new AgentRegistry();
    expect(() => capabilitiesFor(registry, "codex")).toThrow("Unknown agent: codex");
  });
});

describe("listAgents", () => {
  test("lists every registered adapter's capabilities, regardless of installation", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);
    registry.register(codexAdapter);
    registry.register(cursorAdapter);

    expect(listAgents(registry)).toEqual([
      {
        id: "claude-code",
        label: "Claude Code",
        supportsMcp: true,
        supportsHooks: true,
        supportsHeadlessExec: true,
        supportsReasoningLevel: false,
      },
      {
        id: "codex",
        label: "Codex",
        supportsMcp: true,
        supportsHooks: true,
        supportsHeadlessExec: true,
        supportsReasoningLevel: true,
      },
      {
        id: "cursor",
        label: "Cursor",
        supportsMcp: true,
        supportsHooks: false,
        supportsHeadlessExec: false,
        supportsReasoningLevel: false,
      },
    ]);
  });

  test("returns an empty array for an empty registry", () => {
    expect(listAgents(new AgentRegistry())).toEqual([]);
  });
});
