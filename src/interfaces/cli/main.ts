#!/usr/bin/env bun
import {
  runAgentsList,
  runApply,
  runCapabilities,
  runDetect,
  runHeadlessCommand,
  runPlanMcpInstall,
  runPlanMcpRemove,
  runPlanMemoryInstall,
  runPlanMemoryRemove,
  runUpdate,
  runVerifyMemoryIntegration,
} from "./commands";
import { EngramProtocolUnavailableError } from "../../infrastructure/engram/memory-protocol-client";
import { StalePlanError } from "../../app/apply-plan";
import { HeadlessUnsupportedError } from "../../app/headless-command";
import { UnrecognizedEntryError } from "../../app/plan-mcp-remove";
import { UpdateAssetMissingError } from "../../app/self-update";
import { PlanNotFoundError } from "../../infrastructure/plan-store";
import { ConfigConflictError } from "../../modules/config-writer/types";
import type { AgentId, ReasoningLevel } from "../../modules/agents/types";
import { ReasoningLevelUnsupportedError } from "../../modules/agents/types";

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
  if (error instanceof EngramProtocolUnavailableError) return "ENGRAM_PROTOCOL_UNAVAILABLE";
  if (error instanceof StalePlanError) return "STALE_PLAN";
  if (error instanceof UnrecognizedEntryError) return "UNRECOGNIZED_ENTRY";
  if (error instanceof PlanNotFoundError) return "PLAN_NOT_FOUND";
  if (error instanceof UpdateAssetMissingError) return "UPDATE_ASSET_MISSING";
  if (error instanceof HeadlessUnsupportedError) return "HEADLESS_UNSUPPORTED";
  if (error instanceof ReasoningLevelUnsupportedError) return "REASONING_LEVEL_UNSUPPORTED";
  if (error instanceof UnknownCommandError) return "UNKNOWN_COMMAND";
  if (error instanceof Error && error.message.startsWith("Unknown agent:")) return "UNKNOWN_AGENT";
  return "INTERNAL_ERROR";
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (command === "detect") return runDetect();

  if (command === "agents" && subcommand === "list") return runAgentsList();

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

  if (command === "plan" && subcommand === "memory-install") {
    const agentId = flag(rest, "--agent") as AgentId;
    return runPlanMemoryInstall(agentId);
  }

  if (command === "plan" && subcommand === "memory-remove") {
    const agentId = flag(rest, "--agent") as AgentId;
    return runPlanMemoryRemove(agentId);
  }

  if (command === "apply") {
    return runApply(flag(process.argv.slice(3), "--plan-id")!);
  }

  if (command === "capabilities") {
    return runCapabilities(flag(process.argv.slice(3), "--agent") as AgentId);
  }

  if (command === "update") {
    return runUpdate();
  }

  if (command === "verify" && subcommand === "memory-integration") {
    const agentId = flag(rest, "--agent") as AgentId;
    return runVerifyMemoryIntegration(agentId);
  }

  if (command === "headless") {
    const headlessArgs = process.argv.slice(3);
    const agentId = flag(headlessArgs, "--agent") as AgentId;
    const executable = flag(headlessArgs, "--executable")!;
    const prompt = flag(headlessArgs, "--prompt")!;
    const timeoutMsRaw = flag(headlessArgs, "--timeout-ms");
    const timeoutMs = timeoutMsRaw === undefined ? undefined : Number(timeoutMsRaw);
    const model = flag(headlessArgs, "--model");
    const reasoningLevel = flag(headlessArgs, "--reasoning-level") as ReasoningLevel | undefined;
    return runHeadlessCommand(agentId, executable, prompt, timeoutMs, model, reasoningLevel);
  }

  throw new UnknownCommandError(process.argv.slice(2).join(" "));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, error: { code: errorCodeFor(error), message } }, null, 2),
    );
    process.exitCode = 1;
  })
  .then(() => {
    // `update` spawns a detached helper process on Windows (see
    // scheduleWindowsSwap in self-update.ts) and .unref()s it so it doesn't
    // keep this process alive — but explicitly exit anyway rather than
    // trust the event loop to drain on its own: a real Windows CI run
    // showed this process hang for several minutes after printing its
    // result, which an unref()'d handle should never do. Whether that's a
    // Bun-on-Windows quirk or something else, forcing the exit here is
    // strictly correct regardless — nothing meaningful happens after this
    // point on any command or platform.
    process.exit(process.exitCode ?? 0);
  });
