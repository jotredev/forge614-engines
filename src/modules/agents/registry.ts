import { REASONING_LEVELS, type AgentAdapter, type AgentId } from "./types";

export class DuplicateAgentError extends Error {
  constructor(id: AgentId) {
    super(`Agent already registered: ${id}`);
  }
}

export class InvalidCapabilityManifestError extends Error {
  constructor(id: AgentId, reason: string) {
    super(`Invalid capability manifest for ${id}: ${reason}`);
  }
}

/**
 * Rejects an adapter whose declared capabilities contradict what it implements, so a bad manifest fails at
 * registration instead of the first time somebody asks the agent for something.
 */
export function validateCapabilityManifest(adapter: AgentAdapter): void {
  if (adapter.capabilities.supportsHeadlessExec && typeof adapter.headlessCommand !== "function") {
    throw new InvalidCapabilityManifestError(
      adapter.id,
      "supportsHeadlessExec is true but headlessCommand() is not implemented",
    );
  }
  if (adapter.capabilities.supportsMcp && adapter.mcpEntryPath.length === 0) {
    throw new InvalidCapabilityManifestError(adapter.id, "supportsMcp is true but mcpEntryPath is empty");
  }
  if (adapter.capabilities.supportsHooks && !adapter.hooks) {
    throw new InvalidCapabilityManifestError(adapter.id, "supportsHooks is true but hooks target is not implemented");
  }
  const levels = adapter.reasoningLevels;
  if (adapter.capabilities.supportsReasoningLevel && (!levels || levels.length === 0)) {
    throw new InvalidCapabilityManifestError(
      adapter.id,
      "supportsReasoningLevel is true but reasoningLevels is missing or empty",
    );
  }
  if (!adapter.capabilities.supportsReasoningLevel && levels !== undefined) {
    throw new InvalidCapabilityManifestError(
      adapter.id,
      "reasoningLevels is declared but supportsReasoningLevel is false",
    );
  }
  const unknownLevel = levels?.find((level) => !REASONING_LEVELS.includes(level));
  if (unknownLevel !== undefined) {
    throw new InvalidCapabilityManifestError(
      adapter.id,
      `reasoningLevels contains "${unknownLevel}", which is not one of ${REASONING_LEVELS.join(", ")}`,
    );
  }
}

export class AgentRegistry {
  private readonly adapters = new Map<AgentId, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) throw new DuplicateAgentError(adapter.id);
    validateCapabilityManifest(adapter);
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentId): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }
}
