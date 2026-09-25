import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { resolveEngramExecutable } from "../../modules/memory-protocol/constants";
import { isMemoryProtocol, isMemoryProtocolV4, type AnyMemoryProtocol } from "../../modules/memory-protocol/types";

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
  protocol: AnyMemoryProtocol;
  fingerprint: string;
  /**
   * Present only when Engram rejected `--protocol-version 4` with INVALID_INPUT
   * (an Engram older than 1.7.0) and Engines fell back to the plain v1 call it
   * always used before. Bilingual (Spanish, then English), like this notice's
   * counterpart on the startup-context side — see LEGACY_PROTOCOL_NOTICE.
   */
  legacyProtocolNotice?: string;
}

export const LEGACY_PROTOCOL_NOTICE =
  "Engram respondió con el protocolo v1 porque esta versión no admite --protocol-version 4 (INVALID_INPUT); actualiza Engram a 1.7.0 o posterior para instalar el manual nuevo.\n" +
  "Engram replied with protocol v1 because this version does not support --protocol-version 4 (INVALID_INPUT); upgrade Engram to 1.7.0 or later to install the new manual.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True only when the failed call's stderr is Engram's own `{code:"INVALID_INPUT",...}`
 * error envelope (main.ts of forge614-engram writes exactly that JSON to stderr and
 * sets a non-zero exit code). Never inspects stdout, and never lets stderr content
 * leak into a thrown error — only this boolean escapes this function.
 */
function isInvalidInputFailure(error: unknown): boolean {
  const stderr = isRecord(error) && typeof error.stderr === "string" ? error.stderr : "";
  if (!stderr) return false;
  try {
    const parsed: unknown = JSON.parse(stderr);
    return isRecord(parsed) && parsed.code === "INVALID_INPUT";
  } catch {
    return false;
  }
}

function classifyExecError(error: unknown): EngramProtocolFailureReason {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" ? "not-installed" : "command-failed";
}

type ExecAttempt = { stdout: string } | { error: unknown };

async function attempt(command: string, args: string[]): Promise<ExecAttempt> {
  try {
    const { stdout } = await execFileAsync(command, args);
    return { stdout };
  } catch (error) {
    return { error };
  }
}

/**
 * Fetches the memory protocol from Engram's public CLI. `home` locates the
 * canonical FORGE614_HOME/engram/bin/forge614-engram binary when `options` is
 * omitted; production callers always omit `options` and rely on that
 * resolution instead of PATH. `options` remains a test seam for pointing at a
 * fixture executable directly.
 *
 * Always tries `--protocol-version 4` first (Engram 1.7.0+). Only when that
 * specific call fails with Engram's own INVALID_INPUT error — the signature of
 * an Engram older than 1.7.0, which does not recognize the flag — does it
 * retry with the plain call Engines always used before. Any other failure
 * (Engram missing, a crash, a different error code) is reported as-is, with no
 * retry: it is not evidence of an old Engram, only of Engram being unavailable.
 */
export async function fetchMemoryProtocol(
  home: string,
  options?: MemoryProtocolFetchOptions,
): Promise<MemoryProtocolFetchResult> {
  const resolved = options ?? { command: resolveEngramExecutable(home), args: ["memory-protocol", "--json"] };
  const v4Args = [...resolved.args, "--protocol-version", "4"];

  const v4Attempt = await attempt(resolved.command, v4Args);
  if (!("error" in v4Attempt)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(v4Attempt.stdout);
    } catch {
      throw new EngramProtocolUnavailableError("invalid-json");
    }
    if (!isMemoryProtocolV4(parsed)) throw new EngramProtocolUnavailableError("invalid-schema");
    return { protocol: parsed, fingerprint: createHash("sha256").update(v4Attempt.stdout).digest("hex") };
  }

  if (!isInvalidInputFailure(v4Attempt.error)) throw new EngramProtocolUnavailableError(classifyExecError(v4Attempt.error));

  const v1Attempt = await attempt(resolved.command, resolved.args);
  if ("error" in v1Attempt) throw new EngramProtocolUnavailableError(classifyExecError(v1Attempt.error));

  let parsed: unknown;
  try {
    parsed = JSON.parse(v1Attempt.stdout);
  } catch {
    throw new EngramProtocolUnavailableError("invalid-json");
  }
  if (!isMemoryProtocol(parsed)) throw new EngramProtocolUnavailableError("invalid-schema");

  return {
    protocol: parsed,
    fingerprint: createHash("sha256").update(v1Attempt.stdout).digest("hex"),
    legacyProtocolNotice: LEGACY_PROTOCOL_NOTICE,
  };
}
