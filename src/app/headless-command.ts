import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, HeadlessCommand, ReasoningLevel } from "../modules/agents/types";

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
): HeadlessCommand {
  const adapter = registry.get(agentId);
  if (!adapter) throw new Error(`Unknown agent: ${agentId}`);
  if (!adapter.capabilities.supportsHeadlessExec || !adapter.headlessCommand) {
    throw new HeadlessUnsupportedError(agentId);
  }
  return adapter.headlessCommand(executable, { prompt, timeoutMs, model, reasoningLevel });
}
