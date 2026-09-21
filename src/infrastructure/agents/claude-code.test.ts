import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { claudeCodeAdapter } from "./claude-code";

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
