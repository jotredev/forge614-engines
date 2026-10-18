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
  runUninstall,
  uninstallDependents,
  runUninstallSelfCli,
  runVerifyMcpRepair,
  runVerifyMemoryIntegration,
} from "./commands";
import { EngramProtocolUnavailableError } from "../../infrastructure/engram/memory-protocol-client";
import { ConfirmationRequiredError, NotRepairableError } from "../../app/apply-mcp-repair";
import { StalePlanError } from "../../app/apply-plan";
import { HeadlessUnsupportedError } from "../../app/headless-command";
import { UnrecognizedEntryError } from "../../app/plan-mcp-remove";
import { UpdateAssetMissingError } from "../../app/self-update";
import { InstallerActionError } from "../../app/installer-actions";
import { PlanNotFoundError } from "../../infrastructure/plan-store";
import { ConfigConflictError } from "../../modules/config-writer/types";
import type { AgentId, ReasoningLevel } from "../../modules/agents/types";
import {
  InvalidReasoningLevelError,
  ReadOnlyUnsupportedError,
  ReasoningLevelUnsupportedError,
} from "../../modules/agents/types";
import pkg from "../../../package.json";
import { HELP } from "./help";
import { createInterface } from "node:readline/promises";

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
  if (error instanceof InstallerActionError) {
    if (error.code === "DEPENDENT_NODES_INSTALLED") return "DEPENDENT_NODES_INSTALLED";
    if (error.code === "UNINSTALL_FROM_INSTALLATION") return "UNINSTALL_FROM_INSTALLATION";
    if (error.code === "INVALID_FORGE614_HOME") return "INVALID_FORGE614_HOME";
    if (error.code === "INVALID_VERSION") return "INVALID_VERSION";
    if (error.code === "UPDATE_FAILED") return "UPDATE_FAILED";
    if (error.code === "UNINSTALL_FAILED") return "UNINSTALL_FAILED";
    return "INTERNAL_ERROR";
  }
  if (error instanceof ConfigConflictError) return "CONFLICT";
  if (error instanceof EngramProtocolUnavailableError) return "ENGRAM_PROTOCOL_UNAVAILABLE";
  if (error instanceof NotRepairableError) return "NOT_REPAIRABLE";
  if (error instanceof ConfirmationRequiredError) return "CONFIRMATION_REQUIRED";
  if (error instanceof StalePlanError) return "STALE_PLAN";
  if (error instanceof UnrecognizedEntryError) return "UNRECOGNIZED_ENTRY";
  if (error instanceof PlanNotFoundError) return "PLAN_NOT_FOUND";
  if (error instanceof UpdateAssetMissingError) return "UPDATE_ASSET_MISSING";
  if (error instanceof HeadlessUnsupportedError) return "HEADLESS_UNSUPPORTED";
  if (error instanceof ReadOnlyUnsupportedError) return "READ_ONLY_UNSUPPORTED";
  if (error instanceof ReasoningLevelUnsupportedError) return "REASONING_LEVEL_UNSUPPORTED";
  if (error instanceof InvalidReasoningLevelError) return "INVALID_REASONING_LEVEL";
  if (error instanceof UnknownCommandError) return "UNKNOWN_COMMAND";
  if (error instanceof Error && error.message.startsWith("Unknown agent:")) return "UNKNOWN_AGENT";
  return "INTERNAL_ERROR";
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  // Plain text, before anything that touches the disk: every Forge614 node answers --version
  // (`forge614-engines <version>`, like `forge614-engram 1.8.5`), and asking must never create or
  // read anything under the home folder.
  if (command === "--version" || command === "-v") {
    if (boolFlag(process.argv.slice(2), "--json")) {
      console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, name: "forge614-engines", version: pkg.version }));
      return;
    }
    console.log(`forge614-engines ${pkg.version}`);
    return;
  }
  if (command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

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
    return runUpdate(flag(process.argv.slice(3), "--version"));
  }

  if (command === "uninstall") {
    const args = process.argv.slice(3);
    const json = boolFlag(args, "--json");
    if (boolFlag(args, "--self")) return runUninstallSelfCli(json);
    const force = boolFlag(args, "--force");
    if (!force) {
      const dependents = uninstallDependents();
      if (dependents.length) throw new InstallerActionError("DEPENDENT_NODES_INSTALLED", `No se puede retirar Engines mientras estén instalados: ${dependents.join(", ")}. Usa --force para continuar.`);
    }
    if (!json && process.stdin.isTTY && process.stdout.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await prompt.question("Se retirarán Engines, sus datos en FORGE614_HOME/engines y las integraciones administradas que existan en Claude Code y Codex. ¿Continuar? [s/N] ");
        if (!/^(s|si|sí|y|yes)$/i.test(answer.trim())) { process.exitCode = 130; return; }
      } finally { prompt.close(); }
    }
    return runUninstall(force, json);
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
    // The cast only types the raw text: headlessCommandFor() is what validates it against the agent's levels.
    const reasoningLevel = flag(headlessArgs, "--reasoning-level") as ReasoningLevel | undefined;
    const stdinPrompt = boolFlag(headlessArgs, "--stdin-prompt");
    const readableDir = flag(headlessArgs, "--readable-dir");
    const readOnly = boolFlag(headlessArgs, "--read-only");
    return runHeadlessCommand(
      agentId,
      executable,
      prompt,
      timeoutMs,
      model,
      reasoningLevel,
      stdinPrompt,
      readableDir,
      readOnly,
    );
  }

  throw new UnknownCommandError(process.argv.slice(2).join(" "));
}

if (import.meta.main) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof InstallerActionError) {
        process.stderr.write(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, code: error.code, error: message })}\n`);
        process.exitCode = 1;
        return;
      }
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
