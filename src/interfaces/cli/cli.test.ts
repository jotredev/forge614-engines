import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConfirmationRequiredError, NotRepairableError } from "../../app/apply-mcp-repair";
import { resolveEngramExecutable } from "../../modules/memory-protocol/constants";
import { errorCodeFor } from "./main";

const ENTRY = "src/interfaces/cli/main.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-cli-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const PROTOCOL_JSON = JSON.stringify({
  id: "forge614-engram-memory",
  version: 1,
  instructions: "Call memory_context.",
  lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
  scopes: { shared: "s", project: "p" },
  security: { neverSave: ["passwords"] },
});

const STARTUP_CONTEXT_JSON = JSON.stringify({
  format: 1,
  shared: { pinned: [], recent: [], sessions: [], truncated: false },
  project: { status: "unbound", projectId: null, context: null },
});

/**
 * Installs a fake forge614-engram binary at the exact canonical path Engines
 * resolves under this test's HOME, so the real CLI (with no test seam available
 * to it) can run `plan memory-install`/`verify memory-integration` end to end.
 * Responds to both subcommands the CLI actually invokes: memory-protocol --json
 * (used by plan memory-install) and startup-context --json (used by the hook's
 * own dry run inside verify memory-integration).
 */
function installEngramFixture(testHome: string): void {
  const canonicalPath = resolveEngramExecutable(testHome);
  mkdirSync(dirname(canonicalPath), { recursive: true });
  writeFileSync(
    canonicalPath,
    [
      `#!${process.execPath}`,
      `const args = process.argv.slice(2);`,
      `if (args[0] === "memory-protocol") { console.log(${JSON.stringify(PROTOCOL_JSON)}); }`,
      `else if (args[0] === "startup-context") { console.log(${JSON.stringify(STARTUP_CONTEXT_JSON)}); }`,
      `else { process.exit(1); }`,
      "",
    ].join("\n"),
  );
  chmodSync(canonicalPath, 0o755);
}

/**
 * Environment for a spawned CLI whose home must be the temp `home`. os.homedir() reads HOME on
 * POSIX but USERPROFILE on Windows, so setting only HOME made the child resolve the runner's real
 * profile there (evidence written and .claude.json read from the wrong folder).
 */
function homeEnv(testHome: string, extra: Record<string, string> = {}): Record<string, string | undefined> {
  return { ...process.env, HOME: testHome, USERPROFILE: testHome, ...extra };
}

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: homeEnv(home),
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

describe("child-process environment", () => {
  test("points HOME and USERPROFILE at the temp home, so os.homedir() is the temp home on POSIX and on Windows alike", () => {
    const env = homeEnv(home);
    expect(env.HOME).toBe(home);
    expect(env.USERPROFILE).toBe(home);
  });
});

