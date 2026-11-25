import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

/**
 * Session-only `--settings` payload that locks Antigravity CLI headless runs to read-only.
 *
 * Measured live against `agy` 1.5.16 (empty cwd, `--add-dir`, real Engram stdio MCP server):
 * - Antigravity evaluates permission rules in strict order Deny > Ask > Allow, and `--settings`
 *   applies to this session only without modifying `~/.gemini/antigravity-cli/settings.json`.
 * - Denying `write_file(*)`, `command(*)`, `mcp(*)`, `read_url(*)`, and `execute_url(*)` while
 *   keeping `agentMode: ""` and `toolPermission: "request-review"` lets `read_file` inspect files
 *   inside the workspace and `--add-dir` while rejecting file writes, shell commands (including
 *   unsandboxed execution), web fetches, and every MCP tool (`memory_save` and `memory_context`
 *   included).
 */
export const ANTIGRAVITY_READ_ONLY_SETTINGS = JSON.stringify({
  agentMode: "",
  toolPermission: "request-review",
  permissions: {
    allow: [],
    ask: [],
    deny: ["write_file(*)", "command(*)", "mcp(*)", "read_url(*)", "execute_url(*)"],
  },
});

export const antigravityAdapter: AgentAdapter = {
  id: "antigravity",
  label: "Antigravity",
  capabilities: {
    supportsMcp: true,
    supportsHooks: true,
    supportsHeadlessExec: true,
    supportsReasoningLevel: true,
    supportsReadOnly: true,
  },
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
  configFormat: "json",
  mcpEntryPath: ["mcpServers"],
  candidateExecutableNames(platform) {
    return platform === "win32" ? ["agy.exe"] : ["agy"];
  },
  knownInstallPaths(platform, home) {
    return platform === "win32"
      ? [join(home, "AppData", "Local", "agy", "bin", "agy.exe")]
      : [join(home, ".local", "bin", "agy")];
  },
  configDir(home) {
    return join(home, ".gemini", "antigravity-cli");
  },
  configFile(home) {
    return join(home, ".gemini", "config", "mcp_config.json");
  },
  mcpEntryShape(server: McpServerDefinition) {
    return { command: server.command, args: server.args };
  },
  instructions: {
    // Official global always-on rule file inside Antigravity's global config directory
    // (`~/.gemini/config/`), keeping it isolated from Gemini CLI's `~/.gemini/GEMINI.md`.
    // Antigravity loads global rules cumulatively rather than replacing them, so nothing shadows it.
    primaryFile(home) {
      return join(home, ".gemini", "config", "AGENTS.md");
    },
    shadowingFiles() {
      return [];
    },
  },
  hooks: {
    // Antigravity CLI loads global hooks from `~/.gemini/config/hooks.json` (hooks inside
    // `settings.json` are ignored). Each top-level key is a named hook group, and `SessionStart`
    // takes a flat array of command handler objects directly (no matcher wrapper).
    configFile(home) {
      return join(home, ".gemini", "config", "hooks.json");
    },
    configFormat: "json",
    entryPath: ["forge614-engram-memory", "SessionStart"],
    entryStyle: "flat",
    removeEmptyParent: true,
    entryShape(command) {
      return { type: "command", command };
    },
    // Verified live against `agy` 1.5.16: SessionStart hooks execute immediately on the next
    // session with no interactive trust approval gate.
    requiresUserTrust: false,
  },
  // Global permission rules in `~/.gemini/antigravity-cli/settings.json`. Antigravity evaluates
  // Deny > Ask > Allow; `mcp(<server>/*)` pre-approves every tool on that MCP server so Engram
  // memory calls do not block or soft-deny in modes that cannot prompt.
  toolApproval: {
    kind: "permission-rules",
    configFile(home) {
      return join(home, ".gemini", "antigravity-cli", "settings.json");
    },
    configFormat: "json",
    allowPath: ["permissions", "allow"],
    denyPath: ["permissions", "deny"],
    askPath: ["permissions", "ask"],
    serverRule(serverName) {
      return `mcp(${serverName}/*)`;
    },
    toolRulePrefix(serverName) {
      return `mcp(${serverName}/`;
    },
  },
  headlessCommand(executable, opts) {
    // Verified live against `agy` 1.5.16:
    // - `--add-dir <dir>` adds a workspace folder before the prompt (repeatable). Note: like Codex,
    //   Antigravity loads `AGENTS.md` from an `--add-dir` folder; with `--read-only`, writes,
    //   commands and MCP tools are still denied.
    // - `--settings <json>` locks read-only for this session only without touching `settings.json`.
    // - `--print-timeout <ms>ms` enforces a positive timeout natively in print mode.
    // - `--model <slug>` and `--effort <level>` configure model and reasoning level (`agy` rejects
    //   mismatched effort on a slug that already encodes a different effort, and rejects an effort
    //   a specific model lacks).
    // - For stdin delivery (`--stdin-prompt`), `-p` requires an argument and cannot be left empty,
    //   whereas `--input-format text` without `-p` reads the prompt cleanly from piped stdin in
    //   non-interactive print mode.
    const args: string[] = [];
    if (opts.readableDir) args.push("--add-dir", opts.readableDir);
    if (opts.readOnly) args.push("--settings", ANTIGRAVITY_READ_ONLY_SETTINGS);
    if (opts.timeoutMs !== undefined && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0) {
      args.push("--print-timeout", `${Math.ceil(opts.timeoutMs)}ms`);
    }
    if (opts.model) args.push("--model", opts.model);
    if (opts.reasoningLevel) args.push("--effort", opts.reasoningLevel);
    if (opts.stdinPrompt) {
      args.push("--input-format", "text");
      return { command: executable, args, stdin: true };
    }
    args.push("-p", opts.prompt);
    return { command: executable, args };
  },
};
