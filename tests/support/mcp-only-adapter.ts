import { join } from "node:path";
import type { AgentAdapter, AgentId, McpServerDefinition } from "../../src/modules/agents/types";

/**
 * Id of the fictional MCP-only test agent. It is deliberately not a member of `AgentId` (no real agent
 * has this shape any more), so it is cast; tests pass it wherever the core expects an agent id.
 */
export const MCP_ONLY_ID = "mcp-only-test" as unknown as AgentId;

/**
 * Display label of the MCP-only test agent. The core builds its "has no ..." reasons from
 * `adapter.label`, so tests assert on this exact text.
 */
export const MCP_ONLY_LABEL = "MCP-only test agent";

/**
 * Fictional adapter that only supports MCP: no hooks, no instructions target, no tool approval and no
 * headless execution. It exists so the generic core logic for agents that lack those pieces (components
 * reported `unsupported`, `overallStatus` partial/complete and `fullySupported: false`) keeps tests now
 * that every real agent is fully supported. It carries no product name and lives outside `src/` because
 * it is test support, not product code.
 */
export const mcpOnlyAdapter: AgentAdapter = {
  id: MCP_ONLY_ID,
  label: MCP_ONLY_LABEL,
  capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false, supportsReasoningLevel: false },
  configFormat: "json",
  mcpEntryPath: ["mcpServers"],
  candidateExecutableNames: () => [],
  knownInstallPaths: () => [],
  configDir: (home) => join(home, ".mcp-only-test"),
  configFile: (home) => join(home, ".mcp-only-test", "mcp.json"),
  mcpEntryShape: (server: McpServerDefinition) => ({ command: server.command, args: server.args }),
};
