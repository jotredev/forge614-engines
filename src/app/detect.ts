import type { AgentRegistry } from "../modules/agents/registry";
import { detectAgent, type AgentDetectionResult } from "../infrastructure/detection/detect-agent";

export async function detectAgents(
  registry: AgentRegistry,
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<AgentDetectionResult[]> {
  const results: AgentDetectionResult[] = [];
  for (const adapter of registry.list()) {
    results.push(await detectAgent(adapter, home, env, platform));
  }
  return results;
}
