import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPathWritable } from "./writable";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-writable-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isPathWritable", () => {
  test("true for an existing writable file", async () => {
    const path = join(dir, "existing.json");
    writeFileSync(path, "{}");
    expect(await isPathWritable(path)).toBe(true);
  });

  test("true for a path that does not exist yet, when the parent directory is writable", async () => {
    expect(await isPathWritable(join(dir, "missing.json"))).toBe(true);
  });

  test("false for a path whose parent directory does not exist", async () => {
    expect(await isPathWritable(join(dir, "nested", "missing.json"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "false for a read-only existing file",
    async () => {
      const path = join(dir, "readonly.json");
      writeFileSync(path, "{}");
      chmodSync(path, 0o444);
      expect(await isPathWritable(path)).toBe(false);
      chmodSync(path, 0o644);
    },
  );
});
