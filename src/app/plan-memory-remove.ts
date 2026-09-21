import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { HookComponentStatus, MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { resolveMemoryHookCommand } from "../modules/agents/hook-command";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { computeRemovalStatus } from "../modules/memory-protocol/status";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideHookRemove } from "./hook-write-decision";
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

  const engramServer = resolveEngramMcpServer(input.home);
  const mcpDecision = await decideMcpRemove(adapter, input.home, engramServer);
  const instructionsDecision = await decideInstructionsRemove(adapter, input.home);
  const hookCommand = resolveMemoryHookCommand(input.home, input.agentId);
  // Same shared-file collision as install: Codex keeps mcp_servers and
  // hooks.SessionStart in one config.toml, so if the MCP removal already
  // produced a write for that file, the hook removal must build on top of that
  // write's content instead of the two independently clobbering each other.
  const hookSeed =
    mcpDecision.write && adapter.hooks && adapter.hooks.configFile(input.home) === mcpDecision.configPath
      ? { raw: mcpDecision.write.afterContent }
      : undefined;
  const hookDecision = await decideHookRemove(adapter, input.home, hookCommand, hookSeed);

  const writes: PlanWrite[] = [];
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);
  if (hookSeed) {
    if (hookDecision.decision.kind === "write" && hookDecision.write) writes.push(hookDecision.write);
    else if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
  } else {
    if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
    if (hookDecision.decision.kind === "write" && hookDecision.write) writes.push(hookDecision.write);
  }

  const mcpStatus: MemoryIntegrationComponentStatus =
    mcpDecision.decision.kind === "unrecognized"
      ? {
          kind: "blocked",
          reason: "mcp-unrecognized",
          details: `The "${engramServer.name}" MCP entry at ${mcpDecision.configPath} does not match what Forge614 would have installed`,
        }
      : mcpDecision.decision.kind === "noop"
        ? { kind: "noop" }
        : { kind: "write" };

  const instructionsStatus = instructionsComponentStatus(instructionsDecision);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];

  const hookStatus: HookComponentStatus = !adapter.hooks
    ? { kind: "unsupported", reason: `${adapter.label} has no managed hook to remove` }
    : hookDecision.decision.kind === "blocked"
      ? {
          kind: "blocked",
          reason: hookDecision.blockedReason ?? "hook-conflict",
          details: `The SessionStart hook entries at ${hookDecision.configPath} are not in the expected array shape`,
        }
      : hookDecision.decision.kind === "noop"
        ? { kind: "noop" }
        : { kind: "write" };

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
      hook: { path: hookDecision.configPath, status: hookStatus },
      overallStatus: computeRemovalStatus(mcpStatus, instructionsStatus, hookStatus),
    },
  };

  await savePlan(input.home, plan);
  return plan;
}
