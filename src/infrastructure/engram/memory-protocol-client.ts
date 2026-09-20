import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { isMemoryProtocol, type MemoryProtocol } from "../../modules/memory-protocol/types";

const execFileAsync = promisify(execFile);

export type EngramProtocolFailureReason = "not-installed" | "command-failed" | "invalid-json" | "invalid-schema";

export class EngramProtocolUnavailableError extends Error {
  readonly reason: EngramProtocolFailureReason;
  constructor(reason: EngramProtocolFailureReason) {
    super(`forge614-engram memory-protocol --json is unavailable: ${reason}`);
    this.reason = reason;
  }
}

export interface MemoryProtocolFetchOptions {
  command: string;
  args: string[];
}

export interface MemoryProtocolFetchResult {
  protocol: MemoryProtocol;
  fingerprint: string;
}

const DEFAULT_OPTIONS: MemoryProtocolFetchOptions = { command: "forge614-engram", args: ["memory-protocol", "--json"] };

export async function fetchMemoryProtocol(
  options: MemoryProtocolFetchOptions = DEFAULT_OPTIONS,
): Promise<MemoryProtocolFetchResult> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(options.command, options.args));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new EngramProtocolUnavailableError(code === "ENOENT" ? "not-installed" : "command-failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new EngramProtocolUnavailableError("invalid-json");
  }

  if (!isMemoryProtocol(parsed)) throw new EngramProtocolUnavailableError("invalid-schema");

  return { protocol: parsed, fingerprint: createHash("sha256").update(stdout).digest("hex") };
}
