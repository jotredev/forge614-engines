import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  label: "Claude Code",
  capabilities: { supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true },
  configFormat: "json",
  mcpEntryPath: ["mcpServers"],
  candidateExecutableNames(platform) {
    return platform === "win32" ? ["claude.exe"] : ["claude"];
  },
  knownInstallPaths(_platform, home) {
    return [join(home, ".local", "bin", "claude")];
  },
  configDir(home) {
    return join(home, ".claude");
  },
  configFile(home) {
    return join(home, ".claude.json");
  },
  mcpEntryShape(server: McpServerDefinition) {
    return { command: server.command, args: server.args };
  },
  headlessCommand(executable, opts) {
    return { command: executable, args: ["-p", opts.prompt] };
  },
};
