import { posix, win32 } from "node:path";
import type { McpServerDefinition } from "../agents/types";

export const MEMORY_PROTOCOL_BLOCK_ID = "engram-memory-protocol";

/**
 * Resolves the absolute path to the forge614-engram binary Forge614 Shell
 * installs, under FORGE614_HOME/engram/bin — never the bare "forge614-engram"
 * command name. Every use of Engram from Engines (the MCP server entry, and
 * invoking its CLI directly) must go through this so Engines never depends
 * on PATH and never reads anything under FORGE614_HOME beyond this path
 * string, keeping it isolated from Engram's own internals.
 */
export function resolveEngramExecutable(home: string, platform: NodeJS.Platform = process.platform): string {
  const path = platform === "win32" ? win32 : posix;
  const forgeHome = process.env.FORGE614_HOME ?? path.join(home, ".forge614");
  const exeSuffix = platform === "win32" ? ".exe" : "";
  return path.join(forgeHome, "engram", "bin", `forge614-engram${exeSuffix}`);
}

/**
 * Builds the canonical forge614-engram MCP server entry. Must match exactly
 * what Forge614 Shell writes when it installs Engram, or every plan/verify
 * command treats a real, correctly-installed entry as a conflict.
 */
export function resolveEngramMcpServer(home: string, platform: NodeJS.Platform = process.platform): McpServerDefinition {
  return {
    name: "forge614-engram",
    command: resolveEngramExecutable(home, platform),
    args: ["mcp"],
  };
}
