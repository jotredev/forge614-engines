import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgent } from "./detect-agent";
import type { AgentAdapter } from "../../modules/agents/types";

let dir: string;
let home: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-detect-"));
  home = join(dir, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    id: "claude-code",
    label: "Fake",
    capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false, supportsReasoningLevel: false },
    configFormat: "json",
    mcpEntryPath: ["mcpServers"],
    candidateExecutableNames: () => ["fake-agent"],
    knownInstallPaths: () => [],
    configDir: (h) => join(h, ".fake"),
    configFile: (h) => join(h, ".fake.json"),
    mcpEntryShape: (server) => ({ command: server.command, args: server.args }),
    ...overrides,
  };
}

describe("detectAgent", () => {
  test("reports installed:false, configFound:false when nothing exists", async () => {
    const result = await detectAgent(fakeAdapter(), home, { PATH: dir }, process.platform);
    expect(result).toEqual({
      id: "claude-code",
      label: "Fake",
      installed: false,
      executable: undefined,
      configDir: join(home, ".fake"),
      configFound: false,
    });
  });

  test("reports installed:true when the binary is on PATH, configFound:true when the config dir exists", async () => {
    const binPath = join(dir, "fake-agent");
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);
    mkdirSync(join(home, ".fake"));

    const result = await detectAgent(fakeAdapter(), home, { PATH: dir }, process.platform);
    expect(result.installed).toBe(true);
    expect(result.executable).toBe(binPath);
    expect(result.configFound).toBe(true);
  });

  test("falls back to knownInstallPaths for an agent that is not on PATH (e.g. a desktop app)", async () => {
    const appPath = join(dir, "Fake.app", "Contents", "MacOS", "Fake");
    mkdirSync(join(dir, "Fake.app", "Contents", "MacOS"), { recursive: true });
    writeFileSync(appPath, "");

    const adapter = fakeAdapter({
      candidateExecutableNames: () => [],
      knownInstallPaths: () => [join(dir, "Missing.app", "Contents", "MacOS", "Missing"), appPath],
    });

    const result = await detectAgent(adapter, home, { PATH: dir }, process.platform);
    expect(result.installed).toBe(true);
    expect(result.executable).toBe(appPath);
    expect(result.configFound).toBe(false);
  });
});
