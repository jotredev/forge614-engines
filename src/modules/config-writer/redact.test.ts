import { describe, expect, test } from "bun:test";
import { redactMcpEntry } from "./redact";

describe("redactMcpEntry", () => {
  test("keeps command and args verbatim", () => {
    expect(redactMcpEntry({ command: "/bin/other", args: ["mcp", "--flag"] })).toEqual({
      command: "/bin/other",
      args: ["mcp", "--flag"],
    });
  });

  test("redacts every other key, including env", () => {
    expect(
      redactMcpEntry({ command: "/bin/other", args: ["mcp"], env: { API_KEY: "sk-secret" }, cwd: "/home/x" }),
    ).toEqual({ command: "/bin/other", args: ["mcp"], env: "<redacted>", cwd: "<redacted>" });
  });

  test("never echoes a non-object entry value", () => {
    expect(redactMcpEntry("sk-some-secret-string")).toEqual({ type: "string", redacted: true });
  });

  test("never echoes an array entry value", () => {
    expect(redactMcpEntry(["a", "b"])).toEqual({ type: "object", redacted: true });
  });

  test("passes through undefined", () => {
    expect(redactMcpEntry(undefined)).toBeUndefined();
  });
});
