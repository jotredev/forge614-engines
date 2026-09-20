import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { ENGRAM_MCP_SERVER } from "../modules/memory-protocol/constants";
import { renderProtocolMarkdown } from "../modules/memory-protocol/render";
import { computeOverallStatus } from "../modules/memory-protocol/status";
import { fetchMemoryProtocol, type MemoryProtocolFetchOptions } from "../infrastructure/engram/memory-protocol-client";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpInstall } from "./mcp-write-decision";
import { decideInstructionsInstall, type InstructionsDecision } from "./instructions-write-decision";

export interface PlanMemoryInstallInput {
  agentId: AgentId;
  home: string;
  /** Test seam for the Engram subprocess invocation; production callers omit this. */
  protocolOptions?: MemoryProtocolFetchOptions;
}

function instructionsComponentStatus(decision: InstructionsDecision): MemoryIntegrationComponentStatus {
  return decision.kind === "write" ? { kind: "write" } : decision;
}

export async function planMemoryInstall(registry: AgentRegistry, input: PlanMemoryInstallInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const { protocol, fingerprint } = await fetchMemoryProtocol(input.protocolOptions);
  const protocolMarkdown = renderProtocolMarkdown(protocol);

  const mcpDecision = await decideMcpInstall(adapter, input.home, ENGRAM_MCP_SERVER);
  const instructionsDecision = await decideInstructionsInstall(adapter, input.home, protocolMarkdown);

  const writes: PlanWrite[] = [];
  if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);

  const mcpStatus: MemoryIntegrationComponentStatus =
    mcpDecision.decision.kind === "conflict"
      ? {
          kind: "blocked",
          reason: "mcp-conflict",
          details: `An existing "${ENGRAM_MCP_SERVER.name}" MCP entry with different content is already present at ${mcpDecision.configPath}`,
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
    action: "memory-install",
    noop: writes.length === 0,
    writes,
    metadata: {
      protocol: { source: "forge614-engram memory-protocol --json", id: protocol.id, version: protocol.version, fingerprint: fingerprint },
      mcp: { path: mcpDecision.configPath, status: mcpStatus },
      instructions: { paths: instructionsPaths, status: instructionsStatus },
      overallStatus: computeOverallStatus(mcpStatus, instructionsStatus),
    },
  };

  await savePlan(input.home, plan);
  return plan;
}
