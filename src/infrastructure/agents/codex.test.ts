import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { codexAdapter } from "./codex";
import { MEMORY_HOOK_CONTEXT_TOKEN_LIMIT } from "../../modules/agents/hook-command";

describe("codexAdapter.capabilities", () => {
  test("supports a configurable reasoning level in headless mode", () => {
    expect(codexAdapter.capabilities.supportsReasoningLevel).toBe(true);
  });

  test("declares all five reasoning levels, in order", () => {
    expect(codexAdapter.reasoningLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("can guarantee read-only execution, through --sandbox read-only and --ignore-user-config", () => {
    expect(codexAdapter.capabilities.supportsReadOnly).toBe(true);
  });
});

describe("codexAdapter.headlessCommand", () => {
  const headless = codexAdapter.headlessCommand!;

  test("without readOnly, the arguments are exactly the pre-existing ones", () => {
    expect(headless("/bin/codex", { prompt: "hello" })).toEqual({ command: "/bin/codex", args: ["exec", "hello"] });
    expect(headless("/bin/codex", { prompt: "hello", stdinPrompt: true })).toEqual({
      command: "/bin/codex",
      args: ["exec"],
      stdin: true,
    });
    expect(headless("/bin/codex", { prompt: "hello", readableDir: "/proj" })).toEqual({
      command: "/bin/codex",
      args: ["exec", "--add-dir", "/proj", "hello"],
    });
    expect(
      headless("/bin/codex", { prompt: "hello", readableDir: "/proj", model: "gpt-5-codex", reasoningLevel: "max" }),
    ).toEqual({
      command: "/bin/codex",
      args: ["exec", "--add-dir", "/proj", "--model", "gpt-5-codex", "-c", "model_reasoning_effort=max", "hello"],
    });
  });

  describe("readOnly", () => {
    // The lock: an explicit read-only sandbox, and Codex's user config.toml (which holds the Engram MCP server) not loaded.
    const lock = ["--sandbox", "read-only", "--ignore-user-config"];

    test("with the prompt in the arguments, the lock goes right after exec", () => {
      expect(headless("/bin/codex", { prompt: "hello", readOnly: true })).toEqual({
        command: "/bin/codex",
        args: ["exec", ...lock, "hello"],
      });
    });

    test("with --stdin-prompt, the lock goes right after exec and the prompt stays out of the arguments", () => {
      expect(headless("/bin/codex", { prompt: "hello", readOnly: true, stdinPrompt: true })).toEqual({
        command: "/bin/codex",
        args: ["exec", ...lock],
        stdin: true,
      });
    });

    test("with --readable-dir, the lock goes before --add-dir", () => {
      expect(headless("/bin/codex", { prompt: "hello", readOnly: true, readableDir: "/proj" })).toEqual({
        command: "/bin/codex",
        args: ["exec", "--sandbox", "read-only", "--ignore-user-config", "--add-dir", "/proj", "hello"],
      });
    });

    test("with --readable-dir, --model and a reasoning level together, the lock stays first", () => {
      expect(
        headless("/bin/codex", {
          prompt: "hello",
          readOnly: true,
          readableDir: "/proj",
          model: "gpt-5-codex",
          reasoningLevel: "max",
        }),
      ).toEqual({
        command: "/bin/codex",
        args: [
          "exec",
          "--sandbox",
          "read-only",
          "--ignore-user-config",
          "--add-dir",
          "/proj",
          "--model",
          "gpt-5-codex",
          "-c",
          "model_reasoning_effort=max",
          "hello",
        ],
      });
    });

    test("with readOnly false, the arguments are exactly the ones without the option", () => {
      expect(headless("/bin/codex", { prompt: "hello", readOnly: false, readableDir: "/proj" })).toEqual({
        command: "/bin/codex",
        args: ["exec", "--add-dir", "/proj", "hello"],
      });
    });
  });
});

describe("codexAdapter.hooks", () => {
  test("declares hooks in the same config.toml used for MCP servers", () => {
    const home = "/home/jorge";
    expect(codexAdapter.hooks!.configFile(home)).toBe(join(home, ".codex", "config.toml"));
    expect(codexAdapter.hooks!.configFile(home)).toBe(codexAdapter.configFile(home));
    expect(codexAdapter.hooks!.configFormat).toBe("toml");
    expect(codexAdapter.hooks!.entryPath).toEqual(["hooks", "SessionStart"]);
  });

  test("entryShape matches exactly startup, resume, clear, and compact, with a bounded additionalContextLimit", () => {
    const entry = codexAdapter.hooks!.entryShape("cmd") as any;
    expect(entry.matcher).toBe("^(startup|resume|clear|compact)$");
    expect(entry.hooks).toEqual([
      { type: "command", command: "cmd", additionalContextLimit: MEMORY_HOOK_CONTEXT_TOKEN_LIMIT },
    ]);
  });

  test("requires user trust — Codex's real, un-bypassable trust gate", () => {
    expect(codexAdapter.hooks!.requiresUserTrust).toBe(true);
  });
});
