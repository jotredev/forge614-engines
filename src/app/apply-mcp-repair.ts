import { applyPlan, type ApplyResult } from "./apply-plan";
import { loadPlan } from "../infrastructure/plan-store";
import type { McpRepairStatus } from "../modules/config-writer/types";

export class NotRepairableError extends Error {
  constructor(planId: string) {
    super(`Plan "${planId}" is not a forge614-engram MCP repair plan`);
  }
}

export class ConfirmationRequiredError extends Error {
  constructor(planId: string) {
    super(
      `Plan "${planId}" is a forge614-engram MCP repair plan and cannot be applied through the generic "apply" command — use "apply mcp-repair --plan-id ${planId} --confirm" instead`,
    );
  }
}

export interface McpRepairApplyResult extends ApplyResult {
  confirmed: boolean;
  status: McpRepairStatus;
}

export async function applyMcpRepair(home: string, planId: string, confirmed: boolean): Promise<McpRepairApplyResult> {
  const plan = await loadPlan(home, planId);
  if (plan.action !== "mcp-repair" || !plan.repair) throw new NotRepairableError(planId);

  if (!confirmed) {
    return { planId, applied: false, changedFiles: [], confirmed: false, status: plan.repair.status };
  }

  const result = await applyPlan(home, planId);
  return { ...result, confirmed: true, status: plan.repair.status };
}
