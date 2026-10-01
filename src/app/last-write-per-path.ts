import type { PlanWrite } from "../modules/config-writer/types";

/**
 * Keeps a single write per file: the last one for each path. The MCP, hook and approval
 * decisions that share a file are computed as a chain (each one starts from the result of the
 * previous one), so the last one already includes the others; keeping all of them would stack two
 * independent writes to the same file and the second would overwrite the first. Keeps the order of appearance.
 */
export function lastWritePerPath(writes: PlanWrite[]): PlanWrite[] {
  const lastByPath = new Map<string, PlanWrite>();
  for (const write of writes) lastByPath.set(write.path, write);
  return writes.filter((write) => lastByPath.get(write.path) === write);
}
