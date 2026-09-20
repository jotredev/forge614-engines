import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";

export function buildDefaultRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  return registry;
}
