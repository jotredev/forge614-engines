import { homedir } from "node:os";
import { buildDefaultRegistry } from "../../app/default-registry";
import { detectAgents } from "../../app/detect";
import { planMcpInstall } from "../../app/plan-mcp-install";
import type { AgentId } from "../../modules/agents/types";

const SCHEMA_VERSION = 1;

export function printJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...payload }, null, 2));
}

export async function runDetect(): Promise<void> {
  const registry = buildDefaultRegistry();
  const agents = await detectAgents(registry, homedir(), process.env, process.platform);
  printJson({ agents });
}

export async function runPlanMcpInstall(agentId: AgentId, name: string, command: string, args: string[]): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMcpInstall(registry, { agentId, home: homedir(), server: { name, command, args } });
  printJson({ plan });
}
