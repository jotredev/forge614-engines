import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";

export interface CapabilitiesReport {
  id: AgentId;
  label: string;
  supportsMcp: boolean;
  supportsHooks: boolean;
  supportsHeadlessExec: boolean;
}

export function capabilitiesFor(registry: AgentRegistry, agentId: AgentId): CapabilitiesReport {
  const adapter = registry.get(agentId);
  if (!adapter) throw new Error(`Unknown agent: ${agentId}`);
  return {
    id: adapter.id,
    label: adapter.label,
    supportsMcp: adapter.capabilities.supportsMcp,
    supportsHooks: adapter.capabilities.supportsHooks,
    supportsHeadlessExec: adapter.capabilities.supportsHeadlessExec,
  };
}
