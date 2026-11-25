import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { antigravityAdapter } from "../infrastructure/agents/antigravity";
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

describe("Antigravity flat named hooks (hooks.json)", () => {
  const AGY_COMMAND = '"/bin/forge614-engines" memory-hook-run --agent antigravity';

  test("installs under forge614-engram-memory.SessionStart while preserving sibling named hooks", async () => {
    const configPath = antigravityAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    const orcaHook = { PreInvocation: [{ type: "command", command: "/opt/orca.sh", timeout: 10 }] };
    writeFileSync(configPath, JSON.stringify({ "orca-status": orcaHook }, null, 2));

    const result = await decideHookInstall(antigravityAdapter, home, AGY_COMMAND);
    expect(result.decision.kind).toBe("write");
    const written = JSON.parse(result.write!.afterContent);
    expect(written["orca-status"]).toEqual(orcaHook);
    expect(written["forge614-engram-memory"]).toEqual({
      SessionStart: [{ type: "command", command: AGY_COMMAND }],
    });
  });

  test("is a noop when the flat entry is already exact, and replaces stale entries in place", async () => {
    const configPath = antigravityAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ "forge614-engram-memory": { SessionStart: [{ type: "command", command: AGY_COMMAND }] } }),
    );
    expect((await decideHookInstall(antigravityAdapter, home, AGY_COMMAND)).decision.kind).toBe("noop");

    writeFileSync(
      configPath,
      JSON.stringify({ "forge614-engram-memory": { SessionStart: [{ command: AGY_COMMAND, timeout: 5 }] } }),
    );
    const updated = await decideHookInstall(antigravityAdapter, home, AGY_COMMAND);
    expect(updated.decision.kind).toBe("write");
    expect(JSON.parse(updated.write!.afterContent)["forge614-engram-memory"].SessionStart).toEqual([
      { type: "command", command: AGY_COMMAND },
    ]);
  });

  test("is blocked cleanly when the named hook parent is not an object", async () => {
    const configPath = antigravityAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ "forge614-engram-memory": "invalid" }));

    const result = await decideHookInstall(antigravityAdapter, home, AGY_COMMAND);
    expect(result.decision.kind).toBe("blocked");
    expect(result.blockedReason).toBe("hooks-not-array");
  });

  test("removal deletes the empty forge614-engram-memory group while preserving sibling hooks", async () => {
    const configPath = antigravityAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    const orcaHook = { Stop: [{ type: "command", command: "/opt/orca.sh" }] };
    writeFileSync(
      configPath,
      JSON.stringify({
        "orca-status": orcaHook,
        "forge614-engram-memory": { SessionStart: [{ type: "command", command: AGY_COMMAND }] },
      }),
    );

    const result = await decideHookRemove(antigravityAdapter, home, AGY_COMMAND);
    expect(result.decision.kind).toBe("write");
    const written = JSON.parse(result.write!.afterContent);
    expect(written).toEqual({ "orca-status": orcaHook });
  });

  test("removal keeps forge614-engram-memory if it contains other user-defined events", async () => {
    const configPath = antigravityAdapter.hooks!.configFile(home);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        "forge614-engram-memory": {
          SessionStart: [{ type: "command", command: AGY_COMMAND }],
          Stop: [{ type: "command", command: "/opt/user-stop.sh" }],
        },
      }),
    );

    const result = await decideHookRemove(antigravityAdapter, home, AGY_COMMAND);
    expect(result.decision.kind).toBe("write");
    const written = JSON.parse(result.write!.afterContent);
    expect(written).toEqual({
      "forge614-engram-memory": { Stop: [{ type: "command", command: "/opt/user-stop.sh" }] },
    });
  });
});
