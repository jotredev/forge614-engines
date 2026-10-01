import { createHash } from "node:crypto";
import type { AgentAdapter, PermissionRulesApproval, ServerModeApproval } from "../modules/agents/types";
import type { MemoryIntegrationComponentStatus, PlanWrite } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { appendToArray, removeArrayItems } from "../infrastructure/config-io/json-format";

/*
 * "Always" approval of the Engram tools.
 *
 * Why it exists: Engram memory has to work in any permission mode of the agent. Claude Code in
 * `dontAsk` denies every tool that is not in `permissions.allow`, and Codex with
 * `approval_policy = "never"` denies the MCP tool that asks for approval; without this approval
 * `memory_session_start` comes out as "Failed" in those modes.
 *
 * Claude Code evaluates deny, then ask, then allow, and the first one that matches wins. So
 * adding the `allow` rule is not enough if a `deny` or `ask` rule in the same file already covers
 * Engram: those rules are removed (only those) and the person gets a notice. Project-level or
 * managed rules are not visible from here and may still win.
 */

export type ToolApprovalDiffDecision = { kind: "noop" } | { kind: "write" } | { kind: "blocked" };

export interface ToolApprovalDecision {
  /** File where the approval lives; `""` when the agent does not support it. */
  configPath: string;
  decision: ToolApprovalDiffDecision;
  write?: PlanWrite;
  /** Present only with `decision.kind === "blocked"`. */
  blockedReason?: "unsupported" | "allow-not-array" | "mcp-entry-missing";
  /** Present only when the plan changes something the person had (a removed deny/ask rule or a changed Codex value). */
  notice?: string;
}

export interface ToolApprovalSeed {
  /**
   * Content to compute the result from, instead of reading the file from disk. Used when a
   * sibling decision (MCP or hook) writes the same file —Claude Code keeps the hook and the
   * permissions in settings.json; Codex keeps the MCP, the hook and the approval in config.toml—,
   * so the single write already includes the sibling changes and they do not overwrite each other.
   */
  raw: string;
}

export interface ToolApprovalState {
  supported: boolean;
  path: string;
  /** True only with the server's full approval: the server rule or the wildcard (Claude Code), the approved value (Codex). */
  present: boolean;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Claude Code rules that approve the WHOLE server: `mcp__<server>` and `mcp__<server>__*`. */
function coversWholeServer(target: PermissionRulesApproval, serverName: string, rule: unknown): boolean {
  return rule === target.serverRule(serverName) || rule === `${target.toolRulePrefix(serverName)}*`;
}

/** Rules that reach Engram: the whole server, the wildcard or a single tool (`mcp__<server>__<tool>`). */
function coversAnyEngramTool(target: PermissionRulesApproval, serverName: string, rule: unknown): boolean {
  return rule === target.serverRule(serverName) || (typeof rule === "string" && rule.startsWith(target.toolRulePrefix(serverName)));
}

function matchingIndexes(rules: unknown, matches: (rule: unknown) => boolean): number[] {
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule, index) => (matches(rule) ? [index] : []));
}

function removalNotice(adapter: AgentAdapter, configPath: string, removed: { list: string; rule: string }[]): string {
  const items = removed.map(({ list, rule }) => `${list} rule "${rule}"`).join(", ");
  return (
    `Removed ${items} from ${configPath}: Claude Code evaluates deny and ask rules before allow rules, so they would keep the Engram tools blocked. ` +
    `The approval is part of the Engram memory install; to turn it off, run "plan memory-remove --agent ${adapter.id}" and apply the plan.`
  );
}

function codexChangeNotice(adapter: AgentAdapter, serverName: string, configPath: string, previous: unknown, approved: string): string {
  return (
    `Changed default_tools_approval_mode of [mcp_servers.${serverName}] in ${configPath} from ${JSON.stringify(previous)} to ${JSON.stringify(approved)} ` +
    'so Codex never asks to approve the Engram tools (with approval_policy = "never" a tool that asks is denied). ' +
    `The approval is part of the Engram memory install; to turn it off, run "plan memory-remove --agent ${adapter.id}" and apply the plan.`
  );
}

