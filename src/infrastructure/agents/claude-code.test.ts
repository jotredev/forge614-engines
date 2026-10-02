import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { claudeCodeAdapter } from "./claude-code";

describe("claudeCodeAdapter.capabilities", () => {
  test("supports a configurable reasoning level in headless mode, through --effort", () => {
    expect(claudeCodeAdapter.capabilities.supportsReasoningLevel).toBe(true);
  });

  test("declares all five reasoning levels, in order", () => {
    expect(claudeCodeAdapter.reasoningLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("claudeCodeAdapter.headlessCommand", () => {
  const headless = claudeCodeAdapter.headlessCommand!;

  test("without a reasoning level, the arguments are exactly the pre-existing ones", () => {
    expect(headless("/bin/claude", { prompt: "hello" })).toEqual({ command: "/bin/claude", args: ["-p", "hello"] });
    expect(headless("/bin/claude", { prompt: "hello", model: "claude-sonnet-5" })).toEqual({
      command: "/bin/claude",
      args: ["-p", "hello", "--model", "claude-sonnet-5"],
    });
    expect(headless("/bin/claude", { prompt: "hello", stdinPrompt: true })).toEqual({
      command: "/bin/claude",
      args: ["-p"],
      stdin: true,
    });
    expect(headless("/bin/claude", { prompt: "hello", readableDir: "/proj" })).toEqual({
      command: "/bin/claude",
      args: ["--add-dir", "/proj", "-p", "hello"],
    });
  });

  test("with a reasoning level and the prompt in the arguments, --effort and its value follow the prompt", () => {
    expect(headless("/bin/claude", { prompt: "hello", reasoningLevel: "xhigh" })).toEqual({
      command: "/bin/claude",
      args: ["-p", "hello", "--effort", "xhigh"],
    });
  });

  test("with a reasoning level and --stdin-prompt, --effort follows -p and the prompt stays out of the arguments", () => {
    expect(headless("/bin/claude", { prompt: "hello", reasoningLevel: "low", stdinPrompt: true })).toEqual({
      command: "/bin/claude",
      args: ["-p", "--effort", "low"],
      stdin: true,
    });
  });

  test("with --model and --readable-dir together, --add-dir stays before -p and --effort goes with --model after it", () => {
    expect(
      headless("/bin/claude", {
        prompt: "hello",
        model: "claude-opus-5",
        reasoningLevel: "max",
        readableDir: "/proj",
      }),
    ).toEqual({
      command: "/bin/claude",
      args: ["--add-dir", "/proj", "-p", "hello", "--model", "claude-opus-5", "--effort", "max"],
    });
    expect(
      headless("/bin/claude", {
        prompt: "hello",
        model: "claude-opus-5",
        reasoningLevel: "medium",
        readableDir: "/proj",
        stdinPrompt: true,
      }),
    ).toEqual({
      command: "/bin/claude",
      args: ["--add-dir", "/proj", "-p", "--model", "claude-opus-5", "--effort", "medium"],
      stdin: true,
    });
  });
});

describe("claudeCodeAdapter.hooks", () => {
  test("declares hooks in ~/.claude/settings.json, separate from the MCP config file", () => {
    const home = "/home/jorge";
    expect(claudeCodeAdapter.hooks!.configFile(home)).toBe(join(home, ".claude", "settings.json"));
    expect(claudeCodeAdapter.hooks!.configFile(home)).not.toBe(claudeCodeAdapter.configFile(home));
    expect(claudeCodeAdapter.hooks!.configFormat).toBe("json");
    expect(claudeCodeAdapter.hooks!.entryPath).toEqual(["hooks", "SessionStart"]);
  });

  test("entryShape omits matcher, which Claude Code's docs confirm means every source, including resume and post-compaction recovery", () => {
    const entry = claudeCodeAdapter.hooks!.entryShape("cmd") as Record<string, unknown>;
    expect(entry).toEqual({ hooks: [{ type: "command", command: "cmd" }] });
    expect(entry).not.toHaveProperty("matcher");
  });

  test("does not require user trust — Claude Code's hooks have no per-hook trust gate", () => {
    expect(claudeCodeAdapter.hooks!.requiresUserTrust).toBe(false);
  });
});
