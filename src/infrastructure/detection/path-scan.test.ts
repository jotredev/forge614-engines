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

describe("findExecutableInPath", () => {
  test("finds an executable file in PATH", async () => {
    const binPath = join(dir, "fake-agent");
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, "darwin");
    expect(result).toBe(binPath);
  });

  test("ignores a non-executable file", async () => {
    writeFileSync(join(dir, "fake-agent"), "not executable");

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, "darwin");
    expect(result).toBeUndefined();
  });

  test("ignores a directory that shares the binary's name", async () => {
    mkdirSync(join(dir, "fake-agent"));

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, "darwin");
    expect(result).toBeUndefined();
  });

  test("dedupes repeated PATH directories", async () => {
    const binPath = join(dir, "fake-agent");
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);

    const result = await findExecutableInPath(["fake-agent"], { PATH: `${dir}:${dir}` }, "darwin");
    expect(result).toBe(binPath);
  });
});