async function readSource(target: { configFile(home: string): string; configFormat: "json" | "toml" }, home: string, seed?: ToolApprovalSeed) {
  const format = configFormats[target.configFormat];
  const configPath = target.configFile(home);
  const { raw: diskRaw, exists } = await format.readOrDefault(configPath);
  return { format, configPath, sourceRaw: seed?.raw ?? diskRaw, beforeHash: sha256(exists ? diskRaw : "") };
}

/**
 * Decides what to write to always approve the tools of the `serverName` server:
 * - Claude Code: appends `mcp__<server>` to the end of `permissions.allow` (creating it if
 *   missing), without rewriting the array, and removes from `deny`/`ask` the rules that cover
 *   Engram, with a `notice`.
 * - Codex: sets `default_tools_approval_mode = "approve"` in the server's table; if there was
 *   another value it changes it and says so with a `notice`.
 * `noop` when it is already approved and there is nothing to remove; `blocked` when it cannot be
 * written safely (`allow` is not an array, the Codex MCP entry is missing or the agent does not support it).
 */
export async function decideToolApprovalInstall(
  adapter: AgentAdapter,
  home: string,
  serverName: string,
  seed?: ToolApprovalSeed,
): Promise<ToolApprovalDecision> {
  const target = adapter.toolApproval;
  if (!target) return { configPath: "", decision: { kind: "blocked" }, blockedReason: "unsupported" };
  return target.kind === "permission-rules"
    ? installPermissionRule(adapter, target, home, serverName, seed)
    : installServerMode(adapter, target, home, serverName, seed);
}

async function installPermissionRule(
  adapter: AgentAdapter,
  target: PermissionRulesApproval,
  home: string,
  serverName: string,
  seed?: ToolApprovalSeed,
): Promise<ToolApprovalDecision> {
  const { format, configPath, sourceRaw, beforeHash } = await readSource(target, home, seed);
  const allow = format.getValueAtPath(sourceRaw, target.allowPath);
  if (allow !== undefined && !Array.isArray(allow)) {
    return { configPath, decision: { kind: "blocked" }, blockedReason: "allow-not-array" };
  }

  const alreadyAllowed = Array.isArray(allow) && allow.some((rule) => coversWholeServer(target, serverName, rule));
  const deny = format.getValueAtPath(sourceRaw, target.denyPath);
  const ask = format.getValueAtPath(sourceRaw, target.askPath);
  const denyIndexes = matchingIndexes(deny, (rule) => coversAnyEngramTool(target, serverName, rule));
  const askIndexes = matchingIndexes(ask, (rule) => coversAnyEngramTool(target, serverName, rule));
  if (alreadyAllowed && denyIndexes.length === 0 && askIndexes.length === 0) return { configPath, decision: { kind: "noop" } };

  let next = sourceRaw;
  if (denyIndexes.length > 0) next = removeArrayItems(next, target.denyPath, denyIndexes);
  if (askIndexes.length > 0) next = removeArrayItems(next, target.askPath, askIndexes);
  if (!alreadyAllowed) {
    const rule = target.serverRule(serverName);
    next = Array.isArray(allow) ? appendToArray(next, target.allowPath, rule) : format.withValueAtPath(next, target.allowPath, [rule]);
  }

  const removed = [
    ...denyIndexes.map((index) => ({ list: "permissions.deny", rule: String((deny as unknown[])[index]) })),
    ...askIndexes.map((index) => ({ list: "permissions.ask", rule: String((ask as unknown[])[index]) })),
  ];
  return {
    configPath,
    decision: { kind: "write" },
    write: { path: configPath, beforeHash, afterContent: next },
    ...(removed.length > 0 ? { notice: removalNotice(adapter, configPath, removed) } : {}),
  };
}

async function installServerMode(
  adapter: AgentAdapter,
  target: ServerModeApproval,
  home: string,
  serverName: string,
  seed?: ToolApprovalSeed,
): Promise<ToolApprovalDecision> {
  const { format, configPath, sourceRaw, beforeHash } = await readSource(target, home, seed);
  const keyPath = target.keyPath(serverName);
  // The key belongs INSIDE the server's table; writing it without the entry would create a
  // table that has a mode but no command.
  const entry = format.getValueAtPath(sourceRaw, keyPath.slice(0, -1));
  if (!entry || typeof entry !== "object") {
    return { configPath, decision: { kind: "blocked" }, blockedReason: "mcp-entry-missing" };
  }

  const current = format.getValueAtPath(sourceRaw, keyPath);
  if (current === target.approvedValue) return { configPath, decision: { kind: "noop" } };
  return {
    configPath,
    decision: { kind: "write" },
    write: { path: configPath, beforeHash, afterContent: format.withValueAtPath(sourceRaw, keyPath, target.approvedValue) },
    ...(current !== undefined ? { notice: codexChangeNotice(adapter, serverName, configPath, current, target.approvedValue) } : {}),
  };
}

