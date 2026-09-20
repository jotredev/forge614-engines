import { describe, expect, test } from "bun:test";
import type { MemoryProtocol } from "./types";
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
