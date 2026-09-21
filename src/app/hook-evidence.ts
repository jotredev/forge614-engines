import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolveHookEvidencePath, resolveMemoryHookCommand } from "../modules/agents/hook-command";
import type { AgentId } from "../modules/agents/types";
import { atomicWrite } from "../infrastructure/config-io/atomic-write";

const EVIDENCE_FORMAT = 1;

/**
 * How long a runtime-observation record stays valid. 7 days: long enough that
 * one successful session start early in a work week still counts through days
 * of continued use of an already-open session (SessionStart only fires when a
 * *new* session begins, so it can legitimately be a while between firings) —
 * short enough that if the hook silently stopped working (Engram uninstalled,
 * the config entry removed by hand, a machine swap) `verify` stops claiming
 * `complete` within about a week instead of indefinitely.
 */
export const HOOK_EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far into the future a recorded timestamp may sit before it is treated as
 * corrupted rather than merely clock-skewed. Small drift between machines is
 * normal; anything beyond this is not a clock problem.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export interface HookEvidence {
  format: 1;
  agentId: AgentId;
  timestamp: string;
  engramContextReceived: boolean;
  /** sha256 of the exact hook command this agent's config would carry today — never the raw command/path itself. */
  commandFingerprint: string;
}

function commandFingerprint(home: string, agentId: AgentId): string {
  return createHash("sha256").update(resolveMemoryHookCommand(home, agentId)).digest("hex");
}

/**
 * Records that Forge614 Engines' own `memory-hook-run` runtime was invoked with
 * a payload that looked like a genuine SessionStart trigger, and what happened
 * when it then called Engram's public `startup-context` CLI.
 *
 * This is runtime-observed evidence, not proof of client execution: Engines has
 * no cryptographic way to confirm Claude Code or Codex specifically was the
 * caller, and no way at all to confirm the host actually read or acted on the
 * text this process returned on stdout — that last mile is Shell's job, at the
 * point it opens the client. Only call this from the genuine CLI entry point,
 * and only when the caller (run-memory-hook.ts) recognized a SessionStart-shaped
 * invocation — never from a dry run. Contains no memory content, no directory,
 * no secrets, no Engram output: only enough to answer "was this runtime invoked
 * with a plausible SessionStart payload, and did Engram return context."
 */
export async function recordHookEvidence(home: string, agentId: AgentId, engramContextReceived: boolean): Promise<void> {
  const evidence: HookEvidence = {
    format: EVIDENCE_FORMAT,
    agentId,
    timestamp: new Date().toISOString(),
    engramContextReceived,
    commandFingerprint: commandFingerprint(home, agentId),
  };
  await atomicWrite(resolveHookEvidencePath(home, agentId), JSON.stringify(evidence));
}

export type HookEvidenceCheck =
  | { kind: "absent" }
  | { kind: "invalid"; reason: "corrupt" | "wrong-agent" | "fingerprint-mismatch" | "expired" }
  | { kind: "valid"; contextReceived: boolean; timestamp: string };

function isEvidenceShaped(value: unknown): value is HookEvidence {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.format === EVIDENCE_FORMAT &&
    typeof v.agentId === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.engramContextReceived === "boolean" &&
    typeof v.commandFingerprint === "string"
  );
}

/**
 * Reads back what recordHookEvidence wrote, rejecting anything that isn't
 * genuinely current: a malformed or absent/unparseable/suspiciously-future
 * timestamp, the wrong agent's evidence, evidence whose fingerprint no longer
 * matches the hook command this exact home/agent would resolve today (the
 * config identity changed since it was recorded), or evidence older than
 * HOOK_EVIDENCE_MAX_AGE_MS.
 */
export async function readHookEvidence(home: string, agentId: AgentId): Promise<HookEvidenceCheck> {
  let raw: string;
  try {
    raw = await readFile(resolveHookEvidencePath(home, agentId), "utf8");
  } catch {
    return { kind: "absent" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", reason: "corrupt" };
  }
  if (!isEvidenceShaped(parsed)) return { kind: "invalid", reason: "corrupt" };

  const recordedAt = Date.parse(parsed.timestamp);
  const now = Date.now();
  if (Number.isNaN(recordedAt) || recordedAt - now > CLOCK_SKEW_TOLERANCE_MS) {
    return { kind: "invalid", reason: "corrupt" };
  }

  if (parsed.agentId !== agentId) return { kind: "invalid", reason: "wrong-agent" };
  if (parsed.commandFingerprint !== commandFingerprint(home, agentId)) return { kind: "invalid", reason: "fingerprint-mismatch" };
  if (now - recordedAt > HOOK_EVIDENCE_MAX_AGE_MS) return { kind: "invalid", reason: "expired" };

  return { kind: "valid", contextReceived: parsed.engramContextReceived, timestamp: parsed.timestamp };
}
