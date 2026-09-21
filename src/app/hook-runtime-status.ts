import type { AgentAdapter } from "../modules/agents/types";
import type { HookRuntimeStatus } from "../modules/config-writer/types";
import type { HookEvidenceCheck } from "./hook-evidence";

/**
 * The single source of truth for "does this agent's hook actually, verifiably
 * work" — shared by planMemoryInstall (so a plan can never claim "complete"
 * before any real session has run the hook) and verifyMemoryIntegration (which
 * reads the same evidence after the fact). See HookRuntimeStatus's own doc
 * comment for exactly what `runtime-observed` does and does not prove.
 */
export function computeHookRuntimeStatus(
  adapter: AgentAdapter,
  hookPresent: boolean,
  evidence: HookEvidenceCheck,
): HookRuntimeStatus {
  if (!adapter.hooks) return { kind: "unsupported" };
  if (!hookPresent) return { kind: "absent" };
  if (evidence.kind === "valid" && evidence.contextReceived) return { kind: "runtime-observed", timestamp: evidence.timestamp };

  const requiresUserTrust = adapter.hooks.requiresUserTrust;
  // For a trust-gated agent (Codex), no evidence at all — or evidence tied to a
  // hook identity that no longer matches — is exactly what "not yet trusted (or
  // trusted under a now-superseded config)" looks like from here: Codex records
  // trust against the hook's own content hash, so a changed hook needs re-trust
  // too. An expired or otherwise-malformed record for a *matching, present*
  // hook is a different problem (a stale or damaged observation, not a trust
  // question), so those fall through to pending-runtime-verification instead.
  if (requiresUserTrust && (evidence.kind === "absent" || (evidence.kind === "invalid" && evidence.reason === "fingerprint-mismatch"))) {
    return { kind: "needs-user-trust" };
  }

  const reason: Extract<HookRuntimeStatus, { kind: "pending-runtime-verification" }>["reason"] =
    evidence.kind === "absent"
      ? "no-evidence"
      : evidence.kind === "invalid"
        ? evidence.reason === "corrupt"
          ? "evidence-corrupt"
          : evidence.reason === "wrong-agent"
            ? "evidence-wrong-agent"
            : evidence.reason === "fingerprint-mismatch"
              ? "evidence-fingerprint-mismatch"
              : "evidence-expired"
        : "evidence-context-not-received";
  return { kind: "pending-runtime-verification", reason };
}
