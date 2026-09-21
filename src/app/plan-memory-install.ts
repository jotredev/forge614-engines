import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { HookComponentStatus, MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { resolveMemoryHookCommand } from "../modules/agents/hook-command";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { renderProtocolMarkdown } from "../modules/memory-protocol/render";
import { computeOverallStatus } from "../modules/memory-protocol/status";
import { fetchMemoryProtocol, type MemoryProtocolFetchOptions } from "../infrastructure/engram/memory-protocol-client";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideHookInstall } from "./hook-write-decision";
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

  const { protocol, fingerprint } = await fetchMemoryProtocol(input.home, input.protocolOptions);
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

  const writes: PlanWrite[] = [];
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);
  if (hookSeed) {
    // Only one physical write is needed for the shared file: the hook decision's
    // afterContent already includes the MCP change (via the seed above), so
    // pushing both would stage two independent writes to the same path.
    if (hookDecision.decision.kind === "write" && hookDecision.write) writes.push(hookDecision.write);
    else if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
  } else {
    if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
    if (hookDecision.decision.kind === "write" && hookDecision.write) writes.push(hookDecision.write);
  }

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

  const instructionsStatus = instructionsComponentStatus(instructionsDecision);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];

  const hookOutcomeStatus: HookComponentStatus = !adapter.hooks
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

  // A hook that is (or would be) structurally present is not necessarily one Codex
  // will actually run: non-managed Codex hooks require one-time interactive trust
  // Engines has no stable, documented way to grant or verify. Report that
  // explicitly instead of claiming ok — see the spec's "needs-user-trust" contract.
  const hookStatus: HookComponentStatus =
    adapter.hooks?.requiresUserTrust && (hookOutcomeStatus.kind === "noop" || hookOutcomeStatus.kind === "write")
      ? {
          kind: "needs-user-trust",
          agentId: "codex",
          configPath: hookDecision.configPath,
          details: `Codex requires reviewing and trusting this hook once via its own interactive "/hooks" command before it will run it; Engines cannot verify or grant that trust.`,
        }
      : hookOutcomeStatus;

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
      hook: { path: hookDecision.configPath, status: hookStatus },
      overallStatus: computeOverallStatus(mcpStatus, instructionsStatus, hookStatus),
    },
  };

  await savePlan(input.home, plan);
  return plan;
}
