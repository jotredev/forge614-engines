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

  test("adds --model to the headless invocation when a model is requested", () => {
    expect(codexAdapter.headlessCommand?.("/bin/codex", { prompt: "hello", model: "gpt-5-codex" })).toEqual({
      command: "/bin/codex",
      args: ["exec", "--model", "gpt-5-codex", "hello"],
    });
  });

  test("adds a model_reasoning_effort config override when a reasoning level is requested", () => {
    expect(codexAdapter.headlessCommand?.("/bin/codex", { prompt: "hello", reasoningLevel: "medium" })).toEqual({
      command: "/bin/codex",
      args: ["exec", "-c", "model_reasoning_effort=medium", "hello"],
    });
  });

  test("combines --model and the reasoning override in the same invocation", () => {
    expect(
      codexAdapter.headlessCommand?.("/bin/codex", { prompt: "hello", model: "gpt-5-codex", reasoningLevel: "low" }),
    ).toEqual({
      command: "/bin/codex",
      args: ["exec", "--model", "gpt-5-codex", "-c", "model_reasoning_effort=low", "hello"],
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
