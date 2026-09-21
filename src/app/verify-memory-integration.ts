import { readFile } from "node:fs/promises";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import { resolveMemoryHookCommand } from "../modules/agents/hook-command";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { extractBlock } from "../modules/instructions-writer/block";
import { MEMORY_PROTOCOL_BLOCK_ID } from "../modules/memory-protocol/constants";
import type { HookRuntimeStatus } from "../modules/config-writer/types";
import type { StartupContextFetchOptions } from "../infrastructure/engram/startup-context-client";
import { readHookEvidence } from "./hook-evidence";
import { computeHookRuntimeStatus } from "./hook-runtime-status";
import { decideHookRemove } from "./hook-write-decision";
import { decideMcpRemove } from "./mcp-write-decision";
import { runMemoryHook } from "./run-memory-hook";

export type { HookRuntimeStatus };

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
  hook: {
    supported: boolean;
    path: string;
    present: boolean;
    /** Diagnostic only: proves the hook's own code path works. Never drives overallStatus — see runtimeStatus. */
    dryRunOk: boolean;
    runtimeStatus: HookRuntimeStatus;
  };
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

  // Diagnostic only: proves the hook's own code genuinely calls Engram and
  // produces well-formed output. It is NOT evidence a real agent session ever
  // ran it — Engines cannot observe that from here — so it never decides
  // completeness. See computeHookRuntimeStatus, which uses real evidence instead.
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

  const evidence = hookPresent ? await readHookEvidence(input.home, input.agentId) : ({ kind: "absent" } as const);
  const runtimeStatus = computeHookRuntimeStatus(adapter, hookPresent, evidence);
  const hookOk = runtimeStatus.kind === "runtime-observed";

  const instructionsOk = !instructionsSupported || instructionsPresent;
  const overallStatus: MemoryIntegrationVerification["overallStatus"] = mcpPresent && instructionsOk && (!hookSupported || hookOk)
    ? "complete"
    : !mcpPresent && (!instructionsSupported || !instructionsPresent) && (!hookSupported || runtimeStatus.kind === "absent")
      ? "absent"
      : "partial";

  return {
    agentId: input.agentId,
    mcp: { path: mcpDecision.configPath, present: mcpPresent },
    instructions: { supported: instructionsSupported, paths: instructionsPaths, present: instructionsPresent },
    hook: { supported: hookSupported, path: hookRemoveDecision.configPath, present: hookPresent, dryRunOk, runtimeStatus },
    overallStatus,
  };
}
