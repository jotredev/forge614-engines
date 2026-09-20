import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot, restoreSnapshot } from "./snapshot";

let home: string;
let configPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-snapshot-"));
  configPath = join(home, "config.json");
  writeFileSync(configPath, '{"original":true}');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("snapshot", () => {
  test("creates a manifest recording the backed-up file and its checksum", async () => {
    const manifest = await createSnapshot(home, "plan-1", [configPath]);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].originalPath).toBe(configPath);
  });

  test("restoreSnapshot puts the original content back after the file changes", async () => {
    await createSnapshot(home, "plan-1", [configPath]);
    writeFileSync(configPath, '{"modified":true}');

    await restoreSnapshot(home, "plan-1");

    expect(readFileSync(configPath, "utf8")).toBe('{"original":true}');
  });

  test("skips files that did not exist before the plan", async () => {
    const missingPath = join(home, "missing.json");
    const manifest = await createSnapshot(home, "plan-2", [missingPath]);
    expect(manifest.files).toHaveLength(0);
  });
});
