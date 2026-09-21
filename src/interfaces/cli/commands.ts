import { homedir } from "node:os";
import { applyMcpRepair, ConfirmationRequiredError } from "../../app/apply-mcp-repair";
import { applyPlan } from "../../app/apply-plan";
import { buildDefaultRegistry } from "../../app/default-registry";
import { capabilitiesFor, listAgents } from "../../app/capabilities";
import { detectAgents } from "../../app/detect";
import { headlessCommandFor } from "../../app/headless-command";
import { planMcpInstall } from "../../app/plan-mcp-install";
import { planMcpRemove } from "../../app/plan-mcp-remove";
import { planMcpRepair } from "../../app/plan-mcp-repair";
import { planMemoryInstall } from "../../app/plan-memory-install";
import { planMemoryRemove } from "../../app/plan-memory-remove";
import { performUpdate } from "../../app/self-update";
import { verifyMcpRepair } from "../../app/verify-mcp-repair";
import { verifyMemoryIntegration } from "../../app/verify-memory-integration";
import { loadPlan } from "../../infrastructure/plan-store";
import type { AgentId, ReasoningLevel } from "../../modules/agents/types";

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

export async function runPlanMcpRepair(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMcpRepair(registry, { agentId, home: homedir() });
  printJson({ plan });
}

export async function runApply(planId: string): Promise<void> {
  const plan = await loadPlan(homedir(), planId);
  if (plan.action === "mcp-repair") throw new ConfirmationRequiredError(planId);
  const result = await applyPlan(homedir(), planId);
  printJson({ result });
}

export async function runApplyMcpRepair(planId: string, confirmed: boolean): Promise<void> {
  const result = await applyMcpRepair(homedir(), planId, confirmed);
  printJson({ result });
}

export async function runCapabilities(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  printJson({ ...capabilitiesFor(registry, agentId) });
}

export async function runAgentsList(): Promise<void> {
  const registry = buildDefaultRegistry();
  printJson({ agents: listAgents(registry) });
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
  model?: string,
  reasoningLevel?: ReasoningLevel,
  stdinPrompt?: boolean,
): Promise<void> {
  const registry = buildDefaultRegistry();
  const result = headlessCommandFor(registry, agentId, executable, prompt, timeoutMs, model, reasoningLevel, stdinPrompt);
  printJson({ headless: result });
}

export async function runPlanMemoryInstall(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMemoryInstall(registry, { agentId, home: homedir() });
  printJson({ plan });
}

export async function runPlanMemoryRemove(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMemoryRemove(registry, { agentId, home: homedir() });
  printJson({ plan });
}

export async function runVerifyMemoryIntegration(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const verification = await verifyMemoryIntegration(registry, { agentId, home: homedir() });
  printJson({ verification });
}

export async function runVerifyMcpRepair(agentId: AgentId, planId: string): Promise<void> {
  const registry = buildDefaultRegistry();
  const verification = await verifyMcpRepair(registry, { agentId, home: homedir(), planId });
  printJson({ verification });
}
