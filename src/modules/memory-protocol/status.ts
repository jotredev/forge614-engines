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

// For removal, "unsupported" means "there was never anything to remove here", which is a success
// state — unlike install, where it means "this component did not get installed".
function isRemovalOk(status: MemoryIntegrationComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write" || status.kind === "unsupported";
}

export function computeRemovalStatus(
  mcp: MemoryIntegrationComponentStatus,
  instructions: MemoryIntegrationComponentStatus,
): MemoryIntegrationOverallStatus {
  const mcpOk = isRemovalOk(mcp);
  const instructionsOk = isRemovalOk(instructions);
  if (mcpOk && instructionsOk) return "complete";
  if (!mcpOk && !instructionsOk) return "unsupported";
  return "partial";
}
