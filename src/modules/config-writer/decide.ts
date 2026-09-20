export type DiffDecision = { kind: "noop" } | { kind: "conflict" } | { kind: "write" };

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function decideMcpWrite(existingEntry: unknown, desiredEntry: unknown): DiffDecision {
  if (existingEntry === undefined) return { kind: "write" };
  if (deepEqual(existingEntry, desiredEntry)) return { kind: "noop" };
  return { kind: "conflict" };
}
