import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plan } from "../modules/config-writer/types";

export class PlanNotFoundError extends Error {
  constructor(planId: string) {
    super(`No plan found with id "${planId}"`);
  }
}

export function plansDirectory(home: string): string {
  return join(home, ".forge614", "engines", "plans");
}

export function newPlanId(): string {
  return randomUUID();
}

export async function savePlan(home: string, plan: Plan): Promise<void> {
  const dir = plansDirectory(home);
  // Plans embed the full post-write content of config files, which can contain
  // OAuth tokens and API keys — keep them owner-only on disk.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, `${plan.planId}.json`), JSON.stringify(plan, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function loadPlan(home: string, planId: string): Promise<Plan> {
  let raw: string;
  try {
    raw = await readFile(join(plansDirectory(home), `${planId}.json`), "utf8");
  } catch {
    throw new PlanNotFoundError(planId);
  }
  return JSON.parse(raw) as Plan;
}
