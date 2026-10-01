import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { HookComponentStatus, MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { resolveMemoryHookCommand } from "../modules/agents/hook-command";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { renderProtocolMarkdown } from "../modules/memory-protocol/render";
import { computeOverallStatus } from "../modules/memory-protocol/status";
import { fetchMemoryProtocol, type MemoryProtocolFetchOptions } from "../infrastructure/engram/memory-protocol-client";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { readHookEvidence } from "./hook-evidence";
import { computeHookRuntimeStatus } from "./hook-runtime-status";
import { decideHookInstall } from "./hook-write-decision";
import { decideMcpInstall } from "./mcp-write-decision";
import { decideInstructionsInstall, type InstructionsDecision } from "./instructions-write-decision";
import { lastWritePerPath } from "./last-write-per-path";
import { decideToolApprovalInstall, toolApprovalComponentStatus } from "./tool-approval-write-decision";

export interface PlanMemoryInstallInput {
  agentId: AgentId;
  home: string;
  /** Test seam for the Engram subprocess invocation; production callers omit this. */
  protocolOptions?: MemoryProtocolFetchOptions;
}

function instructionsComponentStatus(decision: InstructionsDecision): MemoryIntegrationComponentStatus {
  return decision.kind === "write" ? { kind: "write", ...(decision.notice ? { notice: decision.notice } : {}) } : decision;
}

export async function planMemoryInstall(registry: AgentRegistry, input: PlanMemoryInstallInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const { protocol, fingerprint, legacyProtocolNotice } = await fetchMemoryProtocol(input.home, input.protocolOptions);
  const protocolMarkdown = renderProtocolMarkdown(protocol);

  const engramServer = resolveEngramMcpServer(input.home);
  const mcpDecision = await decideMcpInstall(adapter, input.home, engramServer);
  const instructionsDecision = await decideInstructionsInstall(adapter, input.home, protocolMarkdown);
  const hookCommand = resolveMemoryHookCommand(input.home, input.agentId);
  // Codex keeps both mcp_servers and hooks.SessionStart in the same config.toml.
  // If the MCP decision already produced a write for that same file, the hook
  // decision must build on top of that write's content (not re-read the
  // still-unmodified disk file), or applying both writes in sequence would have
  // the second silently clobber the first's change.
  const hookSeed =
    mcpDecision.write && adapter.hooks && adapter.hooks.configFile(input.home) === mcpDecision.configPath
      ? { raw: mcpDecision.write.afterContent }
      : undefined;
  const hookDecision = await decideHookInstall(adapter, input.home, hookCommand, hookSeed);

  // The approval lives in a file a sibling decision may also write (settings.json with the hook for
  // Claude Code; config.toml with the MCP entry and the hook for Codex), so it builds on the latest
  // sibling write to that file. A conflicting MCP entry is never approved: it is not ours.
  const approvalFile = adapter.toolApproval?.configFile(input.home);
  const approvalSeedWrite = [mcpDecision.write, hookDecision.write].filter((w) => w && w.path === approvalFile).pop();
  const mcpConflict = mcpDecision.decision.kind === "conflict";
  const approvalDecision = mcpConflict && adapter.toolApproval
    ? undefined
    : await decideToolApprovalInstall(adapter, input.home, engramServer.name, approvalSeedWrite ? { raw: approvalSeedWrite.afterContent } : undefined);

  const writes: PlanWrite[] = [];
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);
  // One physical write per file: each later decision for the same path already carries the earlier
  // ones (through the seeds above), so only the last write for each path is kept.
  const configWrites = [
    mcpDecision.decision.kind === "write" ? mcpDecision.write : undefined,
    hookDecision.decision.kind === "write" ? hookDecision.write : undefined,
    approvalDecision?.decision.kind === "write" ? approvalDecision.write : undefined,
  ].filter((w): w is PlanWrite => w !== undefined);
  writes.push(...lastWritePerPath(configWrites));

  const mcpStatus: MemoryIntegrationComponentStatus =
    mcpDecision.decision.kind === "conflict"
      ? {
          kind: "blocked",
          reason: "mcp-conflict",
          details: `An existing "${engramServer.name}" MCP entry with different content is already present at ${mcpDecision.configPath}`,
        }
      : mcpDecision.decision.kind === "noop"
        ? { kind: "noop" }
        : { kind: "write" };

  const approvalStatus: MemoryIntegrationComponentStatus = !approvalDecision
    ? {
        kind: "blocked",
        reason: "mcp-conflict",
        details: `An existing "${engramServer.name}" MCP entry with different content is present at ${mcpDecision.configPath}, so its tools are not approved automatically`,
      }
    : toolApprovalComponentStatus(adapter, approvalDecision, engramServer.name, "install");
  const approvalPath = approvalDecision?.configPath ?? approvalFile ?? "";

  const instructionsStatus = instructionsComponentStatus(instructionsDecision);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];

  // Purely structural: does this plan's write make the config entry correct.
  // Never enough on its own to call the hook component "ok" — see below.
  const hookStatus: HookComponentStatus = !adapter.hooks
    ? {
        kind: "unsupported",
        reason: `${adapter.label} has no officially supported, stable session-start hook mechanism this installer configures`,
      }
    : hookDecision.decision.kind === "blocked"
      ? {
          kind: "blocked",
          reason: hookDecision.blockedReason ?? "hook-conflict",
          details: `The SessionStart hook entries at ${hookDecision.configPath} are not in the expected array shape`,
        }
      : hookDecision.decision.kind === "noop"
        ? { kind: "noop" }
        : { kind: "write" };

  // Whether the hook actually works: a config entry that IS or WOULD BE correct
  // is not proof anything ever ran it. Reuse the exact same evidence check
  // `verify` uses, so a plan can never claim "complete" for a hook no real
  // session has executed yet — that was a real bug this guards against.
  const hookStructurallyOk = hookStatus.kind === "noop" || hookStatus.kind === "write";
  const hookEvidence = hookStructurallyOk ? await readHookEvidence(input.home, input.agentId) : ({ kind: "absent" } as const);
  const hookRuntimeStatus = computeHookRuntimeStatus(adapter, hookStructurallyOk, hookEvidence);

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "memory-install",
    noop: writes.length === 0,
    writes,
    metadata: {
      protocol: {
        source: "forge614-engram memory-protocol --json",
        id: protocol.id,
        version: protocol.version,
        fingerprint: fingerprint,
        ...(legacyProtocolNotice ? { legacyNotice: legacyProtocolNotice } : {}),
      },
      mcp: { path: mcpDecision.configPath, status: mcpStatus },
      instructions: { paths: instructionsPaths, status: instructionsStatus },
      hook: { path: hookDecision.configPath, status: hookStatus, runtimeStatus: hookRuntimeStatus },
      approval: { path: approvalPath, status: approvalStatus },
      overallStatus: computeOverallStatus(mcpStatus, instructionsStatus, hookRuntimeStatus, approvalStatus),
    },
  };

  await savePlan(input.home, plan);
  return plan;
}
