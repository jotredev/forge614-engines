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
  /**
   * When true, the adapter must omit the prompt from `args` and set
   * `stdin: true` on the returned command instead, so the caller writes the
   * prompt to the spawned process's stdin rather than leaving it visible to
   * `ps` as a process argument. An adapter that cannot honor this must throw
   * explicitly (the same pattern as ReasoningLevelUnsupportedError) rather
   * than silently leaving the prompt in args.
   */
  stdinPrompt?: boolean;
  /**
   * Grants the spawned process read access to this directory in addition to
   * the agent's normal working directory, without otherwise loosening
   * isolation. Maps to `--add-dir` on both Claude Code and Codex; on Codex
   * this is accepted as a read-only grant only because `codex exec` defaults
   * to a read-only sandbox unless `--sandbox workspace-write` or
   * `--sandbox danger-full-access` is also passed (never done here).
   */
  readableDir?: string;
}

export interface HeadlessCommand {
  command: string;
  args: string[];
  /** Present and true only when the prompt was deliberately left out of `args` per `stdinPrompt`. */
  stdin?: boolean;
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
  /** Whether headlessCommand() accepts HeadlessOptions.reasoningLevel instead of rejecting it via ReasoningLevelUnsupportedError. The single source of truth headlessCommandFor() and the capabilities report both read. */
  supportsReasoningLevel: boolean;
}

export interface HookTarget {
  /** File this agent reads its SessionStart hooks from. May differ from configFile() — Claude Code keeps hooks in a settings file separate from its mcpServers file. */
  configFile(home: string): string;
  configFormat: ConfigFormat;
  /** Key path to the SessionStart hook-group array inside that file, e.g. ["hooks", "SessionStart"]. */
  entryPath: string[];
  /** Builds one hook-group array element (not the whole array) for the given exact shell command string. */
  entryShape(command: string): unknown;
  /**
   * True when this agent gates hook execution behind a one-time interactive trust
   * approval that Engines has no stable, documented way to grant or verify on the
   * user's behalf (Codex). False when an installed hook simply runs (Claude Code).
   */
  requiresUserTrust: boolean;
}

/**
 * How an agent leaves the tools of an MCP server approved "always".
 *
 * It exists because some permission modes cannot ask: Claude Code in `dontAsk` denies every
 * tool that is not in `permissions.allow`, and Codex with `approval_policy = "never"` denies
 * the MCP tool that asks for approval. Without approval, Engram memory fails in exactly those modes.
 */
export type ToolApprovalTarget = PermissionRulesApproval | ServerModeApproval;

/**
 * Approval through permission rules (Claude Code): a rule in the `allow` list.
 * Since `deny` and `ask` are evaluated before `allow`, removing from those lists the rules
 * that cover the server is part of approving it.
 */
export interface PermissionRulesApproval {
  kind: "permission-rules";
  /** The agent's user-level permissions file. */
  configFile(home: string): string;
  configFormat: ConfigFormat;
  allowPath: string[];
  denyPath: string[];
  askPath: string[];
  /** Rule that approves the whole server, e.g. `mcp__forge614-engram`. */
  serverRule(serverName: string): string;
  /** Prefix shared by the rules that cover a single tool of the server, e.g. `mcp__forge614-engram__`. */
  toolRulePrefix(serverName: string): string;
}

/**
 * Approval through a mode in the server's entry (Codex): a key inside the MCP server's
 * table, which goes away together with the entry on uninstall.
 */
export interface ServerModeApproval {
  kind: "server-mode";
  configFile(home: string): string;
  configFormat: ConfigFormat;
  /** Path of the key inside the document, e.g. `["mcp_servers", "forge614-engram", "default_tools_approval_mode"]`. */
  keyPath(serverName: string): string[];
  /** Value that always approves, e.g. `"approve"`. */
  approvedValue: string;
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
  /** Absent when this agent has no officially supported, stable session-start hook mechanism this installer can configure. */
  hooks?: HookTarget;
  /** Absent when this agent has no stable, file-based way to pre-approve an MCP server's tools that this installer can configure. */
  toolApproval?: ToolApprovalTarget;
}
