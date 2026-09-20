import { describe, expect, test } from "bun:test";
import { isMemoryProtocol, type MemoryProtocol } from "./types";

function validProtocol(): MemoryProtocol {
  return {
    id: "forge614-engram-memory",
    version: 1,
    instructions: "Use memory_context at the start of every session.",
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
}

describe("isMemoryProtocol", () => {
  test("accepts a well-formed protocol document", () => {
    expect(isMemoryProtocol(validProtocol())).toBe(true);
  });

  test("rejects a wrong id", () => {
    expect(isMemoryProtocol({ ...validProtocol(), id: "something-else" })).toBe(false);
  });

  test("rejects a wrong version", () => {
    expect(isMemoryProtocol({ ...validProtocol(), version: 2 })).toBe(false);
  });

  test("rejects a missing lifecycle key", () => {
    const protocol = validProtocol();
    // @ts-expect-error deliberately malformed for the test
    delete protocol.lifecycle.compact;
    expect(isMemoryProtocol(protocol)).toBe(false);
  });

  test("rejects a lifecycle array containing a non-string", () => {
    const protocol = validProtocol();
    // @ts-expect-error deliberately malformed for the test
    protocol.lifecycle.start = [1, 2];
    expect(isMemoryProtocol(protocol)).toBe(false);
  });

  test("rejects null and non-objects", () => {
    expect(isMemoryProtocol(null)).toBe(false);
    expect(isMemoryProtocol("a string")).toBe(false);
    expect(isMemoryProtocol(42)).toBe(false);
  });

  test("rejects empty instructions", () => {
    expect(isMemoryProtocol({ ...validProtocol(), instructions: "" })).toBe(false);
  });
});
