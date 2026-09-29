import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import type { AgentAdapter } from "../modules/agents/types";
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
      fullySupported: true,
    });
  });

  test("derives fullySupported: true for claude-code and codex, false for cursor", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);
    registry.register(codexAdapter);
    registry.register(cursorAdapter);

    expect(capabilitiesFor(registry, "claude-code").fullySupported).toBe(true);
    expect(capabilitiesFor(registry, "codex").fullySupported).toBe(true);
    expect(capabilitiesFor(registry, "cursor").fullySupported).toBe(false);
  });

  describe("fullySupported is derived, one missing piece at a time", () => {
    const fullAdapter: AgentAdapter = {
      ...claudeCodeAdapter,
      id: "claude-code",
      capabilities: { supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true, supportsReasoningLevel: true },
    };

    function fullySupportedFor(adapter: AgentAdapter): boolean {
      const registry = new AgentRegistry();
      registry.register(adapter);
      return capabilitiesFor(registry, adapter.id).fullySupported;
    }

    test("is true for a test adapter that meets every requirement", () => {
      expect(fullySupportedFor(fullAdapter)).toBe(true);
    });

    test("is false without MCP", () => {
      expect(fullySupportedFor({ ...fullAdapter, capabilities: { ...fullAdapter.capabilities, supportsMcp: false } })).toBe(false);
    });

    test("is false without hooks", () => {
      expect(fullySupportedFor({ ...fullAdapter, capabilities: { ...fullAdapter.capabilities, supportsHooks: false } })).toBe(false);
    });

    test("is false without headless execution", () => {
      expect(fullySupportedFor({ ...fullAdapter, capabilities: { ...fullAdapter.capabilities, supportsHeadlessExec: false } })).toBe(false);
    });

    test("is false without an instructions target", () => {
      expect(fullySupportedFor({ ...fullAdapter, instructions: undefined })).toBe(false);
    });

    test("is not affected by supportsReasoningLevel, which is optional", () => {
      expect(fullySupportedFor({ ...fullAdapter, capabilities: { ...fullAdapter.capabilities, supportsReasoningLevel: false } })).toBe(true);
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
        fullySupported: true,
      },
      {
        id: "codex",
        label: "Codex",
        supportsMcp: true,
        supportsHooks: true,
        supportsHeadlessExec: true,
        supportsReasoningLevel: true,
        fullySupported: true,
      },
      {
        id: "cursor",
        label: "Cursor",
        supportsMcp: true,
        supportsHooks: false,
        supportsHeadlessExec: false,
        supportsReasoningLevel: false,
        fullySupported: false,
      },
    ]);
  });

  test("returns an empty array for an empty registry", () => {
    expect(listAgents(new AgentRegistry())).toEqual([]);
  });
});
