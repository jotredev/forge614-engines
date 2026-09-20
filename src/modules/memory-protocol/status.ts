import type { MemoryIntegrationComponentStatus, MemoryIntegrationOverallStatus } from "../config-writer/types";

function isOk(status: MemoryIntegrationComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write";
}

export function computeOverallStatus(
  mcp: MemoryIntegrationComponentStatus,
  instructions: MemoryIntegrationComponentStatus,
): MemoryIntegrationOverallStatus {
  const mcpOk = isOk(mcp);
  const instructionsOk = isOk(instructions);
  if (mcpOk && instructionsOk) return "complete";
  if (!mcpOk && !instructionsOk) return "unsupported";
  return "partial";
}
