import { applyPlan, type ApplyResult } from "./apply-plan";
import { loadPlan } from "../infrastructure/plan-store";

export class NotRepairableError extends Error {
  constructor(planId: string) {
    super(`Plan "${planId}" is not a forge614-engram MCP repair plan`);
  }
}

export interface McpRepairApplyResult extends ApplyResult {
  confirmed: boolean;
}

export async function applyMcpRepair(home: string, planId: string, confirmed: boolean): Promise<McpRepairApplyResult> {
  const plan = await loadPlan(home, planId);
  if (plan.action !== "mcp-repair" || !plan.repair) throw new NotRepairableError(planId);

  if (!confirmed) {
    return { planId, applied: false, changedFiles: [], confirmed: false };
  }

  const result = await applyPlan(home, planId);
  return { ...result, confirmed: true };
}
