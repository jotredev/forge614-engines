#!/usr/bin/env bun
import {
  runAgentsList,
  runApply,
  runApplyMcpRepair,
  runCapabilities,
  runDetect,
  runHeadlessCommand,
  runMemoryHookRun,
  runPlanMcpInstall,
  runPlanMcpRemove,
  runPlanMcpRepair,
  runPlanMemoryInstall,
  runPlanMemoryRemove,
  runUpdate,
  runVerifyMcpRepair,
  runVerifyMemoryIntegration,
} from "./commands";
import { EngramProtocolUnavailableError } from "../../infrastructure/engram/memory-protocol-client";
import { ConfirmationRequiredError, NotRepairableError } from "../../app/apply-mcp-repair";
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

function boolFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
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
  if (error instanceof NotRepairableError) return "NOT_REPAIRABLE";
  if (error instanceof ConfirmationRequiredError) return "CONFIRMATION_REQUIRED";
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

  if (command === "memory-hook-run") {
    // Bypasses the generic JSON-error envelope below on purpose: this command's
    // only contract is the host's own SessionStart hook contract (plain stdout
    // for Claude Code, structured additionalContext JSON for Codex), and it must
    // always exit 0 so a failure here never looks like it could block a session.
    const hookArgs = process.argv.slice(3);
    const agentId = (flag(hookArgs, "--agent") ?? "claude-code") as AgentId;
    const stdin = await readStdin();
    const output = await runMemoryHookRun(agentId, stdin).catch(
      () => `[Forge614 Engram] Memoria no disponible (motivo: internal-error). La sesión continúa sin contexto precargado.`,
    );
    console.log(output);
    return;
  }

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

  if (command === "plan" && subcommand === "mcp-repair") {
    const agentId = flag(rest, "--agent") as AgentId;
    return runPlanMcpRepair(agentId);
  }

  if (command === "apply" && subcommand === "mcp-repair") {
    const planId = flag(rest, "--plan-id")!;
    const confirmed = boolFlag(rest, "--confirm");
    return runApplyMcpRepair(planId, confirmed);
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

  if (command === "verify" && subcommand === "mcp-repair") {
    const agentId = flag(rest, "--agent") as AgentId;
    const planId = flag(rest, "--plan-id")!;
    return runVerifyMcpRepair(agentId, planId);
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
    const stdinPrompt = boolFlag(headlessArgs, "--stdin-prompt");
    const readableDir = flag(headlessArgs, "--readable-dir");
    return runHeadlessCommand(agentId, executable, prompt, timeoutMs, model, reasoningLevel, stdinPrompt, readableDir);
  }

  throw new UnknownCommandError(process.argv.slice(2).join(" "));
}

if (import.meta.main) {
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
}
