import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { loadPlan } from "../infrastructure/plan-store";
import { snapshotDirectory, type SnapshotManifest } from "../infrastructure/snapshot/snapshot";
import { NotRepairableError } from "./apply-mcp-repair";

export interface VerifyMcpRepairInput {
  agentId: AgentId;
  home: string;
  planId: string;
}

export interface McpRepairVerification {
  agentId: AgentId;
  planId: string;
  configPath: string;
  present: boolean;
  commandCanonical: boolean;
  argsCanonical: boolean;
  foreignPreserved: boolean;
  status: "ok" | "missing" | "mismatch";
}

export async function verifyMcpRepair(registry: AgentRegistry, input: VerifyMcpRepairInput): Promise<McpRepairVerification> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const plan = await loadPlan(input.home, input.planId);
  if (plan.action !== "mcp-repair" || !plan.repair) throw new NotRepairableError(input.planId);

  const engramServer = resolveEngramMcpServer(input.home);
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);

  const parsable = !exists || format.isParsable(raw);
  const existing = parsable ? format.getMcpEntry(raw, adapter.mcpEntryPath, engramServer.name) : undefined;
  const entry = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : undefined;

  const present = entry !== undefined;
  const commandCanonical = present && entry!.command === engramServer.command;
  const argsCanonical =
    present &&
    Array.isArray(entry!.args) &&
    (entry!.args as unknown[]).length === engramServer.args.length &&
    (entry!.args as unknown[]).every((value, index) => value === engramServer.args[index]);

  let foreignPreserved = true;
  if (plan.writes.length > 0) {
    const dir = snapshotDirectory(input.home, input.planId);
    let beforeRaw: string | undefined;
    try {
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
      const entryManifest = manifest.files.find((file) => file.originalPath === configPath);
      if (entryManifest) beforeRaw = await readFile(join(dir, entryManifest.backupFileName), "utf8");
    } catch {
      beforeRaw = undefined;
    }
    if (beforeRaw === undefined) {
      // The repair was never confirmed/applied (no snapshot was ever taken), so
      // there is nothing to prove was preserved — fail closed on the claim.
      foreignPreserved = false;
    } else if (!parsable) {
      // The current file is corrupt/unparsable (e.g. mutated after the repair) — there
      // is nothing to mechanically compare, so fail closed rather than throw a raw
      // parser error (TomlError for Codex, or similar) out of a "clean result" API.
      foreignPreserved = false;
    } else {
      const beforeStripped = format.withMcpEntry(beforeRaw, adapter.mcpEntryPath, engramServer.name, undefined);
      const afterStripped = format.withMcpEntry(raw, adapter.mcpEntryPath, engramServer.name, undefined);
      foreignPreserved = beforeStripped === afterStripped;
    }
  }

  const status: McpRepairVerification["status"] = !present ? "missing" : commandCanonical && argsCanonical ? "ok" : "mismatch";

  return {
    agentId: input.agentId,
    planId: input.planId,
    configPath,
    present,
    commandCanonical: Boolean(commandCanonical),
    argsCanonical: Boolean(argsCanonical),
    foreignPreserved,
    status,
  };
}
