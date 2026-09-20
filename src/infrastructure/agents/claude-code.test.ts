import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { claudeCodeAdapter } from "./claude-code";

describe("claudeCodeAdapter", () => {
  test("has the expected identity and capabilities", () => {
    expect(claudeCodeAdapter.id).toBe("claude-code");
    expect(claudeCodeAdapter.capabilities).toEqual({
      supportsMcp: true,
      supportsHooks: true,
      supportsHeadlessExec: true,
    });
  });

  test("points at ~/.claude.json for config", () => {
    expect(claudeCodeAdapter.configFile("/home/u")).toBe(join("/home/u", ".claude.json"));
    expect(claudeCodeAdapter.configDir("/home/u")).toBe(join("/home/u", ".claude"));
  });

  test("builds the {command,args} MCP entry shape", () => {
    const shape = claudeCodeAdapter.mcpEntryShape({ name: "forge614-engram", command: "/bin/engram", args: ["mcp"] });
    expect(shape).toEqual({ command: "/bin/engram", args: ["mcp"] });
  });

  test("builds a headless invocation with -p", () => {
    const headless = claudeCodeAdapter.headlessCommand?.("/bin/claude", { prompt: "hello" });
    expect(headless).toEqual({ command: "/bin/claude", args: ["-p", "hello"] });
  });

  test("uses claude.exe as the candidate name on windows", () => {
    expect(claudeCodeAdapter.candidateExecutableNames("win32")).toEqual(["claude.exe"]);
    expect(claudeCodeAdapter.candidateExecutableNames("darwin")).toEqual(["claude"]);
  });

  test("manages global instructions through CLAUDE.md with a satellite content file", () => {
    const target = claudeCodeAdapter.instructions;
    expect(target).toBeDefined();
    expect(target?.primaryFile("/home/u")).toBe(join("/home/u", ".claude", "CLAUDE.md"));
    expect(target?.shadowingFiles("/home/u")).toEqual([]);
    expect(target?.contentFile?.("/home/u")).toBe(join("/home/u", ".claude", "forge614-engram-memory-protocol.md"));
  });
});
