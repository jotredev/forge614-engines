import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, newPlanId, plansDirectory, savePlan } from "./plan-store";
import type { Plan } from "../modules/config-writer/types";

let home: string;
let previousForgeHome: string | undefined;

beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  home = mkdtempSync(join(tmpdir(), "engines-planstore-"));
  process.env.FORGE614_HOME = join(home, "shared-forge-home");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME;
  else process.env.FORGE614_HOME = previousForgeHome;
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

  test("stores plans under FORGE614_HOME/engines", () => {
    expect(plansDirectory(home)).toBe(join(home, "shared-forge-home", "engines", "plans"));
  });
});
