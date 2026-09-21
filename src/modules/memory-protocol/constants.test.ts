import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveEngramMcpServer } from "./constants";

let previousForgeHome: string | undefined;

beforeEach(() => {
  previousForgeHome = process.env.FORGE614_HOME;
  delete process.env.FORGE614_HOME;
});

afterEach(() => {
  if (previousForgeHome === undefined) delete process.env.FORGE614_HOME;
  else process.env.FORGE614_HOME = previousForgeHome;
});

describe("resolveEngramMcpServer", () => {
  test("keeps the MCP server name exactly 'forge614-engram'", () => {
    expect(resolveEngramMcpServer("/home/u", "linux").name).toBe("forge614-engram");
  });

  test("always uses the 'mcp' subcommand as args", () => {
    expect(resolveEngramMcpServer("/home/u", "linux").args).toEqual(["mcp"]);
  });

  test("resolves the canonical path under ~/.forge614 on macOS", () => {
    expect(resolveEngramMcpServer("/Users/u", "darwin").command).toBe("/Users/u/.forge614/engram/bin/forge614-engram");
  });

  test("resolves the canonical path under ~/.forge614 on Linux", () => {
    expect(resolveEngramMcpServer("/home/u", "linux").command).toBe("/home/u/.forge614/engram/bin/forge614-engram");
  });

  test("resolves the canonical path with a .exe suffix on Windows", () => {
    expect(resolveEngramMcpServer("C:\\Users\\u", "win32").command).toBe(
      "C:\\Users\\u\\.forge614\\engram\\bin\\forge614-engram.exe",
    );
  });

  test("respects a custom FORGE614_HOME on macOS/Linux", () => {
    process.env.FORGE614_HOME = "/opt/forge614";
    expect(resolveEngramMcpServer("/home/u", "linux").command).toBe("/opt/forge614/engram/bin/forge614-engram");
  });

  test("respects a custom FORGE614_HOME on Windows", () => {
    process.env.FORGE614_HOME = "D:\\Forge614";
    expect(resolveEngramMcpServer("C:\\Users\\u", "win32").command).toBe("D:\\Forge614\\engram\\bin\\forge614-engram.exe");
  });

  test("defaults to the running process's platform when none is given", () => {
    const expectedSuffix = process.platform === "win32" ? ".exe" : "";
    expect(resolveEngramMcpServer("/home/u").command.endsWith(`forge614-engram${expectedSuffix}`)).toBe(true);
  });
});
