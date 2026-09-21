import { readFile } from "node:fs/promises";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import { resolveMemoryHookCommand } from "../modules/agents/hook-command";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { extractBlock } from "../modules/instructions-writer/block";
import { MEMORY_PROTOCOL_BLOCK_ID } from "../modules/memory-protocol/constants";
import type { StartupContextFetchOptions } from "../infrastructure/engram/startup-context-client";
import { decideHookRemove } from "./hook-write-decision";
import { decideMcpRemove } from "./mcp-write-decision";
import { runMemoryHook } from "./run-memory-hook";

export interface VerifyMemoryIntegrationInput {
  agentId: AgentId;
  home: string;
  /** Test seam for the hook's dry-run Engram subprocess invocation; production callers omit this. */
  startupContextOptions?: StartupContextFetchOptions;
}

export interface MemoryIntegrationVerification {
  agentId: AgentId;
  mcp: { path: string; present: boolean };
  instructions: { supported: boolean; paths: string[]; present: boolean };
  hook: { supported: boolean; path: string; present: boolean; dryRunOk: boolean; trustPending: boolean };
  overallStatus: "complete" | "partial" | "absent";
}

async function readOrEmpty(path: string): Promise<{ raw: string; exists: boolean }> {
  try {
    return { raw: await readFile(path, "utf8"), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "", exists: false };
    throw error;
  }
}

export async function verifyMemoryIntegration(
  registry: AgentRegistry,
  input: VerifyMemoryIntegrationInput,
): Promise<MemoryIntegrationVerification> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);

  const mcpDecision = await decideMcpRemove(adapter, input.home, resolveEngramMcpServer(input.home));
  const mcpPresent = mcpDecision.decision.kind === "write";

  const instructionsSupported = Boolean(adapter.instructions);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];
  let instructionsPresent = false;
  if (adapter.instructions) {
    const primary = await readOrEmpty(adapter.instructions.primaryFile(input.home));
    const blockPresent = extractBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID) !== undefined;
    if (adapter.instructions.contentFile) {
      // The primary file only imports the satellite file. If that satellite file is gone, the
      // instructions are not actually installed, however intact the import line looks.
      const content = await readOrEmpty(adapter.instructions.contentFile(input.home));
      instructionsPresent = blockPresent && content.exists;
    } else {
      instructionsPresent = blockPresent;
    }
  }

  const hookSupported = Boolean(adapter.hooks);
  const hookCommand = resolveMemoryHookCommand(input.home, input.agentId);
  const hookRemoveDecision = await decideHookRemove(adapter, input.home, hookCommand);
  const hookPresent = hookRemoveDecision.decision.kind === "write";

  // Structural presence alone is not evidence the hook works. Actually run the
  // exact code path the real hook would run, end to end through the real Engram
  // binary (or a supplied fixture), proving it would genuinely produce context —
  // this is the honest limit of what Engines can verify without a live agent
  // session (see the spec's "Verification semantics").
  let dryRunOk = false;
  if (hookPresent) {
    const dryRun = await runMemoryHook({
      home: input.home,
      agentId: input.agentId,
      stdin: JSON.stringify({ cwd: input.home }),
      startupContextOptions: input.startupContextOptions,
    });
    dryRunOk = dryRun.available;
  }
  const trustPending = hookPresent && dryRunOk && Boolean(adapter.hooks?.requiresUserTrust);
  const hookOk = hookPresent && dryRunOk && !trustPending;

  const instructionsOk = !instructionsSupported || instructionsPresent;
  const overallStatus: MemoryIntegrationVerification["overallStatus"] = mcpPresent && instructionsOk && (!hookSupported || hookOk)
    ? "complete"
    : !mcpPresent && (!instructionsSupported || !instructionsPresent) && (!hookSupported || !hookPresent)
      ? "absent"
      : "partial";

  return {
    agentId: input.agentId,
    mcp: { path: mcpDecision.configPath, present: mcpPresent },
    instructions: { supported: instructionsSupported, paths: instructionsPaths, present: instructionsPresent },
    hook: { supported: hookSupported, path: hookRemoveDecision.configPath, present: hookPresent, dryRunOk, trustPending },
    overallStatus,
  };
}
