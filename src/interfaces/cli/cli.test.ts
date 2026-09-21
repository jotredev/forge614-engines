import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = "src/interfaces/cli/main.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-cli-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

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
});
