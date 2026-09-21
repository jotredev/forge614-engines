import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchStartupContext, StartupContextUnavailableError } from "./startup-context-client";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-startupcontext-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const RESULT = {
  format: 1,
  shared: { pinned: [], recent: [{ title: "Shared fact", preview: "applies everywhere" }], sessions: [], truncated: false },
  project: { status: "unbound", projectId: null, context: null },
};

describe("fetchStartupContext", () => {
  test("parses a successful result", async () => {
    const script = join(dir, "ok.js");
    writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(RESULT))});`);
    const result = await fetchStartupContext(dir, "/some/repo", { command: process.execPath, args: [script] });
    expect(result).toEqual(RESULT);
  });

  test("throws not-installed when the command does not exist", async () => {
    const error = await fetchStartupContext(dir, "/some/repo", { command: join(dir, "does-not-exist"), args: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(StartupContextUnavailableError);
    expect(error.reason).toBe("not-installed");
  });

  test("throws command-failed on a non-zero exit", async () => {
    const script = join(dir, "fail.js");
    writeFileSync(script, `process.exit(1);`);
    const error = await fetchStartupContext(dir, "/some/repo", { command: process.execPath, args: [script] }).catch((e) => e);
    expect(error).toBeInstanceOf(StartupContextUnavailableError);
    expect(error.reason).toBe("command-failed");
  });

  test("throws invalid-json on unparsable stdout", async () => {
    const script = join(dir, "garbage.js");
    writeFileSync(script, `console.log("not json");`);
    const error = await fetchStartupContext(dir, "/some/repo", { command: process.execPath, args: [script] }).catch((e) => e);
    expect(error).toBeInstanceOf(StartupContextUnavailableError);
    expect(error.reason).toBe("invalid-json");
  });
});
