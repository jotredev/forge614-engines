import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "./atomic-write";

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
