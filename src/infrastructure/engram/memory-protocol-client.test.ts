import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngramProtocolUnavailableError, fetchMemoryProtocol } from "./memory-protocol-client";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-engram-client-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, script);
  return path;
}

const VALID_PROTOCOL = {
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
  scopes: { shared: "Cross-client.", project: "Repository-specific." },
  security: { neverSave: ["passwords"] },
};

describe("fetchMemoryProtocol", () => {
  test("returns the protocol and a stable fingerprint on success", async () => {
    const script = fixture("ok.js", `console.log(${JSON.stringify(JSON.stringify(VALID_PROTOCOL))});`);

    const result = await fetchMemoryProtocol({ command: process.execPath, args: [script] });

    expect(result.protocol.id).toBe("forge614-engram-memory");
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const again = await fetchMemoryProtocol({ command: process.execPath, args: [script] });
    expect(again.fingerprint).toBe(result.fingerprint);
  });

  test("throws not-installed when the executable does not exist", async () => {
    const missing = join(dir, "does-not-exist-binary");

    const error = await fetchMemoryProtocol({ command: missing, args: [] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("not-installed");
  });

  test("throws command-failed when the process exits non-zero", async () => {
    const script = fixture("fail.js", "process.exit(1);");

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("command-failed");
  });

  test("throws invalid-json when stdout is not JSON", async () => {
    const script = fixture("bad-json.js", "console.log('not json at all');");

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("invalid-json");
  });

  test("throws invalid-schema when stdout is JSON but does not match the protocol shape", async () => {
    const script = fixture("bad-schema.js", "console.log(JSON.stringify({ hello: 'world' }));");

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("invalid-schema");
  });

  test("never includes stderr content in the thrown error", async () => {
    const script = fixture(
      "secret-stderr.js",
      "process.stderr.write(JSON.stringify({code:'X',error:'super-secret-token-abc'}));process.exit(1);",
    );

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect((error as Error).message).not.toContain("super-secret-token-abc");
  });
});
