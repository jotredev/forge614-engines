import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";
import { MEMORY_HOOK_CONTEXT_TOKEN_LIMIT } from "../../modules/agents/hook-command";

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
  headlessCommand(executable, opts) {
    const args = ["exec"];
    // Codex's --add-dir can technically grant write access, but as long as neither
    // --sandbox workspace-write nor --sandbox danger-full-access is passed (never
    // done here), `codex exec`'s default sandbox stays read-only. Placed before
    // the prompt for the same reason as Claude Code: it must not swallow it.
    if (opts.readableDir) args.push("--add-dir", opts.readableDir);
    if (opts.model) args.push("--model", opts.model);
    if (opts.reasoningLevel) args.push("-c", `model_reasoning_effort=${opts.reasoningLevel}`);
    // Confirmed from `codex exec --help`: with no positional PROMPT, instructions
    // are read from stdin instead.
    if (!opts.stdinPrompt) args.push(opts.prompt);
    return opts.stdinPrompt ? { command: executable, args, stdin: true } : { command: executable, args };
  },
};
