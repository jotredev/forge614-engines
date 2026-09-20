import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { ENGRAM_MCP_SERVER } from "../modules/memory-protocol/constants";
import { computeOverallStatus } from "../modules/memory-protocol/status";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpRemove } from "./mcp-write-decision";
import { decideInstructionsRemove, type InstructionsDecision } from "./instructions-write-decision";

export interface PlanMemoryRemoveInput {
  agentId: AgentId;
  home: string;
}

function instructionsComponentStatus(decision: InstructionsDecision): MemoryIntegrationComponentStatus {
  return decision.kind === "write" ? { kind: "write" } : decision;
}

export async function planMemoryRemove(registry: AgentRegistry, input: PlanMemoryRemoveInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const mcpDecision = await decideMcpRemove(adapter, input.home, ENGRAM_MCP_SERVER);
  const instructionsDecision = await decideInstructionsRemove(adapter, input.home);

  const writes: PlanWrite[] = [];
  if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);

  const mcpStatus: MemoryIntegrationComponentStatus =
    mcpDecision.decision.kind === "unrecognized"
      ? {
          kind: "blocked",
          reason: "mcp-unrecognized",
          details: `The "${ENGRAM_MCP_SERVER.name}" MCP entry at ${mcpDecision.configPath} does not match what Forge614 would have installed`,
        }
      : mcpDecision.decision.kind === "noop"
        ? { kind: "noop" }
        : { kind: "write" };

  const instructionsStatus = instructionsComponentStatus(instructionsDecision);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "memory-remove",
    noop: writes.length === 0,
    writes,
    metadata: {
      mcp: { path: mcpDecision.configPath, status: mcpStatus },
      instructions: { paths: instructionsPaths, status: instructionsStatus },
      overallStatus: computeOverallStatus(mcpStatus, instructionsStatus),
    },
  };

  await savePlan(input.home, plan);
  return plan;
}
