#!/usr/bin/env bun
import { runApply, runCapabilities, runDetect, runPlanMcpInstall, runPlanMcpRemove } from "./commands";
import { StalePlanError } from "../../app/apply-plan";
import { UnrecognizedEntryError } from "../../app/plan-mcp-remove";
import { PlanNotFoundError } from "../../infrastructure/plan-store";
import { ConfigConflictError } from "../../modules/config-writer/types";
import type { AgentId } from "../../modules/agents/types";

const SCHEMA_VERSION = 1;

class UnknownCommandError extends Error {
  constructor(command: string) {
    super(`Unknown command: ${command}`);
  }
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * `--args` is variadic: it consumes every following token up to (but not
 * including) the next `--flag`, so later CLI flags are never swallowed as
 * arguments to the MCP server being planned.
 */
export function collectArgsUntilNextFlag(tokens: string[]): string[] {
  const collected: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("--")) break;
    collected.push(token);
  }
  return collected;
}

function mcpArgsFlag(args: string[]): string[] {
  const index = args.indexOf("--args");
  return index === -1 ? [] : collectArgsUntilNextFlag(args.slice(index + 1));
}

export function errorCodeFor(error: unknown): string {
  if (error instanceof ConfigConflictError) return "CONFLICT";
  if (error instanceof StalePlanError) return "STALE_PLAN";
  if (error instanceof UnrecognizedEntryError) return "UNRECOGNIZED_ENTRY";
  if (error instanceof PlanNotFoundError) return "PLAN_NOT_FOUND";
  if (error instanceof UnknownCommandError) return "UNKNOWN_COMMAND";
  if (error instanceof Error && error.message.startsWith("Unknown agent:")) return "UNKNOWN_AGENT";
  return "INTERNAL_ERROR";
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (command === "detect") return runDetect();

  if (command === "plan" && subcommand === "mcp-install") {
    const agentId = flag(rest, "--agent") as AgentId;
    const name = flag(rest, "--name")!;
    const cmd = flag(rest, "--command")!;
    return runPlanMcpInstall(agentId, name, cmd, mcpArgsFlag(rest));
  }

  if (command === "plan" && subcommand === "mcp-remove") {
    const agentId = flag(rest, "--agent") as AgentId;
    const name = flag(rest, "--name")!;
    const cmd = flag(rest, "--command")!;
    return runPlanMcpRemove(agentId, name, cmd, mcpArgsFlag(rest));
  }

  if (command === "apply") {
    return runApply(flag(process.argv.slice(3), "--plan-id")!);
  }

  if (command === "capabilities") {
    return runCapabilities(flag(process.argv.slice(3), "--agent") as AgentId);
  }

  throw new UnknownCommandError(process.argv.slice(2).join(" "));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, error: { code: errorCodeFor(error), message } }, null, 2),
  );
  process.exitCode = 1;
});
