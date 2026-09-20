import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicDelete, atomicWrite } from "./atomic-write";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-atomicwrite-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  test("creates a new file and reports changed:true", async () => {
    const target = join(dir, "config.json");
    const result = await atomicWrite(target, '{"a":1}');
    expect(result.changed).toBe(true);
    expect(readFileSync(target, "utf8")).toBe('{"a":1}');
  });

  test("reports changed:false and leaves the file untouched when content is identical", async () => {
    const target = join(dir, "config.json");
    writeFileSync(target, '{"a":1}');
    const result = await atomicWrite(target, '{"a":1}');
    expect(result.changed).toBe(false);
    expect(readFileSync(target, "utf8")).toBe('{"a":1}');
  });

  test("overwrites existing content", async () => {
    const target = join(dir, "config.json");
    writeFileSync(target, '{"a":1}');
    const result = await atomicWrite(target, '{"a":2}');
    expect(result.changed).toBe(true);
    expect(readFileSync(target, "utf8")).toBe('{"a":2}');
  });
});

describe("atomicDelete", () => {
  test("deletes an existing file and reports changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engines-atomicdelete-"));
    const target = join(dir, "file.txt");
    writeFileSync(target, "content");

    const result = await atomicDelete(target);

    expect(result.changed).toBe(true);
    expect(existsSync(target)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("is a noop when the file does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engines-atomicdelete-noop-"));
    const target = join(dir, "missing.txt");

    const result = await atomicDelete(target);

    expect(result.changed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
