import { createHash } from "node:crypto";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import { decideMcpWrite } from "../modules/config-writer/decide";
import { ConfigConflictError, type Plan } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { newPlanId, savePlan } from "../infrastructure/plan-store";

export interface PlanMcpInstallInput {
  agentId: AgentId;
  server: McpServerDefinition;
  home: string;
}

export async function planMcpInstall(registry: AgentRegistry, input: PlanMcpInstallInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const desired = adapter.mcpEntryShape(input.server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, input.server.name);

  const decision = decideMcpWrite(existing, desired);
  if (decision.kind === "conflict") throw new ConfigConflictError(configPath, input.server.name);

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-install",
    noop: decision.kind === "noop",
    writes:
      decision.kind === "noop"
        ? []
        : [
            {
              path: configPath,
              beforeHash: createHash("sha256")
                .update(exists ? raw : "")
                .digest("hex"),
              afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, input.server.name, desired),
            },
          ],
  };

  await savePlan(input.home, plan);
  return plan;
}