describe("forge614-engines CLI", () => {
  test("detect --json outputs a schemaVersion and an agents array", async () => {
    const { stdout, exitCode } = await runCli(["detect"]);

    const parsed = JSON.parse(stdout);
    expect(exitCode).toBe(0);
    expect(parsed.schemaVersion).toBe(1);
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents.some((a: { id: string }) => a.id === "claude-code")).toBe(true);
  });

  test("agents list reports every supported agent regardless of installation", async () => {
    const { stdout, exitCode } = await runCli(["agents", "list"]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.agents).toEqual([
      {
        id: "claude-code",
        label: "Claude Code",
        supportsMcp: true,
        supportsHooks: true,
        supportsHeadlessExec: true,
        supportsReasoningLevel: false,
      },
      {
        id: "codex",
        label: "Codex",
        supportsMcp: true,
        supportsHooks: true,
        supportsHeadlessExec: true,
        supportsReasoningLevel: true,
      },
      {
        id: "cursor",
        label: "Cursor",
        supportsMcp: true,
        supportsHooks: false,
        supportsHeadlessExec: false,
        supportsReasoningLevel: false,
      },
    ]);
  });

  test("--args stops at the next flag instead of swallowing it", async () => {
    const { stdout, exitCode } = await runCli([
      "plan",
      "mcp-install",
      "--agent",
      "claude-code",
      "--name",
      "t",
      "--command",
      "/bin/t",
      "--args",
      "mcp",
      "--json",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const written = JSON.parse(parsed.plan.writes[0].afterContent);
    expect(written.mcpServers.t).toEqual({ command: "/bin/t", args: ["mcp"] });
  });

  test("an unknown agent fails with the JSON error contract and exit code 1", async () => {
    const { stdout, exitCode } = await runCli(["capabilities", "--agent", "doesnotexist"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.error.code).toBe("UNKNOWN_AGENT");
    expect(parsed.error.message).toContain("doesnotexist");
  });

  test("applying a plan id that does not exist reports PLAN_NOT_FOUND", async () => {
    const { stdout, exitCode } = await runCli(["apply", "--plan-id", "doesnotexist"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.error.code).toBe("PLAN_NOT_FOUND");
  });

  test("headless outputs the adapter's headless command as JSON", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "claude-code",
      "--executable",
      "/bin/claude",
      "--prompt",
      "hello",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.headless).toEqual({ command: "/bin/claude", args: ["-p", "hello"] });
  });

  test("headless forwards --model to the adapter's args", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "claude-code",
      "--executable",
      "/bin/claude",
      "--prompt",
      "hello",
      "--model",
      "claude-haiku-4-5",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.headless).toEqual({ command: "/bin/claude", args: ["-p", "hello", "--model", "claude-haiku-4-5"] });
  });

  test("headless --stdin-prompt omits the prompt from args and marks stdin delivery", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "claude-code",
      "--executable",
      "/bin/claude",
      "--prompt",
      "hello",
      "--stdin-prompt",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.headless).toEqual({ command: "/bin/claude", args: ["-p"], stdin: true });
  });

  test("headless without --stdin-prompt keeps the prompt in args, unchanged", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "codex",
      "--executable",
      "/bin/codex",
      "--prompt",
      "hello",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.headless).toEqual({ command: "/bin/codex", args: ["exec", "hello"] });
  });

  test("headless forwards --reasoning-level as a codex config override", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "codex",
      "--executable",
      "/bin/codex",
      "--prompt",
      "hello",
      "--reasoning-level",
      "medium",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.headless).toEqual({
      command: "/bin/codex",
      args: ["exec", "-c", "model_reasoning_effort=medium", "hello"],
    });
  });

  test("headless --reasoning-level for claude-code reports REASONING_LEVEL_UNSUPPORTED", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "claude-code",
      "--executable",
      "/bin/claude",
      "--prompt",
      "hello",
      "--reasoning-level",
      "high",
    ]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error.code).toBe("REASONING_LEVEL_UNSUPPORTED");
  });

  test("headless forwards --readable-dir to claude-code's args, before -p", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "claude-code",
      "--executable",
      "/bin/claude",
      "--prompt",
      "hello",
      "--readable-dir",
      "/tmp/project",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.headless).toEqual({ command: "/bin/claude", args: ["--add-dir", "/tmp/project", "-p", "hello"] });
  });

  test("headless forwards --readable-dir to codex's args, before the prompt", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "codex",
      "--executable",
      "/bin/codex",
      "--prompt",
      "hello",
      "--readable-dir",
      "/tmp/project",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.headless).toEqual({ command: "/bin/codex", args: ["exec", "--add-dir", "/tmp/project", "hello"] });
  });

  test("headless for an agent without headless support reports HEADLESS_UNSUPPORTED", async () => {
    const { stdout, exitCode } = await runCli([
      "headless",
      "--agent",
      "cursor",
      "--executable",
      "/bin/cursor",
      "--prompt",
      "hello",
    ]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error.code).toBe("HEADLESS_UNSUPPORTED");
  });

  test("an unknown command reports UNKNOWN_COMMAND as JSON", async () => {
    const { stdout, exitCode } = await runCli(["nonsense"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
  });

  test("plan memory-install for an agent without Engram installed reports ENGRAM_PROTOCOL_UNAVAILABLE", async () => {
    // Deliberately does not use runCli: this case must be deterministic on a maintainer's machine
    // that *does* have forge614-engram installed, so PATH is scrubbed to an empty directory and the
    // runtime is invoked by absolute path (process.execPath needs no PATH lookup).
    const emptyPathDir = mkdtempSync(join(tmpdir(), "engines-emptypath-"));
    const proc = Bun.spawn([process.execPath, ENTRY, "plan", "memory-install", "--agent", "claude-code"], {
      stdout: "pipe",
      stderr: "pipe",
      env: homeEnv(home, { PATH: emptyPathDir }),
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    rmSync(emptyPathDir, { recursive: true, force: true });

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error.code).toBe("ENGRAM_PROTOCOL_UNAVAILABLE");
  });

  test("plan memory-remove is a noop when nothing was installed", async () => {
    const { stdout, exitCode } = await runCli(["plan", "memory-remove", "--agent", "cursor"]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.plan.noop).toBe(true);
  });

  test("verify memory-integration reports absent components when nothing was installed", async () => {
    const { stdout, exitCode } = await runCli(["verify", "memory-integration", "--agent", "cursor"]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.verification.mcp.present).toBe(false);
  });

  test("memory-hook-run --agent claude-code prints plain text (not the JSON envelope) and always exits 0", () => {
    const proc = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "claude-code"], {
      stdin: Buffer.from(JSON.stringify({ cwd: "/tmp/some-repo-that-is-not-bound", hook_event_name: "SessionStart" })),
      env: homeEnv(home),
    });

    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    expect(() => JSON.parse(stdout)).toThrow(); // plain text, not the {schemaVersion, ...} envelope
    expect(stdout.toLowerCase()).toContain("no disponible");
  });

  test("memory-hook-run --agent codex prints structured hookSpecificOutput.additionalContext and always exits 0", () => {
    const proc = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "codex"], {
      stdin: Buffer.from(JSON.stringify({ cwd: "/tmp/some-repo-that-is-not-bound", hook_event_name: "SessionStart" })),
      env: homeEnv(home),
    });

    expect(proc.exitCode).toBe(0);
    const parsed = JSON.parse(proc.stdout.toString());
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext.toLowerCase()).toContain("no disponible");
    expect(parsed).not.toHaveProperty("systemMessage");
  });

  test("memory-hook-run exits 0 even with garbage stdin", () => {
    const proc = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "claude-code"], {
      stdin: Buffer.from("not json"),
      env: homeEnv(home),
    });

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().toLowerCase()).toContain("no disponible");
  });

  test("memory-hook-run records evidence of the real invocation, even when Engram itself is unreachable", async () => {
    const { resolveHookEvidencePath } = await import("../../modules/agents/hook-command");
    const evidencePath = resolveHookEvidencePath(home, "claude-code");
    expect(existsSync(evidencePath)).toBe(false);

    const proc = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "claude-code"], {
      stdin: Buffer.from(JSON.stringify({ cwd: "/tmp/some-repo", hook_event_name: "SessionStart" })),
      env: homeEnv(home),
    });
    expect(proc.exitCode).toBe(0);

    expect(existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    expect(evidence.agentId).toBe("claude-code");
    expect(evidence.engramContextReceived).toBe(false); // no Engram fixture installed for this test
    expect(evidence).not.toHaveProperty("directory");
    expect(evidence).not.toHaveProperty("cwd");
  });

  test("memory-hook-run does not record evidence when stdin doesn't look like a real hook invocation", async () => {
    const { resolveHookEvidencePath } = await import("../../modules/agents/hook-command");
    const evidencePath = resolveHookEvidencePath(home, "codex");

    const proc = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "codex"], {
      stdin: Buffer.from("not json"),
      env: homeEnv(home),
    });

    expect(proc.exitCode).toBe(0);
    expect(existsSync(evidencePath)).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "full memory-install cycle for claude-code: not complete until the real hook runs and leaves evidence, then removal clears both",
    async () => {
      installEngramFixture(home);

      const planned = await runCli(["plan", "memory-install", "--agent", "claude-code"]);
      expect(planned.exitCode).toBe(0);
      const plan = JSON.parse(planned.stdout).plan;
      expect(plan.metadata.hook.status.kind).toBe("write");

      const applied = await runCli(["apply", "--plan-id", plan.planId]);
      expect(applied.exitCode).toBe(0);

      const verifiedBeforeExecution = await runCli(["verify", "memory-integration", "--agent", "claude-code"]);
      expect(verifiedBeforeExecution.exitCode).toBe(0);
      const beforeExecution = JSON.parse(verifiedBeforeExecution.stdout).verification;
      expect(beforeExecution.hook.present).toBe(true);
      expect(beforeExecution.hook.dryRunOk).toBe(true); // diagnostic only
      expect(beforeExecution.hook.runtimeStatus.kind).toBe("pending-runtime-verification");
      expect(beforeExecution.overallStatus).toBe("partial");

      // Actually run the real hook command the installed config now points at —
      // this is what a genuine SessionStart trigger does, and it must leave
      // evidence for verify to find.
      const hookRun = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "claude-code"], {
        stdin: Buffer.from(JSON.stringify({ cwd: "/tmp/some-repo", hook_event_name: "SessionStart" })),
        env: homeEnv(home),
      });
      expect(hookRun.exitCode).toBe(0);

      const verified = await runCli(["verify", "memory-integration", "--agent", "claude-code"]);
      expect(verified.exitCode).toBe(0);
      const verification = JSON.parse(verified.stdout).verification;
      expect(verification.hook.runtimeStatus.kind).toBe("runtime-observed");
      expect(verification.overallStatus).toBe("complete");

      const removePlanned = await runCli(["plan", "memory-remove", "--agent", "claude-code"]);
      const removePlan = JSON.parse(removePlanned.stdout).plan;
      const removeApplied = await runCli(["apply", "--plan-id", removePlan.planId]);
      expect(removeApplied.exitCode).toBe(0);

      const finalVerified = await runCli(["verify", "memory-integration", "--agent", "claude-code"]);
      const finalVerification = JSON.parse(finalVerified.stdout).verification;
      expect(finalVerification.hook.present).toBe(false);
      expect(finalVerification.hook.runtimeStatus.kind).toBe("absent");
    },
  );

  test.skipIf(process.platform === "win32")(
    "codex install always surfaces needs-user-trust through plan, never complete, until evidence proves a real trusted run",
    async () => {
      installEngramFixture(home);

      const planned = await runCli(["plan", "memory-install", "--agent", "codex"]);
      expect(planned.exitCode).toBe(0);
      const plan = JSON.parse(planned.stdout).plan;

      expect(plan.metadata.hook.status.kind).toBe("write"); // structural: the config entry itself is correct
      expect(plan.metadata.hook.runtimeStatus.kind).toBe("needs-user-trust");
      expect(plan.metadata.overallStatus).not.toBe("complete");

      const applied = await runCli(["apply", "--plan-id", plan.planId]);
      expect(applied.exitCode).toBe(0);

      const verified = await runCli(["verify", "memory-integration", "--agent", "codex"]);
      const verification = JSON.parse(verified.stdout).verification;
      expect(verification.hook.runtimeStatus.kind).toBe("needs-user-trust");
      expect(verification.overallStatus).not.toBe("complete");

      // Simulate Codex actually running the trusted hook (the real trust
      // approval itself happens natively inside Codex, outside anything Engines
      // can drive — see the spec's Codex section).
      const hookRun = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "codex"], {
        stdin: Buffer.from(JSON.stringify({ cwd: "/tmp/some-repo", hook_event_name: "SessionStart" })),
        env: homeEnv(home),
      });
      expect(hookRun.exitCode).toBe(0);

      const verifiedAfterExecution = await runCli(["verify", "memory-integration", "--agent", "codex"]);
      const afterExecution = JSON.parse(verifiedAfterExecution.stdout).verification;
      expect(afterExecution.hook.runtimeStatus.kind).toBe("runtime-observed");
      expect(afterExecution.overallStatus).toBe("complete");
    },
  );

  test("the generic apply command refuses an mcp-repair plan with CONFIRMATION_REQUIRED", async () => {
    const configPath = join(home, ".claude.json");
    const before = '{"mcpServers":{"forge614-engram":{"command":"/old/path","args":["serve"]}}}';
    writeFileSync(configPath, before);

    const planned = await runCli(["plan", "mcp-repair", "--agent", "claude-code"]);
    expect(planned.exitCode).toBe(0);
    const plan = JSON.parse(planned.stdout).plan;
    expect(plan.repair.status).toBe("repairable-conflict");

    const { stdout, exitCode } = await runCli(["apply", "--plan-id", plan.planId]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });
});

describe("errorCodeFor — mcp-repair", () => {
  test("maps NotRepairableError to NOT_REPAIRABLE", () => {
    expect(errorCodeFor(new NotRepairableError("abc"))).toBe("NOT_REPAIRABLE");
  });

  test("maps ConfirmationRequiredError to CONFIRMATION_REQUIRED", () => {
    expect(errorCodeFor(new ConfirmationRequiredError("abc"))).toBe("CONFIRMATION_REQUIRED");
  });
});
