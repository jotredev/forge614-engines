import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home },
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

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
      { id: "claude-code", label: "Claude Code", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true },
      { id: "codex", label: "Codex", supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true },
      { id: "cursor", label: "Cursor", supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false },
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
      env: { ...process.env, HOME: home, PATH: emptyPathDir },
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
      env: { ...process.env, HOME: home },
    });

    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    expect(() => JSON.parse(stdout)).toThrow(); // plain text, not the {schemaVersion, ...} envelope
    expect(stdout.toLowerCase()).toContain("no disponible");
  });

  test("memory-hook-run --agent codex prints structured hookSpecificOutput.additionalContext and always exits 0", () => {
    const proc = Bun.spawnSync(["bun", ENTRY, "memory-hook-run", "--agent", "codex"], {
      stdin: Buffer.from(JSON.stringify({ cwd: "/tmp/some-repo-that-is-not-bound", hook_event_name: "SessionStart" })),
      env: { ...process.env, HOME: home },
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
      env: { ...process.env, HOME: home },
    });

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().toLowerCase()).toContain("no disponible");
  });

  test.skipIf(process.platform === "win32")(
    "full memory-install cycle for claude-code reaches complete, then removal clears the hook",
    async () => {
      installEngramFixture(home);

      const planned = await runCli(["plan", "memory-install", "--agent", "claude-code"]);
      expect(planned.exitCode).toBe(0);
      const plan = JSON.parse(planned.stdout).plan;
      expect(plan.metadata.hook.status.kind).toBe("write");

      const applied = await runCli(["apply", "--plan-id", plan.planId]);
      expect(applied.exitCode).toBe(0);

      const verified = await runCli(["verify", "memory-integration", "--agent", "claude-code"]);
      expect(verified.exitCode).toBe(0);
      const verification = JSON.parse(verified.stdout).verification;
      expect(verification.hook.present).toBe(true);
      expect(verification.hook.dryRunOk).toBe(true);
      expect(verification.hook.trustPending).toBe(false);
      expect(verification.overallStatus).toBe("complete");

      const removePlanned = await runCli(["plan", "memory-remove", "--agent", "claude-code"]);
      const removePlan = JSON.parse(removePlanned.stdout).plan;
      const removeApplied = await runCli(["apply", "--plan-id", removePlan.planId]);
      expect(removeApplied.exitCode).toBe(0);

      const finalVerified = await runCli(["verify", "memory-integration", "--agent", "claude-code"]);
      const finalVerification = JSON.parse(finalVerified.stdout).verification;
      expect(finalVerification.hook.present).toBe(false);
    },
  );

  test.skipIf(process.platform === "win32")(
    "codex install always surfaces needs-user-trust through plan, never complete",
    async () => {
      installEngramFixture(home);

      const planned = await runCli(["plan", "memory-install", "--agent", "codex"]);
      expect(planned.exitCode).toBe(0);
      const plan = JSON.parse(planned.stdout).plan;

      expect(plan.metadata.hook.status.kind).toBe("needs-user-trust");
      expect(plan.metadata.hook.status.agentId).toBe("codex");
      expect(plan.metadata.overallStatus).not.toBe("complete");

      const applied = await runCli(["apply", "--plan-id", plan.planId]);
      expect(applied.exitCode).toBe(0);

      const verified = await runCli(["verify", "memory-integration", "--agent", "codex"]);
      const verification = JSON.parse(verified.stdout).verification;
      expect(verification.hook.trustPending).toBe(true);
      expect(verification.overallStatus).not.toBe("complete");
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
