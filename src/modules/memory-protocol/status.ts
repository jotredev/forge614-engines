import type { HookComponentStatus, MemoryIntegrationComponentStatus, MemoryIntegrationOverallStatus } from "../config-writer/types";

function isOk(status: MemoryIntegrationComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write";
}

function isHookOk(status: HookComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write";
}

export function computeOverallStatus(
  mcp: MemoryIntegrationComponentStatus,
  instructions: MemoryIntegrationComponentStatus,
  hook: HookComponentStatus,
): MemoryIntegrationOverallStatus {
  const mcpOk = isOk(mcp);
  const instructionsOk = isOk(instructions);
  const hookOk = isHookOk(hook);
  if (mcpOk && instructionsOk && hookOk) return "complete";
  if (!mcpOk && !instructionsOk && !hookOk) return "unsupported";
  return "partial";
}

// For removal, "unsupported" means "there was never anything to remove here", which is a success
// state — unlike install, where it means "this component did not get installed".
function isRemovalOk(status: MemoryIntegrationComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write" || status.kind === "unsupported";
}

function isHookRemovalOk(status: HookComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write" || status.kind === "unsupported";
}

export function computeRemovalStatus(
  mcp: MemoryIntegrationComponentStatus,
  instructions: MemoryIntegrationComponentStatus,
  hook: HookComponentStatus,
): MemoryIntegrationOverallStatus {
  const mcpOk = isRemovalOk(mcp);
  const instructionsOk = isRemovalOk(instructions);
  const hookOk = isHookRemovalOk(hook);
  if (mcpOk && instructionsOk && hookOk) return "complete";
  if (!mcpOk && !instructionsOk && !hookOk) return "unsupported";
  return "partial";
}
