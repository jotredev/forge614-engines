import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ANTIGRAVITY_READ_ONLY_SETTINGS, antigravityAdapter } from "./antigravity";

describe("antigravityAdapter.capabilities", () => {
  test("declares full support including MCP, hooks, headless, reasoning levels and read-only", () => {
    expect(antigravityAdapter.id).toBe("antigravity");
    expect(antigravityAdapter.label).toBe("Antigravity");
    expect(antigravityAdapter.capabilities).toEqual({
      supportsMcp: true,
      supportsHooks: true,
      supportsHeadlessExec: true,
      supportsReasoningLevel: true,
      supportsReadOnly: true,
    });
  });

  test("declares all five reasoning levels, in order", () => {
    expect(antigravityAdapter.reasoningLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("antigravityAdapter.paths", () => {
  test("resolves executable names and known install paths per platform", () => {
    const home = "/home/jorge";
    expect(antigravityAdapter.candidateExecutableNames("darwin")).toEqual(["agy"]);
    expect(antigravityAdapter.candidateExecutableNames("linux")).toEqual(["agy"]);
    expect(antigravityAdapter.candidateExecutableNames("win32")).toEqual(["agy.exe"]);

    expect(antigravityAdapter.knownInstallPaths("darwin", home)).toEqual([join(home, ".local", "bin", "agy")]);
    expect(antigravityAdapter.knownInstallPaths("linux", home)).toEqual([join(home, ".local", "bin", "agy")]);
    expect(antigravityAdapter.knownInstallPaths("win32", home)).toEqual([
      join(home, "AppData", "Local", "agy", "bin", "agy.exe"),
    ]);
  });

  test("targets Antigravity CLI configDir, global MCP config, global AGENTS.md, hooks.json and settings.json", () => {
    const home = "/home/jorge";
    expect(antigravityAdapter.configDir(home)).toBe(join(home, ".gemini", "antigravity-cli"));
    expect(antigravityAdapter.configFile(home)).toBe(join(home, ".gemini", "config", "mcp_config.json"));
    expect(antigravityAdapter.configFormat).toBe("json");
    expect(antigravityAdapter.mcpEntryPath).toEqual(["mcpServers"]);
    expect(antigravityAdapter.instructions!.primaryFile(home)).toBe(join(home, ".gemini", "config", "AGENTS.md"));
    expect(antigravityAdapter.instructions!.shadowingFiles(home)).toEqual([]);
    expect(antigravityAdapter.instructions!.contentFile).toBeUndefined();
  });
});

describe("antigravityAdapter.hooks", () => {
  test("declares flat SessionStart hooks in ~/.gemini/config/hooks.json under a dedicated named group", () => {
    const home = "/home/jorge";
    expect(antigravityAdapter.hooks!.configFile(home)).toBe(join(home, ".gemini", "config", "hooks.json"));
    expect(antigravityAdapter.hooks!.configFormat).toBe("json");
    expect(antigravityAdapter.hooks!.entryPath).toEqual(["forge614-engram-memory", "SessionStart"]);
    expect(antigravityAdapter.hooks!.entryStyle).toBe("flat");
    expect(antigravityAdapter.hooks!.removeEmptyParent).toBe(true);
    expect(antigravityAdapter.hooks!.entryShape("cmd")).toEqual({ type: "command", command: "cmd" });
    expect(antigravityAdapter.hooks!.requiresUserTrust).toBe(false);
  });
});

describe("antigravityAdapter.toolApproval", () => {
  test("uses Antigravity permission-rules syntax in ~/.gemini/antigravity-cli/settings.json", () => {
    const home = "/home/jorge";
    const approval = antigravityAdapter.toolApproval!;
    expect(approval.kind).toBe("permission-rules");
    if (approval.kind !== "permission-rules") return;
    expect(approval.configFile(home)).toBe(join(home, ".gemini", "antigravity-cli", "settings.json"));
    expect(approval.configFormat).toBe("json");
    expect(approval.allowPath).toEqual(["permissions", "allow"]);
    expect(approval.denyPath).toEqual(["permissions", "deny"]);
    expect(approval.askPath).toEqual(["permissions", "ask"]);
    expect(approval.serverRule("forge614-engram")).toBe("mcp(forge614-engram/*)");
    expect(approval.toolRulePrefix("forge614-engram")).toBe("mcp(forge614-engram/");
  });
});

describe("antigravityAdapter.headlessCommand", () => {
  const headless = antigravityAdapter.headlessCommand!;

  test("builds default positional print command", () => {
    expect(headless("/bin/agy", { prompt: "hello" })).toEqual({ command: "/bin/agy", args: ["-p", "hello"] });
  });

  test("forwards model, reasoningLevel (--effort), readableDir (--add-dir) and positive timeoutMs (--print-timeout)", () => {
    expect(
      headless("/bin/agy", {
        prompt: "hello",
        model: "gemini-4-argon",
        reasoningLevel: "low",
        readableDir: "/proj",
        timeoutMs: 30_000,
      }),
    ).toEqual({
      command: "/bin/agy",
      args: [
        "--add-dir",
        "/proj",
        "--print-timeout",
        "30000ms",
        "--model",
        "gemini-4-argon",
        "--effort",
        "low",
        "-p",
        "hello",
      ],
    });
  });

  test("omits --print-timeout when timeoutMs is absent or non-positive", () => {
    expect(headless("/bin/agy", { prompt: "hello", timeoutMs: 0 })).toEqual({
      command: "/bin/agy",
      args: ["-p", "hello"],
    });
    expect(headless("/bin/agy", { prompt: "hello", timeoutMs: -100 })).toEqual({
      command: "/bin/agy",
      args: ["-p", "hello"],
    });
  });

  test("with stdinPrompt, omits -p and prompt text and uses --input-format text with stdin: true", () => {
    expect(
      headless("/bin/agy", {
        prompt: "secret prompt",
        stdinPrompt: true,
        model: "gemini-4-argon",
        reasoningLevel: "high",
        readableDir: "/proj",
        timeoutMs: 15_000,
      }),
    ).toEqual({
      command: "/bin/agy",
      args: [
        "--add-dir",
        "/proj",
        "--print-timeout",
        "15000ms",
        "--model",
        "gemini-4-argon",
        "--effort",
        "high",
        "--input-format",
        "text",
      ],
      stdin: true,
    });
  });

  describe("readOnly", () => {
    test("passes session-only --settings denying writes, commands, MCP and web access", () => {
      const parsed = JSON.parse(ANTIGRAVITY_READ_ONLY_SETTINGS);
      expect(parsed).toEqual({
        agentMode: "",
        toolPermission: "request-review",
        permissions: {
          allow: [],
          ask: [],
          deny: ["write_file(*)", "command(*)", "mcp(*)", "read_url(*)", "execute_url(*)"],
        },
      });

      expect(headless("/bin/agy", { prompt: "hello", readOnly: true })).toEqual({
        command: "/bin/agy",
        args: ["--settings", ANTIGRAVITY_READ_ONLY_SETTINGS, "-p", "hello"],
      });
    });

    test("combines readOnly with readableDir, timeoutMs, model, reasoningLevel and stdinPrompt", () => {
      expect(
        headless("/bin/agy", {
          prompt: "hello",
          readOnly: true,
          readableDir: "/proj",
          timeoutMs: 45_000,
          model: "gemini-4-argon",
          reasoningLevel: "low",
          stdinPrompt: true,
        }),
      ).toEqual({
        command: "/bin/agy",
        args: [
          "--add-dir",
          "/proj",
          "--settings",
          ANTIGRAVITY_READ_ONLY_SETTINGS,
          "--print-timeout",
          "45000ms",
          "--model",
          "gemini-4-argon",
          "--effort",
          "low",
          "--input-format",
          "text",
        ],
        stdin: true,
      });
    });

    test("with readOnly false, omits --settings", () => {
      expect(headless("/bin/agy", { prompt: "hello", readOnly: false, readableDir: "/proj" })).toEqual({
        command: "/bin/agy",
        args: ["--add-dir", "/proj", "-p", "hello"],
      });
    });
  });
});
