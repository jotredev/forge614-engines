/**
 * Key that Codex accepts inside an MCP server's table to always approve its tools. The memory
 * install writes it (see tool-approval-write-decision.ts), so it does not count as a difference
 * when comparing the server entry with the canonical one: with this key the entry is still ours.
 */
export const APPROVAL_MODE_KEY = "default_tools_approval_mode";

/** Returns the entry without the approval key; any other key is kept so it still counts as a difference. */
export function withoutApprovalKey(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const { [APPROVAL_MODE_KEY]: _approval, ...rest } = entry as Record<string, unknown>;
  return rest;
}

export type DiffDecision = { kind: "noop" } | { kind: "conflict" } | { kind: "write" };

/** Whether an existing MCP entry equals the desired one, ignoring the approval key of the existing one. */
export function sameMcpEntry(existing: unknown, desired: unknown): boolean {
  return JSON.stringify(withoutApprovalKey(existing)) === JSON.stringify(desired);
}

export function decideMcpWrite(existingEntry: unknown, desiredEntry: unknown): DiffDecision {
  if (existingEntry === undefined) return { kind: "write" };
  if (sameMcpEntry(existingEntry, desiredEntry)) return { kind: "noop" };
  return { kind: "conflict" };
}
