import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  label: "Cursor",
  capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false },
  configFormat: "json",
  mcpEntryPath: ["mcpServers"],
  candidateExecutableNames() {
    return [];
  },
  knownInstallPaths(platform) {
    if (platform !== "darwin") return [];
    return ["/Applications/Cursor.app/Contents/MacOS/Cursor"];
  },
  configDir(home) {
    return join(home, ".cursor");
  },
  configFile(home) {
    return join(home, ".cursor", "mcp.json");
  },
  mcpEntryShape(server: McpServerDefinition) {
    return { command: server.command, args: server.args };
  },
};
