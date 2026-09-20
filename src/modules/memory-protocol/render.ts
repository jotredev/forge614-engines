import type { MemoryProtocol } from "./types";

function section(title: string, lines: string[]): string {
  return [`### ${title}`, "", ...lines.map((line) => `- ${line}`)].join("\n");
}

export function renderProtocolMarkdown(protocol: MemoryProtocol): string {
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
