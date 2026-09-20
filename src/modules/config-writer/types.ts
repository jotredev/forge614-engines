export interface PlanWrite {
  path: string;
  beforeHash: string;
  afterContent: string;
  /** When true, apply removes the file instead of writing `afterContent` (which is then ignored, but kept as "" by convention). */
  delete?: boolean;
}

export interface Plan {
  planId: string;
  agentId: string;
  action: "mcp-install" | "mcp-remove" | "memory-install" | "memory-remove";
  noop: boolean;
  writes: PlanWrite[];
  metadata?: MemoryIntegrationMetadata;
}

export type MemoryIntegrationComponentStatus =
  | { kind: "unsupported"; reason: string }
  | { kind: "noop" }
  | { kind: "write" }
  | { kind: "blocked"; reason: string; details: string };

export type MemoryIntegrationOverallStatus = "complete" | "partial" | "unsupported";

export interface MemoryIntegrationMetadata {
  protocol?: { source: string; id: string; version: number; fingerprint: string };
  mcp: { path: string; status: MemoryIntegrationComponentStatus };
  instructions: { paths: string[]; status: MemoryIntegrationComponentStatus };
  overallStatus: MemoryIntegrationOverallStatus;
}

export class ConfigConflictError extends Error {
  constructor(path: string, key: string) {
    super(`Refusing to write "${key}" into ${path}: an existing entry with different content is already there`);
  }
}
