import { createHash } from "node:crypto";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import type { Plan } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { newPlanId, savePlan } from "../infrastructure/plan-store";

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

  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const expected = adapter.mcpEntryShape(input.server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, input.server.name);

  const planId = newPlanId();

  if (existing === undefined) {
    const plan: Plan = { planId, agentId: input.agentId, action: "mcp-remove", noop: true, writes: [] };
    await savePlan(input.home, plan);
    return plan;
  }

  if (JSON.stringify(existing) !== JSON.stringify(expected)) {
    throw new UnrecognizedEntryError(input.server.name);
  }

  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-remove",
    noop: false,
    writes: [
      {
        path: configPath,
        beforeHash: createHash("sha256")
          .update(exists ? raw : "")
          .digest("hex"),
        afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, input.server.name, undefined),
      },
    ],
  };
  await savePlan(input.home, plan);
  return plan;
}
