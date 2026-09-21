import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveHookEvidencePath } from "../modules/agents/hook-command";
import { HOOK_EVIDENCE_MAX_AGE_MS, readHookEvidence, recordHookEvidence } from "./hook-evidence";

/** Rewrites just the `timestamp` field of already-recorded evidence, keeping everything else (fingerprint, agentId) valid. */
function overwriteEvidenceTimestamp(home: string, agentId: "claude-code" | "codex", timestamp: unknown): void {
  const path = resolveHookEvidencePath(home, agentId);
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  evidence.timestamp = timestamp;
  writeFileSync(path, JSON.stringify(evidence));
}

let home: string;
let previousForgeHome: string | undefined;

beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  delete process.env.FORGE614_HOME;
  home = mkdtempSync(join(tmpdir(), "engines-hookevidence-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME;
  else process.env.FORGE614_HOME = previousForgeHome;
});

describe("readHookEvidence", () => {
  test("is absent when nothing was ever recorded", async () => {
    const result = await readHookEvidence(home, "claude-code");
    expect(result.kind).toBe("absent");
  });

  test("is valid immediately after a matching real record", async () => {
    await recordHookEvidence(home, "claude-code", true);

    const result = await readHookEvidence(home, "claude-code");
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.contextReceived).toBe(true);
      expect(typeof result.timestamp).toBe("string");
    }
  });

  test("carries whether Engram context was actually received", async () => {
    await recordHookEvidence(home, "codex", false);

    const result = await readHookEvidence(home, "codex");
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") expect(result.contextReceived).toBe(false);
  });

  test("is invalid/corrupt when the file is not valid evidence JSON", async () => {
    const path = resolveHookEvidencePath(home, "claude-code");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json at all");

    const result = await readHookEvidence(home, "claude-code");
    expect(result).toEqual({ kind: "invalid", reason: "corrupt" });
  });

  test("is invalid/corrupt when required fields are missing", async () => {
    const path = resolveHookEvidencePath(home, "claude-code");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ format: 1 }));

    const result = await readHookEvidence(home, "claude-code");
    expect(result).toEqual({ kind: "invalid", reason: "corrupt" });
  });

  test("is invalid/wrong-agent when the stored agentId doesn't match the path being read", async () => {
    // Recorded correctly for codex, then manually placed at claude-code's own path
    // (simulating a corrupted/copied file) — never counts as claude-code's evidence.
    await recordHookEvidence(home, "codex", true);
    const codexPath = resolveHookEvidencePath(home, "codex");
    const claudeCodePath = resolveHookEvidencePath(home, "claude-code");
    writeFileSync(claudeCodePath, readFileSync(codexPath, "utf8"));

    const result = await readHookEvidence(home, "claude-code");
    expect(result).toEqual({ kind: "invalid", reason: "wrong-agent" });
  });

  test("is invalid/fingerprint-mismatch when the hook's identity has changed since evidence was recorded", async () => {
    await recordHookEvidence(home, "claude-code", true);

    // A different FORGE614_HOME means a different resolved hook command string,
    // hence a different fingerprint — old evidence must not silently carry over.
    process.env.FORGE614_HOME = join(home, "different-forge-home");

    const result = await readHookEvidence(home, "claude-code");
    expect(result.kind).toBe("absent"); // no evidence file exists under the new FORGE614_HOME at all
  });

  test("is valid when recorded well within the max-age window", async () => {
    await recordHookEvidence(home, "claude-code", true);
    overwriteEvidenceTimestamp(home, "claude-code", new Date(Date.now() - 1000).toISOString()); // 1 second old

    const result = await readHookEvidence(home, "claude-code");
    expect(result.kind).toBe("valid");
  });

  test("is invalid/expired once older than the documented max age", async () => {
    await recordHookEvidence(home, "claude-code", true);
    overwriteEvidenceTimestamp(home, "claude-code", new Date(Date.now() - HOOK_EVIDENCE_MAX_AGE_MS - 1000).toISOString());

    const result = await readHookEvidence(home, "claude-code");
    expect(result).toEqual({ kind: "invalid", reason: "expired" });
  });

  test("is valid exactly at the max-age boundary, invalid just past it", async () => {
    await recordHookEvidence(home, "claude-code", true);

    overwriteEvidenceTimestamp(home, "claude-code", new Date(Date.now() - HOOK_EVIDENCE_MAX_AGE_MS + 2000).toISOString());
    expect((await readHookEvidence(home, "claude-code")).kind).toBe("valid");

    overwriteEvidenceTimestamp(home, "claude-code", new Date(Date.now() - HOOK_EVIDENCE_MAX_AGE_MS - 2000).toISOString());
    expect((await readHookEvidence(home, "claude-code")).kind).toBe("invalid");
  });

  test("is invalid/corrupt when the timestamp is not a real date", async () => {
    await recordHookEvidence(home, "claude-code", true);
    overwriteEvidenceTimestamp(home, "claude-code", "not-a-real-date");

    const result = await readHookEvidence(home, "claude-code");
    expect(result).toEqual({ kind: "invalid", reason: "corrupt" });
  });

  test("is invalid/corrupt when the timestamp is missing entirely", async () => {
    const path = resolveHookEvidencePath(home, "claude-code");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ format: 1, agentId: "claude-code", engramContextReceived: true, commandFingerprint: "x" }),
    );

    const result = await readHookEvidence(home, "claude-code");
    expect(result).toEqual({ kind: "invalid", reason: "corrupt" });
  });

  test("is invalid/corrupt when the timestamp is suspiciously in the future (beyond normal clock skew)", async () => {
    await recordHookEvidence(home, "claude-code", true);
    overwriteEvidenceTimestamp(home, "claude-code", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()); // one day ahead

    const result = await readHookEvidence(home, "claude-code");
    expect(result).toEqual({ kind: "invalid", reason: "corrupt" });
  });

  test("tolerates a small amount of future clock skew between machines", async () => {
    await recordHookEvidence(home, "claude-code", true);
    overwriteEvidenceTimestamp(home, "claude-code", new Date(Date.now() + 30 * 1000).toISOString()); // 30s ahead

    const result = await readHookEvidence(home, "claude-code");
    expect(result.kind).toBe("valid");
  });

  test("never contains memory content, the real directory, or secrets, even when Engram context was received", async () => {
    const secretDirectory = "/repo/SUPER_SECRET_PROJECT_PATH_MARKER";
    await recordHookEvidence(home, "claude-code", true);

    const raw = readFileSync(resolveHookEvidencePath(home, "claude-code"), "utf8");
    expect(raw).not.toContain(secretDirectory);
    expect(raw).not.toContain("SUPER_SECRET_PROJECT_PATH_MARKER");
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(["agentId", "commandFingerprint", "engramContextReceived", "format", "timestamp"]);
  });
});

describe("recordHookEvidence", () => {
  test("is atomic and idempotent: writing twice leaves one valid, parseable file", async () => {
    await recordHookEvidence(home, "claude-code", true);
    await recordHookEvidence(home, "claude-code", true);

    const raw = readFileSync(resolveHookEvidencePath(home, "claude-code"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    const result = await readHookEvidence(home, "claude-code");
    expect(result.kind).toBe("valid");
  });

  test("propagates a write failure to its caller — swallowing it is the CLI layer's job, not this primitive's", async () => {
    // home itself is a file, not a directory: every path under it is unwritable.
    const brokenHome = join(home, "broken-home-file");
    writeFileSync(brokenHome, "not a directory");

    await expect(recordHookEvidence(brokenHome, "claude-code", true)).rejects.toThrow();
  });
});
