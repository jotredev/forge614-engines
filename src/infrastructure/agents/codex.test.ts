import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { codexAdapter } from "./codex";

describe("codexAdapter", () => {
  test("has the expected identity and capabilities", () => {
    expect(codexAdapter.id).toBe("codex");
    expect(codexAdapter.configFormat).toBe("toml");
    expect(codexAdapter.capabilities.supportsHeadlessExec).toBe(true);
  });

  test("points at ~/.codex/config.toml", () => {
    expect(codexAdapter.configFile("/home/u")).toBe(join("/home/u", ".codex", "config.toml"));
  });

  test("builds a headless invocation with exec", () => {
    expect(codexAdapter.headlessCommand?.("/bin/codex", { prompt: "hello" })).toEqual({
      command: "/bin/codex",
      args: ["exec", "hello"],
    });
  });

  test("manages global instructions through AGENTS.md, embedded, watching for AGENTS.override.md", () => {
    const target = codexAdapter.instructions;
    expect(target).toBeDefined();
    expect(target?.primaryFile("/home/u")).toBe(join("/home/u", ".codex", "AGENTS.md"));
    expect(target?.shadowingFiles("/home/u")).toEqual([join("/home/u", ".codex", "AGENTS.override.md")]);
    expect(target?.contentFile).toBeUndefined();
  });
});
