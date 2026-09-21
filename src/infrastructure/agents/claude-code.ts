import { join } from "node:path";
import { ReasoningLevelUnsupportedError, type AgentAdapter, type McpServerDefinition } from "../../modules/agents/types";

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
  instructions: {
    primaryFile(home) {
      return join(home, ".claude", "CLAUDE.md");
    },
    shadowingFiles() {
      return [];
    },
    contentFile(home) {
      return join(home, ".claude", "forge614-engram-memory-protocol.md");
    },
  },
  hooks: {
    configFile(home) {
      return join(home, ".claude", "settings.json");
    },
    configFormat: "json",
    entryPath: ["hooks", "SessionStart"],
    entryShape(command) {
      // No matcher: confirmed in Claude Code's official hooks doc that an omitted
      // matcher on SessionStart fires for every source — startup, resume, clear,
      // and post-compaction recovery all included.
      return { hooks: [{ type: "command", command }] };
    },
    requiresUserTrust: false,
  },
  headlessCommand(executable, opts) {
    if (opts.reasoningLevel) {
      // Claude Code's CLI has no public, stable flag to select a reasoning/thinking
      // level (unlike --model). Rejecting explicitly avoids silently building a command
      // that ignores the caller's requested reasoning level.
      throw new ReasoningLevelUnsupportedError("claude-code");
    }
    // Confirmed against the real `claude` CLI: with no positional prompt, `-p`
    // reads it from stdin instead (verified live: `echo "..." | claude -p`).
    const args = opts.stdinPrompt ? ["-p"] : ["-p", opts.prompt];
    if (opts.model) args.push("--model", opts.model);
    return opts.stdinPrompt ? { command: executable, args, stdin: true } : { command: executable, args };
  },
};
