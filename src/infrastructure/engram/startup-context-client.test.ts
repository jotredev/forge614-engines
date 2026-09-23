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
  format: 1 as const,
  shared: { pinned: [], recent: [{ title: "Shared fact", preview: "applies everywhere" }], sessions: [], truncated: false },
  project: { status: "unbound" as const, projectId: null, context: null },
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

  // Shape of the real `forge614-engram startup-context --json` output at 1.6.0 (additive fields on format 1).
  const ENGRAM_1_6_0 = {
    format: 1,
    shared: { format: 1, pinned: [], recent: [], summaries: [], omitted: 0, truncated: false },
    ecosystem: {
      status: "member",
      group: { id: "e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4", name: "forge614" },
      context: { format: 1, pinned: [], recent: [{ title: "Group fact", preview: "p" }], summaries: [], omitted: 0, truncated: false },
    },
    project: {
      status: "bound",
      projectId: "42007e73-ab93-4b4e-9e1a-a699e48674c1",
      context: { format: 1, pinned: [], recent: [], summaries: [], omitted: 0, truncated: false },
      source: "file",
      notices: [{ code: "DATABASE_MIGRATED", message: "base actualizada", backup: "/tmp/engram.db.bak" }],
    },
  };

  test("accepts Engram 1.6.0's additive fields (ecosystem, project.source, project.notices) — R31", async () => {
    const script = join(dir, "engram160.js");
    writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(ENGRAM_1_6_0))});`);
    const result = await fetchStartupContext(dir, "/some/repo", { command: process.execPath, args: [script] });
    expect(result.ecosystem).toEqual(ENGRAM_1_6_0.ecosystem as never);
    expect(result.project.source).toBe("file");
  });

  test("ignores unknown fields at the root and inside every block — R31", async () => {
    const future = {
      ...ENGRAM_1_6_0,
      futureRootField: { anything: true },
      shared: { ...ENGRAM_1_6_0.shared, futureSharedField: 1 },
      ecosystem: { ...ENGRAM_1_6_0.ecosystem, futureEcosystemField: 1 },
      project: { ...ENGRAM_1_6_0.project, futureProjectField: 1 },
    };
    const script = join(dir, "future.js");
    writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(future))});`);
    const result = await fetchStartupContext(dir, "/some/repo", { command: process.execPath, args: [script] });
    expect(result.project.status).toBe("bound");
  });

  test("treats an ecosystem block it does not understand as absent, keeping shared and project", async () => {
    const odd = { ...ENGRAM_1_6_0, ecosystem: { status: "quantum" } };
    const script = join(dir, "odd-eco.js");
    writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(odd))});`);
    const result = await fetchStartupContext(dir, "/some/repo", { command: process.execPath, args: [script] });
    expect(result.ecosystem).toBeUndefined();
    expect(result.project.status).toBe("bound");
  });

  test("still rejects a response that breaks the fields this node uses (unknown format, bad project status)", async () => {
    for (const bad of [{ ...ENGRAM_1_6_0, format: 2 }, { ...ENGRAM_1_6_0, project: { ...ENGRAM_1_6_0.project, status: "weird" } }, { format: 1, shared: {} }]) {
      const script = join(dir, "bad.js");
      writeFileSync(script, `console.log(${JSON.stringify(JSON.stringify(bad))});`);
      const error = await fetchStartupContext(dir, "/some/repo", { command: process.execPath, args: [script] }).catch((e) => e);
      expect(error).toBeInstanceOf(StartupContextUnavailableError);
      expect(error.reason).toBe("invalid-json");
    }
  });
});
