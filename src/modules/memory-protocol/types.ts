export interface MemoryProtocolLifecycle {
  start: string[];
  save: string[];
  compact: string[];
  resume: string[];
  end: string[];
}

export interface MemoryProtocolScopes {
  shared: string;
  project: string;
}

export interface MemoryProtocolSecurity {
  neverSave: string[];
}

export interface MemoryProtocol {
  id: "forge614-engram-memory";
  version: 1;
  instructions: string;
  lifecycle: MemoryProtocolLifecycle;
  scopes: MemoryProtocolScopes;
  security: MemoryProtocolSecurity;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const LIFECYCLE_KEYS = ["start", "save", "compact", "resume", "end"] as const;

export function isMemoryProtocol(value: unknown): value is MemoryProtocol {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.id !== "forge614-engram-memory") return false;
  if (candidate.version !== 1) return false;
  if (typeof candidate.instructions !== "string" || candidate.instructions.length === 0) return false;

  const lifecycle = candidate.lifecycle;
  if (typeof lifecycle !== "object" || lifecycle === null) return false;
  const lifecycleRecord = lifecycle as Record<string, unknown>;
  for (const key of LIFECYCLE_KEYS) {
    if (!isStringArray(lifecycleRecord[key])) return false;
  }

  const scopes = candidate.scopes;
  if (typeof scopes !== "object" || scopes === null) return false;
  const scopesRecord = scopes as Record<string, unknown>;
  if (typeof scopesRecord.shared !== "string" || typeof scopesRecord.project !== "string") return false;

  const security = candidate.security;
  if (typeof security !== "object" || security === null) return false;
  if (!isStringArray((security as Record<string, unknown>).neverSave)) return false;

  return true;
}

/**
 * Version 4 of the protocol: one master text with two outputs (see Engram's own
 * design). `instructions` is the complete manual Engines installs verbatim;
 * `mcpInstructions` is the short text meant for Engram's own MCP server, never
 * written by Engines into any file. Version 4 carries no lifecycle, scopes or
 * security lists — the manual is the single source.
 */
export interface MemoryProtocolV4 {
  id: "forge614-engram-memory";
  version: 4;
  instructions: string;
  mcpInstructions: string;
  startupContext: { command: string; format: 2; description: string };
}

/** Either shape Engines knows how to fetch and install today. */
export type AnyMemoryProtocol = MemoryProtocol | MemoryProtocolV4;

// R31-style leniency (see startup-context-client.ts): this reads another node's
// output, so it is strict only about the fields Engines actually consumes
// (id, version, instructions) and ignores unknown/additive fields such as a
// future addition to startupContext.
export function isMemoryProtocolV4(value: unknown): value is MemoryProtocolV4 {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.id !== "forge614-engram-memory") return false;
  if (candidate.version !== 4) return false;
  if (typeof candidate.instructions !== "string" || candidate.instructions.length === 0) return false;
  if (typeof candidate.mcpInstructions !== "string") return false;

  return true;
}
