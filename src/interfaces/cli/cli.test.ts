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

  test("an unknown command reports UNKNOWN_COMMAND as JSON", async () => {
    const { stdout, exitCode } = await runCli(["nonsense"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
  });
});
