import { describe, expect, test } from "bun:test";
import { decideMcpWrite } from "./decide";

describe("decideMcpWrite", () => {
  test("write when nothing exists yet", () => {
    expect(decideMcpWrite(undefined, { command: "x" })).toEqual({ kind: "write" });
  });

  test("noop when the existing entry already matches", () => {
    expect(decideMcpWrite({ command: "x" }, { command: "x" })).toEqual({ kind: "noop" });
  });

  test("conflict when an existing entry differs", () => {
    expect(decideMcpWrite({ command: "y" }, { command: "x" })).toEqual({ kind: "conflict" });
  });

  test("an entry that only adds default_tools_approval_mode is still ours: noop, not conflict", () => {
    expect(
      decideMcpWrite(
        { command: "x", args: ["mcp"], default_tools_approval_mode: "approve" },
        { command: "x", args: ["mcp"] },
      ),
    ).toEqual({ kind: "noop" });
  });

  test("any other extra key or a different command is still a conflict, approval key or not", () => {
    expect(
      decideMcpWrite(
        { command: "/other", args: ["mcp"], default_tools_approval_mode: "approve" },
        { command: "x", args: ["mcp"] },
      ),
    ).toEqual({ kind: "conflict" });
    expect(
      decideMcpWrite(
        { command: "x", args: ["mcp"], env: { A: "1" }, default_tools_approval_mode: "approve" },
        { command: "x", args: ["mcp"] },
      ),
    ).toEqual({ kind: "conflict" });
  });
});
