import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { HookComponentStatus, MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { resolveHookEvidencePath, resolveMemoryHookCommand } from "../modules/agents/hook-command";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { computeRemovalStatus } from "../modules/memory-protocol/status";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideHookRemove } from "./hook-write-decision";
import { decideMcpRemove } from "./mcp-write-decision";
import { decideInstructionsRemove, type InstructionsDecision } from "./instructions-write-decision";
import { lastWritePerPath } from "./last-write-per-path";
import { decideToolApprovalRemove, toolApprovalComponentStatus } from "./tool-approval-write-decision";

/** Removes only this agent's own execution evidence, if any — never a sibling agent's, and never a no-op write when nothing was ever recorded. */
async function evidenceRemovalWrite(home: string, agentId: AgentId): Promise<PlanWrite | undefined> {
  const path = resolveHookEvidencePath(home, agentId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  return { path, beforeHash: createHash("sha256").update(raw).digest("hex"), afterContent: "", delete: true };
}

export interface PlanMemoryRemoveInput {
  agentId: AgentId;
  home: string;
}

function instructionsComponentStatus(decision: InstructionsDecision): MemoryIntegrationComponentStatus {
  return decision.kind === "write" ? { kind: "write", ...(decision.notice ? { notice: decision.notice } : {}) } : decision;
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
  const evidenceWrite = await evidenceRemovalWrite(input.home, input.agentId);

  // Same shared-file chain for the approval (settings.json with the hook, config.toml with the MCP
  // entry and the hook): it builds on the latest sibling write to its file. On Codex the approval key
  // leaves together with the MCP entry, so after that write there is nothing left for it to remove.
  const approvalFile = adapter.toolApproval?.configFile(input.home);
  const approvalSeedWrite = [mcpDecision.write, hookDecision.write].filter((w) => w && w.path === approvalFile).pop();
  const approvalDecision = await decideToolApprovalRemove(
    adapter,
    input.home,
    engramServer.name,
    approvalSeedWrite ? { raw: approvalSeedWrite.afterContent } : undefined,
  );

  const writes: PlanWrite[] = [];
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);
  // One physical write per file: later decisions for the same path already carry the earlier ones
  // (through the seeds above), so only the last write for each path is kept.
  const configWrites = [
    mcpDecision.decision.kind === "write" ? mcpDecision.write : undefined,
    hookDecision.decision.kind === "write" ? hookDecision.write : undefined,
    approvalDecision.decision.kind === "write" ? approvalDecision.write : undefined,
  ].filter((w): w is PlanWrite => w !== undefined);
  writes.push(...lastWritePerPath(configWrites));
  if (evidenceWrite) writes.push(evidenceWrite);

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

  const approvalStatus = toolApprovalComponentStatus(adapter, approvalDecision, engramServer.name, "remove");

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
      approval: { path: approvalDecision.configPath, status: approvalStatus },
      overallStatus: computeRemovalStatus(mcpStatus, instructionsStatus, hookStatus, approvalStatus),
    },
  };

  await savePlan(input.home, plan);
  return plan;
}
