import { homedir } from "node:os";
import { applyPlan } from "../../app/apply-plan";
import { buildDefaultRegistry } from "../../app/default-registry";
import { capabilitiesFor } from "../../app/capabilities";
import { detectAgents } from "../../app/detect";
import { headlessCommandFor } from "../../app/headless-command";
import { planMcpInstall } from "../../app/plan-mcp-install";
import { planMcpRemove } from "../../app/plan-mcp-remove";
import { performUpdate } from "../../app/self-update";
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

export async function runPlanMcpRemove(agentId: AgentId, name: string, command: string, args: string[]): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMcpRemove(registry, { agentId, home: homedir(), server: { name, command, args } });
  printJson({ plan });
}

export async function runApply(planId: string): Promise<void> {
  const result = await applyPlan(homedir(), planId);
  printJson({ result });
}

export async function runCapabilities(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  printJson({ ...capabilitiesFor(registry, agentId) });
}

export async function runUpdate(): Promise<void> {
  const result = await performUpdate(homedir());
  printJson({ result });
}

export async function runHeadlessCommand(
  agentId: AgentId,
  executable: string,
  prompt: string,
  timeoutMs?: number,
): Promise<void> {
  const registry = buildDefaultRegistry();
  const result = headlessCommandFor(registry, agentId, executable, prompt, timeoutMs);
  printJson({ headless: result });
}
