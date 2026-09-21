/**
 * Builds a preview-safe copy of a conflicting MCP entry for display: only
 * `command` (string) and `args` (string[]) are ever echoed verbatim. Every
 * other key — including a hypothetical `env` block holding another tool's
 * credentials — is masked. A non-object entry is never echoed at all, in
 * case the key was repurposed to hold a bare secret string.
 */
export function redactMcpEntry(entry: unknown): unknown {
  if (entry === undefined) return undefined;
  if (typeof entry !== "object" || entry === null) {
    return { type: typeof entry, redacted: true };
  }
  if (Array.isArray(entry)) {
    return { type: "object", redacted: true };
  }
  const record = entry as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (key === "command" && typeof value === "string") {
      result[key] = value;
    } else if (key === "args" && Array.isArray(value) && value.every((item) => typeof item === "string")) {
      result[key] = value;
    } else {
      result[key] = "<redacted>";
    }
  }
  return result;
}
