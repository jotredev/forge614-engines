import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  label: "Claude Code",
  capabilities: { supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true, supportsReasoningLevel: false },
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
    // D5: the manual embeds directly between the managed-block markers in CLAUDE.md, the same as
    // Codex — no contentFile. Engines still knows how to migrate a machine that has the old
    // "@forge614-engram-memory-protocol.md" reference plus that satellite file on disk (see
    // instructions-write-decision.ts's resolveLegacySatellite); it just never writes that shape again.
    primaryFile(home) {
      return join(home, ".claude", "CLAUDE.md");
    },
    shadowingFiles() {
      return [];
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
    // Claude Code's CLI has no public, stable flag to select a reasoning/thinking level
    // (unlike --model). capabilities.supportsReasoningLevel: false is what makes
    // headlessCommandFor() reject opts.reasoningLevel before this is ever called.
    // --add-dir must come before -p: it's variadic (accepts multiple paths in a
    // row), so placed after -p it would swallow the prompt text as another path.
    const args: string[] = [];
    if (opts.readableDir) args.push("--add-dir", opts.readableDir);
    // Confirmed against the real `claude` CLI: with no positional prompt, `-p`
    // reads it from stdin instead (verified live: `echo "..." | claude -p`).
    args.push(...(opts.stdinPrompt ? ["-p"] : ["-p", opts.prompt]));
    if (opts.model) args.push("--model", opts.model);
    return opts.stdinPrompt ? { command: executable, args, stdin: true } : { command: executable, args };
  },
};
