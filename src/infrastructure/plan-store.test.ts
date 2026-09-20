import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, newPlanId, savePlan } from "./plan-store";
import type { Plan } from "../modules/config-writer/types";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planstore-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("plan-store", () => {
  test("saves and loads a plan by id", async () => {
    const plan: Plan = { planId: newPlanId(), agentId: "claude-code", action: "mcp-install", noop: false, writes: [] };
    await savePlan(home, plan);
    const loaded = await loadPlan(home, plan.planId);
    expect(loaded).toEqual(plan);
  });

  test("newPlanId returns distinct ids", () => {
    expect(newPlanId()).not.toBe(newPlanId());
  });
});
