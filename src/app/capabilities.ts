import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentAdapter, AgentId } from "../modules/agents/types";

export interface CapabilitiesReport {
  id: AgentId;
  label: string;
  supportsMcp: boolean;
  supportsHooks: boolean;
  supportsHeadlessExec: boolean;
  supportsReasoningLevel: boolean;
  /**
   * Whether headless execution can be locked to read-only with `headless --read-only`. Additive field: a caller
   * that needs read-only helpers (Atlas, once it adopts the option) reads it to refuse to launch them with an
   * Engines that predates the option, which would ignore `--read-only` without an error.
   */
  supportsReadOnly: boolean;
  /**
   * Whether Engines supports this agent completely: MCP, session-start hooks, headless execution and an
   * instructions target. Derived in `toCapabilitiesReport`, never declared by an adapter, so a new agent
   * cannot forget it or promise it without actually having the pieces. `supportsReasoningLevel` and `supportsReadOnly`
   * do not count (they are optional). Forge614 Shell filters every agent list it shows by this field; Engines, not
   * Shell, decides who qualifies.
   */
  fullySupported: boolean;
}

function toCapabilitiesReport(adapter: AgentAdapter): CapabilitiesReport {
  return {
    id: adapter.id,
    label: adapter.label,
    supportsMcp: adapter.capabilities.supportsMcp,
    supportsHooks: adapter.capabilities.supportsHooks,
    supportsHeadlessExec: adapter.capabilities.supportsHeadlessExec,
    supportsReasoningLevel: adapter.capabilities.supportsReasoningLevel,
    supportsReadOnly: adapter.capabilities.supportsReadOnly,
    fullySupported:
      adapter.capabilities.supportsMcp &&
      adapter.capabilities.supportsHooks &&
      adapter.capabilities.supportsHeadlessExec &&
      adapter.instructions !== undefined,
  };
}

export function capabilitiesFor(registry: AgentRegistry, agentId: AgentId): CapabilitiesReport {
  const adapter = registry.get(agentId);
  if (!adapter) throw new Error(`Unknown agent: ${agentId}`);
  return toCapabilitiesReport(adapter);
}

/** Every agent the code supports, regardless of whether it is installed on this machine — unlike `detect`. */
export function listAgents(registry: AgentRegistry): CapabilitiesReport[] {
  return registry.list().map(toCapabilitiesReport);
}
