import type { AgentRegistry } from "../modules/agents/registry";
import { ReasoningLevelUnsupportedError, type AgentId, type HeadlessCommand, type ReasoningLevel } from "../modules/agents/types";

export class HeadlessUnsupportedError extends Error {
  constructor(agentId: AgentId) {
    super(`${agentId} does not support headless execution`);
  }
}

export function headlessCommandFor(
  registry: AgentRegistry,
  agentId: AgentId,
  executable: string,
  prompt: string,
  timeoutMs?: number,
  model?: string,
  reasoningLevel?: ReasoningLevel,
  stdinPrompt?: boolean,
  readableDir?: string,
): HeadlessCommand {
  const adapter = registry.get(agentId);
  if (!adapter) throw new Error(`Unknown agent: ${agentId}`);
  if (!adapter.capabilities.supportsHeadlessExec || !adapter.headlessCommand) {
    throw new HeadlessUnsupportedError(agentId);
  }
  if (reasoningLevel && !adapter.capabilities.supportsReasoningLevel) {
    throw new ReasoningLevelUnsupportedError(agentId);
  }
  return adapter.headlessCommand(executable, { prompt, timeoutMs, model, reasoningLevel, stdinPrompt, readableDir });
}
