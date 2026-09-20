import { describe, expect, test } from "bun:test";
import { extractBlock, withBlock } from "./block";

describe("extractBlock", () => {
  test("returns undefined when the markers are absent", () => {
    expect(extractBlock("", "x")).toBeUndefined();
    expect(extractBlock("some unrelated content", "x")).toBeUndefined();
  });

  test("returns the trimmed content between the markers", () => {
    const raw = "<!-- forge614-engines:begin x -->\nhello\n<!-- forge614-engines:end x -->\n";
    expect(extractBlock(raw, "x")).toBe("hello");
  });
});

describe("withBlock", () => {
  test("appends a block to an empty file", () => {
    expect(withBlock("", "x", "hello")).toBe("<!-- forge614-engines:begin x -->\nhello\n<!-- forge614-engines:end x -->\n");
  });

  test("appends a block after existing content, preserving it", () => {
    const result = withBlock("existing content\n", "x", "hello");
    expect(result).toBe("existing content\n\n<!-- forge614-engines:begin x -->\nhello\n<!-- forge614-engines:end x -->\n");
  });

  test("updates an existing block in place without disturbing surrounding content", () => {
    const withHello = withBlock("existing content\n", "x", "hello");
    const withGoodbye = withBlock(withHello, "x", "goodbye");
    expect(withGoodbye).toBe("existing content\n\n<!-- forge614-engines:begin x -->\ngoodbye\n<!-- forge614-engines:end x -->\n");
  });

  test("removing a block restores the original surrounding content exactly", () => {
    const original = "existing content\n";
    const withHello = withBlock(original, "x", "hello");
    expect(withBlock(withHello, "x", undefined)).toBe(original);
  });

  test("removing the only content in the file leaves it empty", () => {
    const onlyBlock = withBlock("", "x", "hello");
    expect(withBlock(onlyBlock, "x", undefined)).toBe("");
  });

  test("removing an absent block is a noop", () => {
    expect(withBlock("existing content\n", "x", undefined)).toBe("existing content\n");
  });

  test("two different block ids in the same file do not interfere", () => {
    const withFirst = withBlock("", "a", "one");
    const withBoth = withBlock(withFirst, "b", "two");
    expect(extractBlock(withBoth, "a")).toBe("one");
    expect(extractBlock(withBoth, "b")).toBe("two");
    const withoutFirst = withBlock(withBoth, "a", undefined);
    expect(extractBlock(withoutFirst, "b")).toBe("two");
  });
});
