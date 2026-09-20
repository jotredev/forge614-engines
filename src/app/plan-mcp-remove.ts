import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import type { Plan } from "../modules/config-writer/types";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpRemove } from "./mcp-write-decision";

export class UnrecognizedEntryError extends Error {
  constructor(name: string) {
    super(`Refusing to remove "${name}": it does not match what this system would have installed`);
  }
}

export interface PlanMcpRemoveInput {
  agentId: AgentId;
  server: McpServerDefinition;
  home: string;
}

export async function planMcpRemove(registry: AgentRegistry, input: PlanMcpRemoveInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const { decision, write } = await decideMcpRemove(adapter, input.home, input.server);
  if (decision.kind === "unrecognized") throw new UnrecognizedEntryError(input.server.name);

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-remove",
    noop: decision.kind === "noop",
    writes: write ? [write] : [],
  };

  await savePlan(input.home, plan);
  return plan;
}
