export type AgentId = "claude-code" | "codex" | "cursor";

export type ConfigFormat = "json" | "toml";

export interface McpServerDefinition {
  name: string;
  command: string;
  args: string[];
}

export interface HeadlessOptions {
  prompt: string;
  timeoutMs?: number;
}

export interface HeadlessCommand {
  command: string;
  args: string[];
}

export interface AgentCapabilities {
  supportsMcp: boolean;
  supportsHooks: boolean;
  supportsHeadlessExec: boolean;
}

export interface AgentAdapter {
  id: AgentId;
  label: string;
  capabilities: AgentCapabilities;
  configFormat: ConfigFormat;
  /** Key path inside the config document where MCP servers live, e.g. ["mcpServers"]. */
  mcpEntryPath: string[];
  candidateExecutableNames(platform: NodeJS.Platform): string[];
  knownInstallPaths(platform: NodeJS.Platform, home: string): string[];
  configDir(home: string): string;
  configFile(home: string): string;
  mcpEntryShape(server: McpServerDefinition): unknown;
  headlessCommand?(executable: string, opts: HeadlessOptions): HeadlessCommand;
}
