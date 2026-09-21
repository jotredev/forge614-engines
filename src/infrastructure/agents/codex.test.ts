import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { codexAdapter } from "./codex";
import { MEMORY_HOOK_CONTEXT_TOKEN_LIMIT } from "../../modules/agents/hook-command";

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
