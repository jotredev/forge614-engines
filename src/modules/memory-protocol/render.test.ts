import { describe, expect, test } from "bun:test";
import type { MemoryProtocol, MemoryProtocolV4 } from "./types";
import { renderProtocolMarkdown } from "./render";

const protocol: MemoryProtocol = {
  id: "forge614-engram-memory",
  version: 1,
  instructions: "Call memory_context at the start of a conversation.",
  lifecycle: {
    start: ["Call memory_context."],
    save: ["Save explicit remember requests."],
    compact: ["Call memory_session_summary before compacting."],
    resume: ["Call memory_context after compaction."],
    end: ["Call memory_session_end."],
  },
  scopes: { shared: "Cross-client preferences.", project: "Repository-specific knowledge." },
  security: { neverSave: ["passwords", "tokens"] },
};

describe("renderProtocolMarkdown", () => {
  test("includes the protocol id, version, and instructions verbatim", () => {
    const markdown = renderProtocolMarkdown(protocol);
    expect(markdown).toContain("forge614-engram-memory");
    expect(markdown).toContain("version 1");
    expect(markdown).toContain("Call memory_context at the start of a conversation.");
  });

  test("includes every lifecycle phase and every security rule", () => {
    const markdown = renderProtocolMarkdown(protocol);
    for (const phase of ["Start", "Save", "Compact", "Resume", "End"]) {
      expect(markdown).toContain(phase);
    }
    expect(markdown).toContain("Call memory_session_summary before compacting.");
    expect(markdown).toContain("passwords");
    expect(markdown).toContain("tokens");
  });

  test("is deterministic for the same input", () => {
    expect(renderProtocolMarkdown(protocol)).toBe(renderProtocolMarkdown(protocol));
  });
});

const protocolV4: MemoryProtocolV4 = {
  id: "forge614-engram-memory",
  version: 4,
  instructions: "Read the startup block; call memory_context otherwise.\n\nSave durable decisions on your own.",
  mcpInstructions: "Read the startup block; call memory_context otherwise.",
  startupContext: {
    command: "forge614-engram startup-context --directory <absolute-directory> --json --format 2",
    format: 2,
    description: "One ready-to-inject text block.",
  },
};

describe("renderProtocolMarkdown (version 4)", () => {
  test("installs `instructions` verbatim — no rewriting, no summarizing", () => {
    const markdown = renderProtocolMarkdown(protocolV4);
    expect(markdown).toContain(protocolV4.instructions);
  });

  test("installs exactly `instructions`, byte for byte, with nothing added (new-agent checklist)", () => {
    expect(renderProtocolMarkdown(protocolV4)).toBe(protocolV4.instructions);
  });

  test("never synthesizes Lifecycle/Scopes/Security sections v4 does not carry", () => {
    const markdown = renderProtocolMarkdown(protocolV4);
    expect(markdown).not.toContain("## Lifecycle");
    expect(markdown).not.toContain("## Scopes");
    expect(markdown).not.toContain("## Security");
  });

  test("never writes mcpInstructions into the rendered markdown", () => {
    const distinctMcp: MemoryProtocolV4 = { ...protocolV4, mcpInstructions: "UNIQUE_MCP_ONLY_TEXT_never_in_instructions" };
    expect(renderProtocolMarkdown(distinctMcp)).not.toContain("UNIQUE_MCP_ONLY_TEXT_never_in_instructions");
  });

  test("is deterministic for the same input", () => {
    expect(renderProtocolMarkdown(protocolV4)).toBe(renderProtocolMarkdown(protocolV4));
  });
});
