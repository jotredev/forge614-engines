import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cursorAdapter } from "./cursor";

describe("cursorAdapter", () => {
  test("has no headless support and a dedicated mcp.json", () => {
    expect(cursorAdapter.capabilities.supportsHeadlessExec).toBe(false);
    expect(cursorAdapter.headlessCommand).toBeUndefined();
    expect(cursorAdapter.configFile("/home/u")).toBe(join("/home/u", ".cursor", "mcp.json"));
  });

  test("has no PATH-scannable binary, only known install paths on darwin/win32", () => {
    expect(cursorAdapter.candidateExecutableNames("darwin")).toEqual([]);
    expect(cursorAdapter.knownInstallPaths("darwin", "/home/u")).toContain(
      "/Applications/Cursor.app/Contents/MacOS/Cursor",
    );
    expect(cursorAdapter.knownInstallPaths("win32", "C:\\Users\\u")).toEqual([
      "C:\\Users\\u\\AppData\\Local\\Programs\\cursor\\Cursor.exe",
    ]);
    expect(cursorAdapter.knownInstallPaths("linux", "/home/u")).toEqual([]);
  });

  test("has no global instructions mechanism (no officially documented file for User Rules)", () => {
    expect(cursorAdapter.instructions).toBeUndefined();
  });
});
