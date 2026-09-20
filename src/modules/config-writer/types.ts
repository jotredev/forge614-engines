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
  action: "mcp-install" | "mcp-remove";
  noop: boolean;
  writes: PlanWrite[];
}

export class ConfigConflictError extends Error {
  constructor(path: string, key: string) {
    super(`Refusing to write "${key}" into ${path}: an existing entry with different content is already there`);
  }
}
