import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { computeHookRuntimeStatus } from "./hook-runtime-status";

describe("computeHookRuntimeStatus", () => {
  test("unsupported when the adapter has no hooks target (cursor)", () => {
    expect(computeHookRuntimeStatus(cursorAdapter, false, { kind: "absent" })).toEqual({ kind: "unsupported" });
  });

  test("absent when the hook isn't present in config yet, regardless of any evidence", () => {
    expect(computeHookRuntimeStatus(claudeCodeAdapter, false, { kind: "absent" })).toEqual({ kind: "absent" });
  });

  test("runtime-observed only when evidence is valid AND context was received", () => {
    const result = computeHookRuntimeStatus(claudeCodeAdapter, true, { kind: "valid", contextReceived: true, timestamp: "t" });
    expect(result).toEqual({ kind: "runtime-observed", timestamp: "t" });
  });

  test("claude-code with no evidence yet is pending-runtime-verification, never needs-user-trust", () => {
    expect(computeHookRuntimeStatus(claudeCodeAdapter, true, { kind: "absent" })).toEqual({
      kind: "pending-runtime-verification",
      reason: "no-evidence",
    });
  });

  test("codex with no evidence yet is needs-user-trust", () => {
    expect(computeHookRuntimeStatus(codexAdapter, true, { kind: "absent" })).toEqual({ kind: "needs-user-trust" });
  });

  test("codex with a fingerprint mismatch is needs-user-trust (config changed, re-trust likely needed)", () => {
    expect(computeHookRuntimeStatus(codexAdapter, true, { kind: "invalid", reason: "fingerprint-mismatch" })).toEqual({
      kind: "needs-user-trust",
    });
  });

  test("codex with expired evidence is pending-runtime-verification, not needs-user-trust (expiry isn't a trust question)", () => {
    expect(computeHookRuntimeStatus(codexAdapter, true, { kind: "invalid", reason: "expired" })).toEqual({
      kind: "pending-runtime-verification",
      reason: "evidence-expired",
    });
  });

  test("valid evidence that never received Engram context is pending-runtime-verification for either agent", () => {
    const evidence = { kind: "valid", contextReceived: false, timestamp: "t" } as const;
    expect(computeHookRuntimeStatus(claudeCodeAdapter, true, evidence)).toEqual({
      kind: "pending-runtime-verification",
      reason: "evidence-context-not-received",
    });
  });
});
