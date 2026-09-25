export interface PlanWrite {
  path: string;
  beforeHash: string;
  afterContent: string;
  /** When true, apply removes the file instead of writing `afterContent` (which is then ignored, but kept as "" by convention). */
  delete?: boolean;
}

export type McpRepairStatus = "not-installed" | "already-correct" | "repairable-conflict" | "blocked";

export interface McpRepairPreview {
  agentId: string;
  configPath: string;
  status: McpRepairStatus;
  canonical: { name: string; command: string; args: string[] };
  /** Redacted preview of the conflicting entry (see redactMcpEntry). Present only for repairable-conflict and blocked/not-writable. */
  existing?: unknown;
  blockedReason?: "unparsable-config" | "not-writable";
}

export interface Plan {
  planId: string;
  agentId: string;
  action: "mcp-install" | "mcp-remove" | "memory-install" | "memory-remove" | "mcp-repair";
  noop: boolean;
  writes: PlanWrite[];
  metadata?: MemoryIntegrationMetadata;
  repair?: McpRepairPreview;
}

export type MemoryIntegrationComponentStatus =
  | { kind: "unsupported"; reason: string }
  | { kind: "noop" }
  | { kind: "write"; notice?: string }
  | { kind: "blocked"; reason: string; details: string };

/**
 * Purely structural: describes whether Engines can/did write the hook's config
 * entry, nothing about whether the hook has ever actually run. Used for the
 * write decision itself (both install and remove) and for computeRemovalStatus,
 * where "did we successfully remove the config" is the whole question — removal
 * has no notion of runtime proof to satisfy.
 */
export type HookComponentStatus =
  | { kind: "unsupported"; reason: string }
  | { kind: "noop" }
  | { kind: "write" }
  | { kind: "blocked"; reason: string; details: string };

/**
 * Whether the hook actually, verifiably works — the only status that may ever
 * contribute to overallStatus being "complete" for the hook component. A
 * structurally-written config entry (HookComponentStatus "write"/"noop") is
 * NOT enough on its own: Codex additionally requires interactive trust Engines
 * cannot grant, and neither agent's hook has truly run until Engines observes
 * runtime evidence of it (see hook-evidence.ts). `runtime-observed` means
 * exactly "Engines' own memory-hook-run runtime was invoked with a
 * SessionStart-shaped payload and Engram returned context" — not proof a
 * specific client made that call, and not proof the host consumed the result.
 */
export type HookRuntimeStatus =
  | { kind: "unsupported" }
  | { kind: "absent" }
  | { kind: "needs-user-trust" }
  | {
      kind: "pending-runtime-verification";
      reason:
        | "no-evidence"
        | "evidence-corrupt"
        | "evidence-wrong-agent"
        | "evidence-fingerprint-mismatch"
        | "evidence-context-not-received"
        | "evidence-expired";
    }
  | { kind: "runtime-observed"; timestamp: string };

export type MemoryIntegrationOverallStatus = "complete" | "partial" | "unsupported";

export interface MemoryIntegrationMetadata {
  protocol?: {
    source: string;
    id: string;
    version: number;
    fingerprint: string;
    /** Present only when Engram was too old for --protocol-version 4 and Engines fell back to v1. */
    legacyNotice?: string;
  };
  mcp: { path: string; status: MemoryIntegrationComponentStatus };
  instructions: { paths: string[]; status: MemoryIntegrationComponentStatus };
  hook: {
    path: string;
    status: HookComponentStatus;
    /** Absent for memory-remove, where runtime proof is not the question — only memory-install populates this. */
    runtimeStatus?: HookRuntimeStatus;
  };
  overallStatus: MemoryIntegrationOverallStatus;
}

export class ConfigConflictError extends Error {
  constructor(path: string, key: string) {
    super(`Refusing to write "${key}" into ${path}: an existing entry with different content is already there`);
  }
}
