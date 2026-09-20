import { createHash } from "node:crypto";
import type { AgentAdapter, McpServerDefinition } from "../modules/agents/types";
import { decideMcpWrite, type DiffDecision } from "../modules/config-writer/decide";
import type { PlanWrite } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";

export interface McpInstallDecision {
  configPath: string;
  decision: DiffDecision;
  write?: PlanWrite;
}

export async function decideMcpInstall(
  adapter: AgentAdapter,
  home: string,
  server: McpServerDefinition,
): Promise<McpInstallDecision> {
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const desired = adapter.mcpEntryShape(server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, server.name);
  const decision = decideMcpWrite(existing, desired);

  if (decision.kind !== "write") return { configPath, decision };

  return {
    configPath,
    decision,
    write: {
      path: configPath,
      beforeHash: createHash("sha256").update(exists ? raw : "").digest("hex"),
      afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, server.name, desired),
    },
  };
}

export type McpRemoveDiffDecision = { kind: "noop" } | { kind: "unrecognized" } | { kind: "write" };

export interface McpRemoveDecision {
  configPath: string;
  decision: McpRemoveDiffDecision;
  write?: PlanWrite;
}

export async function decideMcpRemove(
  adapter: AgentAdapter,
  home: string,
  server: McpServerDefinition,
): Promise<McpRemoveDecision> {
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const expected = adapter.mcpEntryShape(server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, server.name);

  if (existing === undefined) return { configPath, decision: { kind: "noop" } };
  if (JSON.stringify(existing) !== JSON.stringify(expected)) return { configPath, decision: { kind: "unrecognized" } };

  return {
    configPath,
    decision: { kind: "write" },
    write: {
      path: configPath,
      beforeHash: createHash("sha256").update(exists ? raw : "").digest("hex"),
      afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, server.name, undefined),
    },
  };
}
