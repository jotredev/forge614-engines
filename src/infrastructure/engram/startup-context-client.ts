import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveEngramExecutable } from "../../modules/memory-protocol/constants";

const execFileAsync = promisify(execFile);

export type StartupContextFailureReason = "not-installed" | "command-failed" | "invalid-json";

export class StartupContextUnavailableError extends Error {
  readonly reason: StartupContextFailureReason;
  constructor(reason: StartupContextFailureReason) {
    super(`forge614-engram startup-context --json is unavailable: ${reason}`);
    this.reason = reason;
  }
}

export interface StartupContextFetchOptions {
  command: string;
  args: string[];
}

export interface StartupContextResult {
  format: 1;
  shared: unknown;
  project: { status: "bound" | "unbound"; projectId: string | null; context: unknown };
}

function isStartupContextResult(value: unknown): value is StartupContextResult {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).format === 1 &&
    "shared" in (value as object) &&
    "project" in (value as object)
  );
}

/**
 * Calls Engram's public, read-only `startup-context` CLI, resolved under
 * FORGE614_HOME/engram/bin — never PATH. `directory` must be the real session cwd
 * from the hook's own stdin. `home` locates the canonical binary when `options` is
 * omitted; `options` is a test seam for a fixture executable.
 */
export async function fetchStartupContext(
  home: string,
  directory: string,
  options?: StartupContextFetchOptions,
): Promise<StartupContextResult> {
  const resolved = options ?? { command: resolveEngramExecutable(home), args: ["startup-context", "--directory", directory, "--json"] };
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(resolved.command, resolved.args));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new StartupContextUnavailableError(code === "ENOENT" ? "not-installed" : "command-failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new StartupContextUnavailableError("invalid-json");
  }

  if (!isStartupContextResult(parsed)) throw new StartupContextUnavailableError("invalid-json");
  return parsed;
}
