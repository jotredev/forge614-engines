import { posix, win32 } from "node:path";
import type { AgentId } from "./types";

/**
 * Resolves the absolute path to Forge614 Engines' own stable launcher — the same
 * bin/forge614-engines[.exe] self-update repoints on every version swap (mirrors
 * enginesRoot() in src/app/self-update.ts rather than importing it: modules/ may
 * not import app/ per the layering rule). A hook entry written once never needs
 * to change again across Engines upgrades.
 */
export function resolveEnginesExecutable(home: string, platform: NodeJS.Platform = process.platform): string {
  const path = platform === "win32" ? win32 : posix;
  const forgeHome = process.env.FORGE614_HOME ?? path.join(home, ".forge614");
  const exeSuffix = platform === "win32" ? ".exe" : "";
  return path.join(forgeHome, "engines", "bin", `forge614-engines${exeSuffix}`);
}

/** Tokens: the ceiling passed to Codex's own `additionalContextLimit` hook field. */
export const MEMORY_HOOK_CONTEXT_TOKEN_LIMIT = 4000;

/** Characters: the ceiling run-memory-hook.ts enforces itself, independent of any host-side limit — never rely solely on the host to bound an untrusted-size render. */
export const MEMORY_HOOK_CONTEXT_CHAR_LIMIT = 16000;

/**
 * The exact shell command a SessionStart hook must run: Engines' own launcher
 * (quoted, since a home directory can contain spaces) plus the subcommand that
 * reads the hook's stdin JSON and relays it into Engram's public startup-context
 * CLI, and `--agent <id>` so memory-hook-run knows which output contract to use
 * (plain text for Claude Code, structured additionalContext for Codex). This
 * exact string also doubles as the stable signature hook-write-decision.ts uses
 * to recognize "this hook-group entry belongs to Forge614" without ever touching
 * an entry another tool owns.
 */
export function resolveMemoryHookCommand(
  home: string,
  agentId: AgentId,
  platform: NodeJS.Platform = process.platform,
): string {
  return `"${resolveEnginesExecutable(home, platform)}" memory-hook-run --agent ${agentId}`;
}

/**
 * Where Engines records that its own memory-hook-run runtime was invoked with a
 * SessionStart-shaped payload for this agent, and what Engram returned when it
 * called it — inside Engines' own storage, one file per agent, never inside
 * Engram's or the host agent's own directories. See hook-evidence.ts for the
 * exact, honest meaning of that record.
 */
export function resolveHookEvidencePath(
  home: string,
  agentId: AgentId,
  platform: NodeJS.Platform = process.platform,
): string {
  const path = platform === "win32" ? win32 : posix;
  const forgeHome = process.env.FORGE614_HOME ?? path.join(home, ".forge614");
  return path.join(forgeHome, "engines", "hook-evidence", `${agentId}.json`);
}
