import { describe, expect, test } from "bun:test";
import { codexAdapter } from "./codex";

describe("codexAdapter", () => {
  test("has the expected identity and capabilities", () => {
    expect(codexAdapter.id).toBe("codex");
    expect(codexAdapter.configFormat).toBe("toml");
    expect(codexAdapter.capabilities.supportsHeadlessExec).toBe(true);
  });

  test("points at ~/.codex/config.toml", () => {
    expect(codexAdapter.configFile("/home/u")).toBe("/home/u/.codex/config.toml");
  });

  test("builds a headless invocation with exec", () => {
    expect(codexAdapter.headlessCommand?.("/bin/codex", { prompt: "hello" })).toEqual({
      command: "/bin/codex",
      args: ["exec", "hello"],
    });
  });
});
