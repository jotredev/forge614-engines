export type AgentId = "claude-code" | "codex" | "cursor";

export type ConfigFormat = "json" | "toml";

export type ReasoningLevel = "low" | "medium" | "high";

export class ReasoningLevelUnsupportedError extends Error {
  constructor(agentId: AgentId) {
    super(`${agentId} does not support selecting a reasoning level for headless execution`);
  }
}

export interface McpServerDefinition {
  name: string;
  command: string;
  args: string[];
}

export interface HeadlessOptions {
  prompt: string;
  timeoutMs?: number;
  model?: string;
  reasoningLevel?: ReasoningLevel;
}

export interface HeadlessCommand {
  command: string;
  args: string[];
}

export interface InstructionsTarget {
  /** File the agent reads automatically at the start of every new session. */
  primaryFile(home: string): string;
  /** Files that, if present, would take priority over `primaryFile` and silently shadow it. */
  shadowingFiles(home: string): string[];
  /** When present, `primaryFile` holds only a one-line import pointing at this file (same directory), which holds the full rendered content. When absent, the full content is embedded directly inside `primaryFile`'s managed block. */
  contentFile?(home: string): string;
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
  /** Absent when this agent has no officially supported, stable, file-based mechanism to auto-load global instructions in new sessions. */
  instructions?: InstructionsTarget;
}
