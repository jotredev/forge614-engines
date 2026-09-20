import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex",
  capabilities: { supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true },
  configFormat: "toml",
  mcpEntryPath: ["mcp_servers"],
  candidateExecutableNames(platform) {
    return platform === "win32" ? ["codex.exe"] : ["codex"];
  },
  knownInstallPaths() {
    return [];
  },
  configDir(home) {
    return join(home, ".codex");
  },
  configFile(home) {
    return join(home, ".codex", "config.toml");
  },
  mcpEntryShape(server: McpServerDefinition) {
    return { command: server.command, args: server.args };
  },
  instructions: {
    primaryFile(home) {
      return join(home, ".codex", "AGENTS.md");
    },
    shadowingFiles(home) {
      return [join(home, ".codex", "AGENTS.override.md")];
    },
  },
  headlessCommand(executable, opts) {
    return { command: executable, args: ["exec", opts.prompt] };
  },
};
