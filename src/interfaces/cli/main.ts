#!/usr/bin/env bun
import { runDetect, runPlanMcpInstall } from "./commands";
import type { AgentId } from "../../modules/agents/types";

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (command === "detect") return runDetect();

  if (command === "plan" && subcommand === "mcp-install") {
    const agentId = flag(rest, "--agent") as AgentId;
    const name = flag(rest, "--name")!;
    const cmd = flag(rest, "--command")!;
    const argsIndex = rest.indexOf("--args");
    const args = argsIndex === -1 ? [] : rest.slice(argsIndex + 1);
    return runPlanMcpInstall(agentId, name, cmd, args);
  }

  console.error(`Unknown command: ${process.argv.slice(2).join(" ")}`);
  process.exitCode = 1;
}

main();
