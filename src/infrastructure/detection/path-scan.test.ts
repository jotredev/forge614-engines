import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutableInPath } from "./path-scan";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-pathscan-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Tests use the REAL host platform (not a hardcoded "darwin"/"linux") because
// mkdtempSync/join always produce real, host-native paths (e.g. a Windows
// runner's temp dir already contains "C:" and backslashes) — simulating a
// different platform's separator logic against those real paths silently
// misparses them (a literal ":" split on a Windows path breaks on the drive
// letter's own colon). In production the platform argument is always
// `process.platform` too, so this matches real usage exactly.
const pathListSeparator = process.platform === "win32" ? ";" : ":";

describe("findExecutableInPath", () => {
  test("finds an executable file in PATH", async () => {
    const binPath = join(dir, "fake-agent");
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, process.platform);
    expect(result).toBe(binPath);
  });

  // Windows has no chmod-style execute bit: fs.access's X_OK flag "has no
  // effect on Windows" (Node docs) and behaves like a plain existence check,
  // so an existing regular file is always reported as accessible there —
  // there is no "non-executable regular file" scenario to test on Windows.
  test.skipIf(process.platform === "win32")("ignores a non-executable file", async () => {
    writeFileSync(join(dir, "fake-agent"), "not executable");

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, process.platform);
    expect(result).toBeUndefined();
  });

  test("ignores a directory that shares the binary's name", async () => {
    mkdirSync(join(dir, "fake-agent"));

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, process.platform);
    expect(result).toBeUndefined();
  });

  test("dedupes repeated PATH directories", async () => {
    const binPath = join(dir, "fake-agent");
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);

    const result = await findExecutableInPath(
      ["fake-agent"],
      { PATH: `${dir}${pathListSeparator}${dir}` },
      process.platform,
    );
    expect(result).toBe(binPath);
  });
});
