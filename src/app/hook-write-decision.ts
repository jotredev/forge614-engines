import { createHash } from "node:crypto";
import type { AgentAdapter } from "../modules/agents/types";
import type { PlanWrite } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";

export type HookDiffDecision = { kind: "noop" } | { kind: "write" } | { kind: "blocked" };

export interface HookInstallDecision {
  configPath: string;
  decision: HookDiffDecision;
  write?: PlanWrite;
  blockedReason?: string;
}

export type HookRemoveDecision = HookInstallDecision;

export interface HookSeed {
  /**
   * Content to compute hook entries and the final afterContent against, instead
   * of reading the config file from disk. Used when a sibling decision (e.g. MCP
   * install/remove) targets the very same file — Codex keeps both mcp_servers
   * and hooks.SessionStart in config.toml — so this decision's output already
   * includes that sibling change instead of the two independently clobbering
   * each other when applied in sequence.
   */
  raw: string;
}

function findOwnIndex(entries: unknown[], command: string): number {
  return entries.findIndex((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const nested = (entry as Record<string, unknown>).hooks;
    if (!Array.isArray(nested)) return false;
    return nested.some(
      (h) =>
        h &&
        typeof h === "object" &&
        (h as Record<string, unknown>).type === "command" &&
        (h as Record<string, unknown>).command === command,
    );
  });
}

async function readExistingEntries(
  adapter: AgentAdapter,
  home: string,
  command: string,
  seed?: HookSeed,
): Promise<
  | { blocked: true; configPath: string }
  | {
      blocked: false;
      configPath: string;
      sourceRaw: string;
      hashRaw: string;
      hashExists: boolean;
      entries: unknown[];
      ownIndex: number;
    }
> {
  const hooks = adapter.hooks!;
  const format = configFormats[hooks.configFormat];
  const configPath = hooks.configFile(home);
  const { raw: diskRaw, exists: diskExists } = await format.readOrDefault(configPath);
  const sourceRaw = seed?.raw ?? diskRaw;
  const existingValue = format.getValueAtPath(sourceRaw, hooks.entryPath);

  if (existingValue !== undefined && !Array.isArray(existingValue)) {
    return { blocked: true, configPath };
  }

  const entries: unknown[] = Array.isArray(existingValue) ? existingValue : [];
  return {
    blocked: false,
    configPath,
    sourceRaw,
    hashRaw: diskRaw,
    hashExists: diskExists,
    entries,
    ownIndex: findOwnIndex(entries, command),
  };
}

export async function decideHookInstall(
  adapter: AgentAdapter,
  home: string,
  command: string,
  seed?: HookSeed,
): Promise<HookInstallDecision> {
  if (!adapter.hooks) return { configPath: "", decision: { kind: "blocked" }, blockedReason: "unsupported" };
  const state = await readExistingEntries(adapter, home, command, seed);
  if (state.blocked) return { configPath: state.configPath, decision: { kind: "blocked" }, blockedReason: "hooks-not-array" };

  const { configPath, sourceRaw, hashRaw, hashExists, entries, ownIndex } = state;
  const hooks = adapter.hooks;
  const format = configFormats[hooks.configFormat];
  const desired = hooks.entryShape(command);

  if (ownIndex !== -1 && JSON.stringify(entries[ownIndex]) === JSON.stringify(desired)) {
    return { configPath, decision: { kind: "noop" } };
  }

  const nextEntries = [...entries];
  if (ownIndex === -1) nextEntries.push(desired);
  else nextEntries[ownIndex] = desired;

  return {
    configPath,
    decision: { kind: "write" },
    write: {
      path: configPath,
      beforeHash: createHash("sha256").update(hashExists ? hashRaw : "").digest("hex"),
      afterContent: format.withValueAtPath(sourceRaw, hooks.entryPath, nextEntries),
    },
  };
}

export async function decideHookRemove(
  adapter: AgentAdapter,
  home: string,
  command: string,
  seed?: HookSeed,
): Promise<HookRemoveDecision> {
  if (!adapter.hooks) return { configPath: "", decision: { kind: "blocked" }, blockedReason: "unsupported" };
  const state = await readExistingEntries(adapter, home, command, seed);
  if (state.blocked) return { configPath: state.configPath, decision: { kind: "blocked" }, blockedReason: "hooks-not-array" };

  const { configPath, sourceRaw, hashRaw, hashExists, entries, ownIndex } = state;
  if (ownIndex === -1) return { configPath, decision: { kind: "noop" } };

  const hooks = adapter.hooks!;
  const format = configFormats[hooks.configFormat];
  const nextEntries = entries.filter((_, i) => i !== ownIndex);

  return {
    configPath,
    decision: { kind: "write" },
    write: {
      path: configPath,
      beforeHash: createHash("sha256").update(hashExists ? hashRaw : "").digest("hex"),
      afterContent: format.withValueAtPath(sourceRaw, hooks.entryPath, nextEntries.length === 0 ? undefined : nextEntries),
    },
  };
}