/**
 * Decides what to write to remove the approval when uninstalling the memory: in Claude Code, every
 * `permissions.allow` rule that is `mcp__<server>`, `mcp__<server>__*` or `mcp__<server>__<tool>`
 * (only those; if `allow` ends up empty it is left empty); in Codex, the approval key when it holds
 * the approved value. The deny/ask rules that the install removed are not restored.
 */
export async function decideToolApprovalRemove(
  adapter: AgentAdapter,
  home: string,
  serverName: string,
  seed?: ToolApprovalSeed,
): Promise<ToolApprovalDecision> {
  const target = adapter.toolApproval;
  if (!target) return { configPath: "", decision: { kind: "blocked" }, blockedReason: "unsupported" };
  const { format, configPath, sourceRaw, beforeHash } = await readSource(target, home, seed);

  if (target.kind === "server-mode") {
    const keyPath = target.keyPath(serverName);
    if (format.getValueAtPath(sourceRaw, keyPath) !== target.approvedValue) return { configPath, decision: { kind: "noop" } };
    return {
      configPath,
      decision: { kind: "write" },
      write: { path: configPath, beforeHash, afterContent: format.withValueAtPath(sourceRaw, keyPath, undefined) },
    };
  }

  const allow = format.getValueAtPath(sourceRaw, target.allowPath);
  if (allow !== undefined && !Array.isArray(allow)) return { configPath, decision: { kind: "blocked" }, blockedReason: "allow-not-array" };
  const indexes = matchingIndexes(allow, (rule) => coversAnyEngramTool(target, serverName, rule));
  if (indexes.length === 0) return { configPath, decision: { kind: "noop" } };
  return {
    configPath,
    decision: { kind: "write" },
    write: { path: configPath, beforeHash, afterContent: removeArrayItems(sourceRaw, target.allowPath, indexes) },
  };
}

/** Reads from disk whether the server's full approval is set (for `verify`). A single-tool rule does not count. */
export async function readToolApprovalState(adapter: AgentAdapter, home: string, serverName: string): Promise<ToolApprovalState> {
  const target = adapter.toolApproval;
  if (!target) return { supported: false, path: "", present: false };
  const { format, configPath, sourceRaw } = await readSource(target, home);
  if (target.kind === "server-mode") {
    return { supported: true, path: configPath, present: format.getValueAtPath(sourceRaw, target.keyPath(serverName)) === target.approvedValue };
  }
  const allow = format.getValueAtPath(sourceRaw, target.allowPath);
  return {
    supported: true,
    path: configPath,
    present: Array.isArray(allow) && allow.some((rule) => coversWholeServer(target, serverName, rule)),
  };
}

/**
 * Turns an approval decision into the status carried in `metadata.approval.status`.
 * `mode` only changes the wording of the reasons (add vs. remove).
 */
export function toolApprovalComponentStatus(
  adapter: AgentAdapter,
  decision: ToolApprovalDecision,
  serverName: string,
  mode: "install" | "remove",
): MemoryIntegrationComponentStatus {
  if (!adapter.toolApproval) {
    return {
      kind: "unsupported",
      reason: `${adapter.label} has no tool-approval setting ${mode === "install" ? "this installer configures" : "to remove"}`,
    };
  }
  if (decision.decision.kind === "blocked") {
    const reason = decision.blockedReason ?? "unsupported";
    const details =
      reason === "allow-not-array"
        ? `permissions.allow at ${decision.configPath} is not an array, so the Engram approval rule cannot be ${mode === "install" ? "added" : "removed"} safely`
        : `The "${serverName}" MCP entry is not in ${decision.configPath}, so its tool-approval setting has nowhere to go`;
    return { kind: "blocked", reason, details };
  }
  if (decision.decision.kind === "noop") return { kind: "noop" };
  return { kind: "write", ...(decision.notice ? { notice: decision.notice } : {}) };
}
