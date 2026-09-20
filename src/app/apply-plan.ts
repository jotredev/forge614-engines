import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "../infrastructure/config-io/atomic-write";
import { createSnapshot } from "../infrastructure/snapshot/snapshot";
import { loadPlan } from "../infrastructure/plan-store";

export class StalePlanError extends Error {
  constructor(path: string) {
    super(`File changed since the plan was computed: ${path}`);
  }
}

export interface ApplyResult {
  planId: string;
  applied: boolean;
  changedFiles: string[];
}

export async function applyPlan(home: string, planId: string): Promise<ApplyResult> {
  const plan = await loadPlan(home, planId);

  if (plan.noop || plan.writes.length === 0) {
    return { planId, applied: true, changedFiles: [] };
  }

  for (const write of plan.writes) {
    let current: string;
    try {
      current = await readFile(write.path, "utf8");
    } catch {
      current = "";
    }
    const currentHash = createHash("sha256").update(current).digest("hex");
    if (currentHash !== write.beforeHash) throw new StalePlanError(write.path);
  }

  await createSnapshot(
    home,
    planId,
    plan.writes.map((w) => w.path),
  );

  const changedFiles: string[] = [];
  for (const write of plan.writes) {
    const result = await atomicWrite(write.path, write.afterContent);
    if (result.changed) changedFiles.push(write.path);
  }

  return { planId, applied: true, changedFiles };
}
