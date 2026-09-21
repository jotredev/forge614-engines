import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { resolveEngramExecutable } from "../../modules/memory-protocol/constants";
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

/**
 * Fetches the memory protocol from Engram's public CLI. `home` locates the
 * canonical FORGE614_HOME/engram/bin/forge614-engram binary when `options` is
 * omitted; production callers always omit `options` and rely on that
 * resolution instead of PATH. `options` remains a test seam for pointing at a
 * fixture executable directly.
 */
export async function fetchMemoryProtocol(
  home: string,
  options?: MemoryProtocolFetchOptions,
): Promise<MemoryProtocolFetchResult> {
  const resolved = options ?? { command: resolveEngramExecutable(home), args: ["memory-protocol", "--json"] };
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(resolved.command, resolved.args));
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
