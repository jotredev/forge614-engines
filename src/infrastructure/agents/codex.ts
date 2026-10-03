import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";
import { MEMORY_HOOK_CONTEXT_TOKEN_LIMIT } from "../../modules/agents/hook-command";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex",
  capabilities: {
    supportsMcp: true,
    supportsHooks: true,
    supportsHeadlessExec: true,
    supportsReasoningLevel: true,
    supportsReadOnly: true,
  },
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
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
  hooks: {
    configFile(home) {
      return join(home, ".codex", "config.toml");
    },
    configFormat: "toml",
    entryPath: ["hooks", "SessionStart"],
    entryShape(command) {
      // Names exactly the sources this integration covers, since Codex's docs (unlike
      // Claude Code's) don't confirm that a wildcard or omitted matcher means "match
      // all future sources too". additionalContextLimit is Codex's own documented
      // bound on top of the char limit memory-hook-run enforces itself.
      return {
        matcher: "^(startup|resume|clear|compact)$",
        hooks: [{ type: "command", command, additionalContextLimit: MEMORY_HOOK_CONTEXT_TOKEN_LIMIT }],
      };
    },
    // Codex requires reviewing and trusting a non-managed hook once via its own
    // interactive "/hooks" command before it will ever run it — a real constraint
    // this installer must report, never bypass or hide (see the spec's Codex
    // section and the "needs-user-trust" contract).
    requiresUserTrust: true,
  },
  // `approve` (Codex's AppToolApproval enum) never asks for approval for the server's tools,
  // so they are not denied with `approval_policy = "never"` either.
  toolApproval: {
    kind: "server-mode",
    configFile(home) {
      return join(home, ".codex", "config.toml");
    },
    configFormat: "toml",
    keyPath(serverName) {
      return ["mcp_servers", serverName, "default_tools_approval_mode"];
    },
    approvedValue: "approve",
  },
  headlessCommand(executable, opts) {
    const args = ["exec"];
    // Read-only lock, right after `exec` and before every other option. Measured live (Codex 0.159.3, empty cwd,
    // `--add-dir` as Workers uses it):
    // - `codex exec --help` describes `--add-dir` as "directories that should be writable alongside the primary
    //   workspace", so it is not a read-only grant. Writing into the `--add-dir` folder still failed with
    //   "operation not permitted", with and without `--sandbox read-only`: what stopped it was the default
    //   sandbox of `exec`, which is read-only. That default is not something this adapter controls, so with
    //   `readOnly` the sandbox is requested explicitly.
    // - Even with `--sandbox read-only` the user's `config.toml` is still loaded, and with it the MCP servers: the
    //   helper called `memory_context` of forge614-engram successfully, so it could also call `memory_save`.
    //   `--ignore-user-config` does not load `$CODEX_HOME/config.toml` (auth still uses `CODEX_HOME`), and with
    //   it that tool does not exist.
    if (opts.readOnly) args.push("--sandbox", "read-only", "--ignore-user-config");
    // --add-dir goes before the prompt for the same reason as Claude Code: it must not swallow it. Without
    // `readOnly` the arguments are exactly the ones from before this option existed.
    if (opts.readableDir) args.push("--add-dir", opts.readableDir);
    if (opts.model) args.push("--model", opts.model);
    if (opts.reasoningLevel) args.push("-c", `model_reasoning_effort=${opts.reasoningLevel}`);
    // Confirmed from `codex exec --help`: with no positional PROMPT, instructions
    // are read from stdin instead.
    if (!opts.stdinPrompt) args.push(opts.prompt);
    return opts.stdinPrompt ? { command: executable, args, stdin: true } : { command: executable, args };
  },
};
