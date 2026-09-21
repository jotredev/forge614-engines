import { createHash } from "node:crypto";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { McpRepairPreview, McpRepairStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { isPathWritable } from "../infrastructure/config-io/writable";
import { redactMcpEntry } from "../modules/config-writer/redact";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { newPlanId, savePlan } from "../infrastructure/plan-store";

export interface PlanMcpRepairInput {
  agentId: AgentId;
  home: string;
}

export async function planMcpRepair(registry: AgentRegistry, input: PlanMcpRepairInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const engramServer = resolveEngramMcpServer(input.home);
  const desired = adapter.mcpEntryShape(engramServer);
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);

  let status: McpRepairStatus;
  let blockedReason: McpRepairPreview["blockedReason"];
  let existingPreview: unknown;
  let writes: PlanWrite[] = [];

  if (!exists) {
    status = "not-installed";
  } else if (!format.isParsable(raw)) {
    status = "blocked";
    blockedReason = "unparsable-config";
  } else {
    const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, engramServer.name);
    if (existing === undefined) {
      status = "not-installed";
    } else if (JSON.stringify(existing) === JSON.stringify(desired)) {
      status = "already-correct";
    } else {
      existingPreview = redactMcpEntry(existing);
      if (await isPathWritable(configPath)) {
        status = "repairable-conflict";
        writes = [
          {
            path: configPath,
            beforeHash: createHash("sha256").update(raw).digest("hex"),
            afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, engramServer.name, desired),
          },
        ];
      } else {
        status = "blocked";
        blockedReason = "not-writable";
      }
    }
  }

  const repair: McpRepairPreview = {
    agentId: input.agentId,
    configPath,
    status,
    canonical: { name: engramServer.name, command: engramServer.command, args: engramServer.args },
    ...(existingPreview !== undefined ? { existing: existingPreview } : {}),
    ...(blockedReason ? { blockedReason } : {}),
  };

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-repair",
    noop: writes.length === 0,
    writes,
    repair,
  };

  await savePlan(input.home, plan);
  return plan;
}
