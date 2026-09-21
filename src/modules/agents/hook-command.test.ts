import { describe, expect, test } from "bun:test";
import { resolveEnginesExecutable, resolveMemoryHookCommand } from "./hook-command";

describe("resolveEnginesExecutable", () => {
  test("resolves under FORGE614_HOME/engines/bin on posix, no .exe suffix", () => {
    expect(resolveEnginesExecutable("/home/jorge", "linux")).toBe("/home/jorge/.forge614/engines/bin/forge614-engines");
  });

  test("resolves with .exe suffix on win32", () => {
    expect(resolveEnginesExecutable("C:\\Users\\jorge", "win32")).toBe(
      "C:\\Users\\jorge\\.forge614\\engines\\bin\\forge614-engines.exe",
    );
  });

  test("respects FORGE614_HOME override", () => {
    const previous = process.env.FORGE614_HOME;
    process.env.FORGE614_HOME = "/custom/forge";
    try {
      expect(resolveEnginesExecutable("/home/jorge", "linux")).toBe("/custom/forge/engines/bin/forge614-engines");
    } finally {
      if (previous === undefined) delete process.env.FORGE614_HOME;
      else process.env.FORGE614_HOME = previous;
    }
  });
});

describe("resolveMemoryHookCommand", () => {
  test("quotes the executable path and appends the subcommand with the agent flag", () => {
    expect(resolveMemoryHookCommand("/home/jorge", "claude-code", "linux")).toBe(
      '"/home/jorge/.forge614/engines/bin/forge614-engines" memory-hook-run --agent claude-code',
    );
    expect(resolveMemoryHookCommand("/home/jorge", "codex", "linux")).toBe(
      '"/home/jorge/.forge614/engines/bin/forge614-engines" memory-hook-run --agent codex',
    );
  });

  test("is stable across two calls with the same inputs (used as an identity signature)", () => {
    expect(resolveMemoryHookCommand("/home/jorge", "codex", "darwin")).toBe(
      resolveMemoryHookCommand("/home/jorge", "codex", "darwin"),
    );
  });

  test("differs between agents sharing the same home, so each adapter recognizes only its own entry", () => {
    expect(resolveMemoryHookCommand("/home/jorge", "claude-code", "darwin")).not.toBe(
      resolveMemoryHookCommand("/home/jorge", "codex", "darwin"),
    );
  });
});
