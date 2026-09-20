import { readFile } from "node:fs/promises";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import { ENGRAM_MCP_SERVER } from "../modules/memory-protocol/constants";
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
  overallStatus: "complete" | "partial" | "unsupported";
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function verifyMemoryIntegration(
  registry: AgentRegistry,
  input: VerifyMemoryIntegrationInput,
): Promise<MemoryIntegrationVerification> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);

  const mcpDecision = await decideMcpRemove(adapter, input.home, ENGRAM_MCP_SERVER);
  const mcpPresent = mcpDecision.decision.kind === "write";

  const instructionsSupported = Boolean(adapter.instructions);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];
  let instructionsPresent = false;
  if (adapter.instructions) {
    const primary = await readOrEmpty(adapter.instructions.primaryFile(input.home));
    instructionsPresent = extractBlock(primary, MEMORY_PROTOCOL_BLOCK_ID) !== undefined;
  }

  const overallStatus: MemoryIntegrationVerification["overallStatus"] = !instructionsSupported
    ? "partial"
    : mcpPresent && instructionsPresent
      ? "complete"
      : "partial";

  return {
    agentId: input.agentId,
    mcp: { path: mcpDecision.configPath, present: mcpPresent },
    instructions: { supported: instructionsSupported, paths: instructionsPaths, present: instructionsPresent },
    overallStatus,
  };
}
