import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plan } from "../modules/config-writer/types";

export function plansDirectory(home: string): string {
  return join(home, ".forge614", "engines", "plans");
}

export function newPlanId(): string {
  return randomUUID();
}

export async function savePlan(home: string, plan: Plan): Promise<void> {
  const dir = plansDirectory(home);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${plan.planId}.json`), JSON.stringify(plan, null, 2), "utf8");
}

export async function loadPlan(home: string, planId: string): Promise<Plan> {
  const raw = await readFile(join(plansDirectory(home), `${planId}.json`), "utf8");
  return JSON.parse(raw) as Plan;
}
