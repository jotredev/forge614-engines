#!/usr/bin/env bun
import { runDetect } from "./commands";

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  if (command === "detect") {
    await runDetect();
    return;
  }

  console.error(`Unknown command: ${process.argv.slice(2).join(" ")}`);
  process.exitCode = 1;
}

main();
