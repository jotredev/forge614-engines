import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { decideHookInstall, decideHookRemove } from "./hook-write-decision";

let home: string;
const COMMAND = '"/bin/forge614-engines" memory-hook-run --agent claude-code';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-hookdecision-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("decideHookInstall", () => {
  test("writes a fresh entry into a config file that doesn't exist yet", async () => {
    const result = await decideHookInstall(claudeCodeAdapter, home, COMMAND);
    expect(result.decision.kind).toBe("write");
    const written = JSON.parse(result.write!.afterContent);
    expect(written.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: COMMAND }] }]);
  });

  test("is a noop when the exact entry is already present", async () => {
    const configPath = claudeCodeAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: COMMAND }] }] } }));

    const result = await decideHookInstall(claudeCodeAdapter, home, COMMAND);
    expect(result.decision.kind).toBe("noop");
  });

  test("appends alongside a foreign hook entry without touching it", async () => {
    const configPath = claudeCodeAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    const foreign = { matcher: "startup", hooks: [{ type: "command", command: "/opt/some-other-tool" }] };
    writeFileSync(configPath, JSON.stringify({ hooks: { SessionStart: [foreign] } }));

    const result = await decideHookInstall(claudeCodeAdapter, home, COMMAND);
    expect(result.decision.kind).toBe("write");
    const written = JSON.parse(result.write!.afterContent);
    expect(written.hooks.SessionStart).toEqual([foreign, { hooks: [{ type: "command", command: COMMAND }] }]);
  });

  test("replaces its own stale entry in place rather than duplicating it", async () => {
    const configPath = claudeCodeAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    const stale = { matcher: "startup", hooks: [{ type: "command", command: COMMAND, timeout: 5 }] };
    writeFileSync(configPath, JSON.stringify({ hooks: { SessionStart: [stale] } }));

    const result = await decideHookInstall(claudeCodeAdapter, home, COMMAND);
    expect(result.decision.kind).toBe("write");
    const written = JSON.parse(result.write!.afterContent);
    expect(written.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: COMMAND }] }]);
  });

  test("is blocked, safely, when hooks.SessionStart exists but isn't an array", async () => {
    const configPath = claudeCodeAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ hooks: { SessionStart: "not-an-array" } }));

    const result = await decideHookInstall(claudeCodeAdapter, home, COMMAND);
    expect(result.decision.kind).toBe("blocked");
    expect(result.blockedReason).toBe("hooks-not-array");
  });
});

describe("decideHookInstall with a seed", () => {
  test("computes afterContent against the seeded content, not the disk content, while still hashing the real disk content for beforeHash", async () => {
    // Simulates Codex: MCP and hooks share one file. A sibling MCP decision already
    // computed a new document (seed) that isn't on disk yet; the hook decision must
    // build on top of that seed, not re-read the still-unmodified file.
    const { codexAdapter } = await import("../infrastructure/agents/codex");
    const configPath = codexAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    const onDisk = 'model = "gpt-5"\n';
    writeFileSync(configPath, onDisk);
    const seededRaw = 'model = "gpt-5"\n\n[mcp_servers.forge614-engram]\ncommand = "/bin/engram"\nargs = ["mcp"]\n';

    const result = await decideHookInstall(codexAdapter, home, '"/bin/x" memory-hook-run --agent codex', { raw: seededRaw });

    expect(result.decision.kind).toBe("write");
    expect(result.write!.afterContent).toContain("mcp_servers");
    expect(result.write!.afterContent).toContain("hooks");
    // beforeHash reflects the true on-disk content (what apply-plan actually
    // checks against), not the seed.
    const { createHash } = await import("node:crypto");
    expect(result.write!.beforeHash).toBe(createHash("sha256").update(onDisk).digest("hex"));
  });
});

describe("decideHookRemove", () => {
  test("is a noop when nothing of ours is present", async () => {
    const result = await decideHookRemove(claudeCodeAdapter, home, COMMAND);
    expect(result.decision.kind).toBe("noop");
  });

  test("removes only its own entry, preserving a foreign one", async () => {
    const configPath = claudeCodeAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    const foreign = { matcher: "startup", hooks: [{ type: "command", command: "/opt/some-other-tool" }] };
    writeFileSync(
      configPath,
      JSON.stringify({ hooks: { SessionStart: [foreign, { hooks: [{ type: "command", command: COMMAND }] }] } }),
    );

    const result = await decideHookRemove(claudeCodeAdapter, home, COMMAND);
    expect(result.decision.kind).toBe("write");
    const written = JSON.parse(result.write!.afterContent);
    expect(written.hooks.SessionStart).toEqual([foreign]);
  });
});
