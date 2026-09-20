import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import { ConfigConflictError, type Plan } from "../modules/config-writer/types";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpInstall } from "./mcp-write-decision";

export interface PlanMcpInstallInput {
  agentId: AgentId;
  server: McpServerDefinition;
  home: string;
}

export async function planMcpInstall(registry: AgentRegistry, input: PlanMcpInstallInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const { configPath, decision, write } = await decideMcpInstall(adapter, input.home, input.server);
  if (decision.kind === "conflict") throw new ConfigConflictError(configPath, input.server.name);

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-install",
    noop: decision.kind === "noop",
    writes: write ? [write] : [],
  };

  await savePlan(input.home, plan);
  return plan;
}
