import type { AgentRegistry } from "../modules/agents/registry";
import {
  InvalidReasoningLevelError,
  ReasoningLevelUnsupportedError,
  type AgentId,
  type HeadlessCommand,
  type ReasoningLevel,
} from "../modules/agents/types";

/** The agent has no headless execution at all. */
export class HeadlessUnsupportedError extends Error {
  constructor(agentId: AgentId) {
    super(`${agentId} does not support headless execution`);
  }
}

/**
 * Builds the command that runs an agent headless. It is the single place that validates `reasoningLevel`,
 * so the CLI and any other caller get the same error. Checks run in this order: unknown agent, agent without
 * headless execution (`HeadlessUnsupportedError`), a level given to an agent that cannot choose one
 * (`ReasoningLevelUnsupportedError`), and finally a level the agent does not list
 * (`InvalidReasoningLevelError`). `reasoningLevel` may be unvalidated text typed as `ReasoningLevel`.
 */
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
  const validLevels = adapter.reasoningLevels ?? [];
  if (reasoningLevel && !validLevels.includes(reasoningLevel)) {
    throw new InvalidReasoningLevelError(reasoningLevel, agentId, validLevels);
  }
  return adapter.headlessCommand(executable, { prompt, timeoutMs, model, reasoningLevel, stdinPrompt, readableDir });
}
