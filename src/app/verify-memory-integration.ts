import { readFile } from "node:fs/promises";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { extractBlock } from "../modules/instructions-writer/block";
import { MEMORY_PROTOCOL_BLOCK_ID } from "../modules/memory-protocol/constants";
import { decideMcpRemove } from "./mcp-write-decision";

export interface VerifyMemoryIntegrationInput {
  agentId: AgentId;
  home: string;
}

export interface MemoryIntegrationVerification {
  agentId: AgentId;
  mcp: { path: string; present: boolean };
  instructions: { supported: boolean; paths: string[]; present: boolean };
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

  const instructionsOk = !instructionsSupported || instructionsPresent;
  const overallStatus: MemoryIntegrationVerification["overallStatus"] = mcpPresent && instructionsOk
    ? "complete"
    : !mcpPresent && (!instructionsSupported || !instructionsPresent)
      ? "absent"
      : "partial";

  return {
    agentId: input.agentId,
    mcp: { path: mcpDecision.configPath, present: mcpPresent },
    instructions: { supported: instructionsSupported, paths: instructionsPaths, present: instructionsPresent },
    overallStatus,
  };
}
