import type { HookComponentStatus, HookRuntimeStatus, MemoryIntegrationComponentStatus, MemoryIntegrationOverallStatus } from "../config-writer/types";

function isOk(status: MemoryIntegrationComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write";
}

// The hook component's contribution to "complete" can only ever be
// runtime-observed evidence — never a structurally-correct config entry alone
// (that's what the bug this type guards against looked like: a plan that would
// write a valid hook entry reporting "complete" before any real session had
// ever run it).
function isHookRuntimeOk(status: HookRuntimeStatus): boolean {
  return status.kind === "runtime-observed";
}

export function computeOverallStatus(
  mcp: MemoryIntegrationComponentStatus,
  instructions: MemoryIntegrationComponentStatus,
  hook: HookRuntimeStatus,
): MemoryIntegrationOverallStatus {
  const mcpOk = isOk(mcp);
  const instructionsOk = isOk(instructions);
  const hookOk = isHookRuntimeOk(hook);
  if (mcpOk && instructionsOk && hookOk) return "complete";
  if (!mcpOk && !instructionsOk && !hookOk) return "unsupported";
  return "partial";
}

// For removal, "unsupported" means "there was never anything to remove here", which is a success
// state — unlike install, where it means "this component did not get installed".
function isRemovalOk(status: MemoryIntegrationComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write" || status.kind === "unsupported";
}

// Removal only ever needs the structural HookComponentStatus: whether Engines
// successfully wrote the config away, not whether the hook had ever run.
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
