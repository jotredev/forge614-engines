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
});
