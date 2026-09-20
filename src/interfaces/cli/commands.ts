import { homedir } from "node:os";
import { buildDefaultRegistry } from "../../app/default-registry";
import { detectAgents } from "../../app/detect";

const SCHEMA_VERSION = 1;

export function printJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...payload }, null, 2));
}

export async function runDetect(): Promise<void> {
  const registry = buildDefaultRegistry();
  const agents = await detectAgents(registry, homedir(), process.env, process.platform);
  printJson({ agents });
}
