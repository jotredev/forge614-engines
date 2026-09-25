import type { AnyMemoryProtocol, MemoryProtocol, MemoryProtocolV4 } from "./types";

function section(title: string, lines: string[]): string {
  return [`### ${title}`, "", ...lines.map((line) => `- ${line}`)].join("\n");
}

/** Dispatches on `version`: v1 keeps its existing rendered shape (kept as the fallback render for an old Engram); v4 installs `instructions` as-is. */
export function renderProtocolMarkdown(protocol: AnyMemoryProtocol): string {
  return protocol.version === 4 ? renderProtocolMarkdownV4(protocol) : renderProtocolMarkdownV1(protocol);
}

/**
 * Version 4 carries no lifecycle/scopes/security: `instructions` is already the
 * complete manual, so it is installed exactly as Engram serves it — byte for byte,
 * with nothing added (the new-agent checklist verifies it that way). Around it
 * Engines writes only its own block markers and managed-header comment line.
 */
function renderProtocolMarkdownV4(protocol: MemoryProtocolV4): string {
  return protocol.instructions;
}

function renderProtocolMarkdownV1(protocol: MemoryProtocol): string {
  return [
    "## Forge614 Engram memory protocol",
    "",
    `Protocol: ${protocol.id} (version ${protocol.version})`,
    "",
    protocol.instructions,
    "",
    "## Lifecycle",
    "",
    section("Start", protocol.lifecycle.start),
    "",
    section("Save", protocol.lifecycle.save),
    "",
    section("Compact", protocol.lifecycle.compact),
    "",
    section("Resume", protocol.lifecycle.resume),
    "",
    section("End", protocol.lifecycle.end),
    "",
    "## Scopes",
    "",
    `- Shared: ${protocol.scopes.shared}`,
    `- Project: ${protocol.scopes.project}`,
    "",
    "## Security",
    "",
    ...protocol.security.neverSave.map((item) => `- Never save: ${item}`),
  ].join("\n");
}
