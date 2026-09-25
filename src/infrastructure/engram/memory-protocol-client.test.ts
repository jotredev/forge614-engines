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

const VALID_PROTOCOL_V4 = {
  id: "forge614-engram-memory",
  version: 4,
  instructions: "Call memory_context at the start of a conversation.",
  mcpInstructions: "Call memory_context at the start of a conversation.",
  startupContext: { command: "forge614-engram startup-context --directory <dir> --json --format 2", format: 2, description: "d" },
};

/**
 * Builds a fake forge614-engram binary that mimics the real CLI's
 * `--protocol-version` negotiation: an Engram 1.7.0+ double answers `4` with a
 * v4 payload and anything else with v1; `rejectV4: true` instead mimics an
 * Engram older than 1.7.0, which rejects the flag outright with the exact
 * `{code:"INVALID_INPUT",...}` envelope forge614-engram's own CLI writes to
 * stderr on a non-zero exit.
 */
function versionedFixture(name: string, options?: { rejectV4?: boolean }): string {
  const lines = [
    "const args = process.argv.slice(2);",
    'const idx = args.indexOf("--protocol-version");',
    'const wantsV4 = idx !== -1 && args[idx + 1] === "4";',
    options?.rejectV4
      ? [
          "if (wantsV4) {",
          `  process.stderr.write(${JSON.stringify(JSON.stringify({ code: "INVALID_INPUT", error: "protocol-version debe ser 1, 2, 3 o 4." }))});`,
          "  process.exit(1);",
          "}",
        ].join("\n")
      : "",
    `console.log(wantsV4 ? ${JSON.stringify(JSON.stringify(VALID_PROTOCOL_V4))} : ${JSON.stringify(JSON.stringify(VALID_PROTOCOL))});`,
  ].join("\n");
  return fixture(name, lines);
}

describe("fetchMemoryProtocol", () => {
  test("returns the protocol and a stable fingerprint on success", async () => {
    const script = versionedFixture("ok.js");

    const result = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] });

    expect(result.protocol.id).toBe("forge614-engram-memory");
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const again = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] });
    expect(again.fingerprint).toBe(result.fingerprint);
  });

  test("prefers protocol v4 on the first try when Engram supports it, with no legacy notice", async () => {
    const script = versionedFixture("ok-v4.js");

    const result = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] });

    expect(result.protocol.version).toBe(4);
    expect(result.legacyProtocolNotice).toBeUndefined();
  });

  test("falls back to protocol v1 and surfaces a bilingual notice when Engram rejects --protocol-version 4 with INVALID_INPUT", async () => {
    const script = versionedFixture("legacy-engram.js", { rejectV4: true });

    const result = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] });

    expect(result.protocol.version).toBe(1);
    expect(result.legacyProtocolNotice).toBeDefined();
    expect(result.legacyProtocolNotice).toContain("1.7.0");
    expect(result.legacyProtocolNotice).toContain("actualiza Engram"); // Spanish half
    expect(result.legacyProtocolNotice).toContain("upgrade Engram"); // English half
  });

  test("does not fall back to v1 when the v4 attempt fails with an error other than INVALID_INPUT", async () => {
    const script = fixture(
      "other-error.js",
      [
        "const args = process.argv.slice(2);",
        'if (args.includes("--protocol-version")) {',
        `  process.stderr.write(${JSON.stringify(JSON.stringify({ code: "STORAGE_ERROR", error: "boom" }))});`,
        "  process.exit(1);",
        "}",
        // If Engines incorrectly fell back and called again without --protocol-version, this
        // branch would succeed — proving the fallback firing, not just a generic failure.
        `console.log(${JSON.stringify(JSON.stringify(VALID_PROTOCOL))});`,
      ].join("\n"),
    );

    const error = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("command-failed");
  });

  test("accepts a v4 response that carries extra, unknown fields", async () => {
    const script = fixture(
      "v4-extra-fields.js",
      `console.log(${JSON.stringify(JSON.stringify({ ...VALID_PROTOCOL_V4, extra: "future field" }))});`,
    );

    const result = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] });

    expect(result.protocol.version).toBe(4);
  });

  test("throws invalid-schema, with no v1 retry, when the v4 call succeeds but the payload is not v4-shaped", async () => {
    const script = fixture("v4-bad-shape.js", `console.log(${JSON.stringify(JSON.stringify({ id: "forge614-engram-memory", version: 4 }))});`);

    const error = await fetchMemoryProtocol(dir, { command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("invalid-schema");
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
        `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(VALID_PROTOCOL_V4))});\n`,
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
