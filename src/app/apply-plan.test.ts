import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { savePlan } from "../infrastructure/plan-store";
import type { Plan } from "../modules/config-writer/types";
import { applyPlan, StalePlanError } from "./apply-plan";

let home: string;
let configPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-apply-"));
  configPath = join(home, "config.json");
  writeFileSync(configPath, '{"other":true}');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("applyPlan", () => {
  test("writes the planned content and reports the changed file", async () => {
    const plan: Plan = {
      planId: "plan-1",
      agentId: "claude-code",
      action: "mcp-install",
      noop: false,
      writes: [{ path: configPath, beforeHash: hashOf('{"other":true}'), afterContent: '{"other":true,"new":true}' }],
    };
    await savePlan(home, plan);

    const result = await applyPlan(home, "plan-1");

    expect(result.changedFiles).toEqual([configPath]);
    expect(readFileSync(configPath, "utf8")).toBe('{"other":true,"new":true}');
  });

  test("does nothing for a noop plan", async () => {
    const plan: Plan = { planId: "plan-2", agentId: "claude-code", action: "mcp-install", noop: true, writes: [] };
    await savePlan(home, plan);

    const result = await applyPlan(home, "plan-2");

    expect(result.changedFiles).toEqual([]);
  });

  test("refuses to apply when the file changed since the plan was computed", async () => {
    const plan: Plan = {
      planId: "plan-3",
      agentId: "claude-code",
      action: "mcp-install",
      noop: false,
      writes: [{ path: configPath, beforeHash: hashOf('{"stale":true}'), afterContent: '{"new":true}' }],
    };
    await savePlan(home, plan);

    await expect(applyPlan(home, "plan-3")).rejects.toThrow(StalePlanError);
    expect(readFileSync(configPath, "utf8")).toBe('{"other":true}');
  });

  test("deletes a file when the write is marked delete", async () => {
    const deletedPath = join(home, "to-delete.md");
    writeFileSync(deletedPath, "old content");
    const plan: Plan = {
      planId: "plan-delete-1",
      agentId: "claude-code",
      action: "mcp-remove",
      noop: false,
      writes: [{ path: deletedPath, beforeHash: hashOf("old content"), afterContent: "", delete: true }],
    };
    await savePlan(home, plan);

    const result = await applyPlan(home, "plan-delete-1");

    expect(result.changedFiles).toEqual([deletedPath]);
    expect(existsSync(deletedPath)).toBe(false);
  });

  test("refuses to delete when the file changed since the plan was computed", async () => {
    const deletedPath = join(home, "stale-delete.md");
    writeFileSync(deletedPath, "changed content");
    const plan: Plan = {
      planId: "plan-delete-2",
      agentId: "claude-code",
      action: "mcp-remove",
      noop: false,
      writes: [{ path: deletedPath, beforeHash: hashOf("original content"), afterContent: "", delete: true }],
    };
    await savePlan(home, plan);

    await expect(applyPlan(home, "plan-delete-2")).rejects.toThrow(StalePlanError);
    expect(existsSync(deletedPath)).toBe(true);
  });
});
