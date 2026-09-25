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

export interface StartupContextNotice {
  code: string;
  message: string;
  backup?: string;
}

export type StartupContextEcosystem =
  | { status: "member"; group: { id?: string; name: string }; context: unknown }
  | { status: "none" };

export interface StartupContextResult {
  format: 1;
  shared: unknown;
  /** Absent for an Engram that predates the ecosystem scope (< 1.6.0), or when its block is not understood. */
  ecosystem?: StartupContextEcosystem;
  project: {
    status: "bound" | "unbound";
    projectId: string | null;
    context: unknown;
    source?: "file" | "path" | "unbound";
    notices?: StartupContextNotice[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// R31 (acta 0024): this reads ANOTHER node's output, so it is strict only about the fields
// this node uses and ignores everything else (unknown root/block fields pass through untouched).
function readEcosystem(value: unknown): StartupContextEcosystem | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === "none") return { status: "none" };
  if (value.status !== "member" || !isRecord(value.group) || typeof value.group.name !== "string") return undefined;
  if (!isRecord(value.context)) return undefined;
  const id = typeof value.group.id === "string" ? value.group.id : undefined;
  return { status: "member", group: { ...(id ? { id } : {}), name: value.group.name }, context: value.context };
}

function readNotices(value: unknown): StartupContextNotice[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const notices = value.flatMap((n): StartupContextNotice[] =>
    isRecord(n) && typeof n.code === "string" && typeof n.message === "string"
      ? [{ code: n.code, message: n.message, ...(typeof n.backup === "string" ? { backup: n.backup } : {}) }]
      : [],
  );
  return notices.length > 0 ? notices : undefined;
}

function readStartupContext(value: unknown): StartupContextResult | undefined {
  if (!isRecord(value) || value.format !== 1 || !("shared" in value) || !isRecord(value.project)) return undefined;
  const project = value.project;
  if (project.status !== "bound" && project.status !== "unbound") return undefined;
  const source = project.source === "file" || project.source === "path" || project.source === "unbound" ? project.source : undefined;
  const notices = readNotices(project.notices);
  const ecosystem = readEcosystem(value.ecosystem);
  return {
    format: 1,
    shared: value.shared,
    ...(ecosystem ? { ecosystem } : {}),
    project: {
      status: project.status,
      projectId: typeof project.projectId === "string" ? project.projectId : null,
      context: project.context ?? null,
      ...(source ? { source } : {}),
      ...(notices ? { notices } : {}),
    },
  };
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

  const result = readStartupContext(parsed);
  if (!result) throw new StartupContextUnavailableError("invalid-json");
  return result;
}

/** Format 2: one ready-to-inject text block Engram already rendered — see forge614-engram's own StartupBlock. */
export interface StartupContextResultV2 {
  format: 2;
  text: string;
  chars: number;
  sections: { essentials: number; previous: number; index: number };
  omitted: number;
}

export type StartupBlockFetchResult =
  | { format: 2; block: StartupContextResultV2 }
  | {
      format: 1;
      result: StartupContextResult;
      /** Always present on this branch: this shape only exists because Engram rejected --format 2 with INVALID_INPUT. */
      legacyStartupNotice: string;
    };

export const LEGACY_STARTUP_NOTICE =
  "Engram sirvió el contexto de arranque en formato 1 porque esta versión no admite --format 2 (INVALID_INPUT); actualiza Engram a 1.7.0 o posterior para el arranque nuevo.\n" +
  "Engram served the startup context in format 1 because this version does not support --format 2 (INVALID_INPUT); upgrade Engram to 1.7.0 or later for the new startup.";

function readStartupContextV2(value: unknown): StartupContextResultV2 | undefined {
  if (!isRecord(value) || value.format !== 2) return undefined;
  if (typeof value.text !== "string" || value.text.length === 0) return undefined;
  if (typeof value.chars !== "number") return undefined;
  const sections = value.sections;
  if (
    !isRecord(sections) ||
    typeof sections.essentials !== "number" ||
    typeof sections.previous !== "number" ||
    typeof sections.index !== "number"
  ) {
    return undefined;
  }
  if (typeof value.omitted !== "number") return undefined;
  return {
    format: 2,
    text: value.text,
    chars: value.chars,
    sections: { essentials: sections.essentials, previous: sections.previous, index: sections.index },
    omitted: value.omitted,
  };
}

/**
 * True only when the failed call's stderr is Engram's own `{code:"INVALID_INPUT",...}`
 * error envelope. Mirrors memory-protocol-client.ts's isInvalidInputFailure exactly —
 * duplicated rather than shared, since each infrastructure client stays self-contained.
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

function classifyExecError(error: unknown): StartupContextFailureReason {
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
 * Fetches the startup block, preferring format 2 (Engram 1.7.0+: one
 * ready-to-inject text block Engines relays verbatim — see run-memory-hook.ts).
 * Only when that specific call fails with Engram's own INVALID_INPUT error — the
 * signature of an Engram older than 1.7.0, which does not recognize the flag —
 * does it fall back to `fetchStartupContext`'s existing format-1 call, exactly
 * as Engines used before format 2 existed. Any other failure is reported as-is,
 * with no retry: it is not evidence of an old Engram, only of Engram being
 * unavailable, and propagates the same way fetchStartupContext's own errors do.
 */
export async function fetchStartupBlock(
  home: string,
  directory: string,
  options?: StartupContextFetchOptions,
): Promise<StartupBlockFetchResult> {
  const resolved = options ?? { command: resolveEngramExecutable(home), args: ["startup-context", "--directory", directory, "--json"] };
  const v2Args = [...resolved.args, "--format", "2"];

  const v2Attempt = await attempt(resolved.command, v2Args);
  if (!("error" in v2Attempt)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(v2Attempt.stdout);
    } catch {
      throw new StartupContextUnavailableError("invalid-json");
    }
    const block = readStartupContextV2(parsed);
    if (!block) throw new StartupContextUnavailableError("invalid-json");
    return { format: 2, block };
  }

  if (!isInvalidInputFailure(v2Attempt.error)) throw new StartupContextUnavailableError(classifyExecError(v2Attempt.error));

  const result = await fetchStartupContext(home, directory, options);
  return { format: 1, result, legacyStartupNotice: LEGACY_STARTUP_NOTICE };
}
