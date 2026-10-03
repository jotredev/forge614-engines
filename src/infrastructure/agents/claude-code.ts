import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  label: "Claude Code",
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
  // Same file as the hook. The rule by server name (`mcp__<server>`) is the documented way to
  // approve all of its tools; `dontAsk` honors the `allow` rules.
  toolApproval: {
    kind: "permission-rules",
    configFile(home) {
      return join(home, ".claude", "settings.json");
    },
    configFormat: "json",
    allowPath: ["permissions", "allow"],
    denyPath: ["permissions", "deny"],
    askPath: ["permissions", "ask"],
    serverRule(serverName) {
      return `mcp__${serverName}`;
    },
    toolRulePrefix(serverName) {
      return `mcp__${serverName}__`;
    },
  },
  headlessCommand(executable, opts) {
    // The level goes to Claude Code's `--effort <level>`. Haiku 4.5 has no levels and Claude Code ignores the
    // flag for it without an error. An unknown value is not rejected by Claude Code either (it warns and keeps
    // the default effort), which is why headlessCommandFor() validates opts.reasoningLevel against
    // reasoningLevels before this is ever called.
    // --add-dir must come before -p: it's variadic (accepts multiple paths in a
    // row), so placed after -p it would swallow the prompt text as another path.
    const args: string[] = [];
    if (opts.readableDir) args.push("--add-dir", opts.readableDir);
    // Read-only lock. Measured live (Claude Code 2.1.288, empty cwd, `--add-dir` as Workers uses it):
    // - Without these options (how Engines built the command until now) the helper has every MCP server of the
    //   user, forge614-engram included with `memory_save` already approved, so it could save to Engram.
    // - With them, in `-p` mode both with the prompt in the arguments and read from stdin, the helper reads the
    //   file, cannot write (Write is disabled) and its only tools are Glob, Grep and Read, with no MCP at all.
    // What each option does: `--tools Read,Grep,Glob` leaves only those three tools available, so nothing can
    // write; `--permission-mode dontAsk` denies anything not allowed instead of asking, which a headless run
    // could never answer; `--strict-mcp-config` loads only the MCP servers given with `--mcp-config` (none), so
    // the user's servers are never loaded. `--tools` is a list option (it takes several values in a row), so like
    // `--add-dir` the lock goes before `-p`: placed after `-p "<prompt>"` it could swallow text that follows. The
    // other two options travel with it so the lock stays in one block.
    if (opts.readOnly) {
      args.push("--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk", "--strict-mcp-config");
    }
    // Confirmed against the real `claude` CLI: with no positional prompt, `-p`
    // reads it from stdin instead (verified live: `echo "..." | claude -p`).
    args.push(...(opts.stdinPrompt ? ["-p"] : ["-p", opts.prompt]));
    if (opts.model) args.push("--model", opts.model);
    if (opts.reasoningLevel) args.push("--effort", opts.reasoningLevel);
    return opts.stdinPrompt ? { command: executable, args, stdin: true } : { command: executable, args };
  },
};
