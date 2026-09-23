import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { resolveEngramExecutable } from "../../modules/memory-protocol/constants";
import { EngramProtocolUnavailableError, fetchMemoryProtocol } from "./memory-protocol-client";

let dir: string;
let previousForgeHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-engram-client-"));
  previousForgeHome = process.env.FORGE614_HOME;
  delete process.env.FORGE614_HOME;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME;
  else process.env.FORGE614_HOME = previousForgeHome;
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

    const result = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] });

    expect(result.protocol.id).toBe("forge614-engram-memory");
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const again = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] });
    expect(again.fingerprint).toBe(result.fingerprint);
  });

  test("throws not-installed when the executable does not exist", async () => {
    const missing = join(dir, "does-not-exist-binary");

    const error = await fetchMemoryProtocol(dir, { command: missing, args: [] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("not-installed");
  });

  test("throws command-failed when the process exits non-zero", async () => {
    const script = fixture("fail.js", "process.exit(1);");

    const error = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("command-failed");
  });

  test("throws invalid-json when stdout is not JSON", async () => {
    const script = fixture("bad-json.js", "console.log('not json at all');");

    const error = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("invalid-json");
  });

  test("throws invalid-schema when stdout is JSON but does not match the protocol shape", async () => {
    const script = fixture("bad-schema.js", "console.log(JSON.stringify({ hello: 'world' }));");

    const error = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("invalid-schema");
  });

  test("never includes stderr content in the thrown error", async () => {
    const script = fixture(
      "secret-stderr.js",
      "process.stderr.write(JSON.stringify({code:'X',error:'super-secret-token-abc'}));process.exit(1);",
    );

    const error = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] }).catch((e) => e);

    expect((error as Error).message).not.toContain("super-secret-token-abc");
  });
});

describe("fetchMemoryProtocol (canonical path, no PATH dependency)", () => {
  test.skipIf(process.platform === "win32")(
    "runs the canonical <FORGE614_HOME>/engram/bin/forge614-engram binary when no options are given",
    async () => {
      const canonicalPath = resolveEngramExecutable(dir);
      mkdirSync(dirname(canonicalPath), { recursive: true });
      // Shebang points at the absolute node/bun binary, not a bare "node" on
      // PATH, so this fixture proves the call needed no PATH lookup at all —
      // not even for the interpreter, let alone for forge614-engram itself.
      writeFileSync(
        canonicalPath,
        `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(VALID_PROTOCOL))});\n`,
      );
      chmodSync(canonicalPath, 0o755);

      const result = await fetchMemoryProtocol(dir);

      expect(result.protocol.id).toBe("forge614-engram-memory");
    },
  );

  // The .exe suffix is part of the contract on Windows, so the expectation follows the platform.
  test.each([
    ["linux", "forge614-engram"],
    ["darwin", "forge614-engram"],
    ["win32", "forge614-engram.exe"],
  ] as const)("respects a custom FORGE614_HOME when resolving the default binary (%s)", (platform, binary) => {
    const customForgeHome = join(dir, "custom-forge-home");
    process.env.FORGE614_HOME = customForgeHome;
    const pathFor = platform === "win32" ? win32 : posix;

    expect(resolveEngramExecutable(dir, platform)).toBe(pathFor.join(customForgeHome, "engram", "bin", binary));
  });

  test("respects a custom FORGE614_HOME for the host platform too", () => {
    const customForgeHome = join(dir, "custom-forge-home");
    process.env.FORGE614_HOME = customForgeHome;
    const suffix = process.platform === "win32" ? ".exe" : "";

    expect(resolveEngramExecutable(dir)).toBe(join(customForgeHome, "engram", "bin", `forge614-engram${suffix}`));
  });

  test("resolves a .exe suffix on Windows regardless of host platform", () => {
    expect(resolveEngramExecutable("C:\\Users\\u", "win32")).toBe(
      "C:\\Users\\u\\.forge614\\engram\\bin\\forge614-engram.exe",
    );
  });

  test("throws not-installed (ENGRAM_PROTOCOL_UNAVAILABLE) and never falls back to PATH when the canonical binary is missing", async () => {
    const error = await fetchMemoryProtocol(dir).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("not-installed");
  });
});
