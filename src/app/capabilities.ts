import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentAdapter, AgentId } from "../modules/agents/types";

export interface CapabilitiesReport {
  id: AgentId;
  label: string;
  supportsMcp: boolean;
  supportsHooks: boolean;
  supportsHeadlessExec: boolean;
  supportsReasoningLevel: boolean;
}

function toCapabilitiesReport(adapter: AgentAdapter): CapabilitiesReport {
  return {
    id: adapter.id,
    label: adapter.label,
    supportsMcp: adapter.capabilities.supportsMcp,
    supportsHooks: adapter.capabilities.supportsHooks,
    supportsHeadlessExec: adapter.capabilities.supportsHeadlessExec,
    supportsReasoningLevel: adapter.capabilities.supportsReasoningLevel,
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
