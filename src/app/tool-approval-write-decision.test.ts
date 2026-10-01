import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { decideToolApprovalInstall, decideToolApprovalRemove, readToolApprovalState } from "./tool-approval-write-decision";

/** Name of the Engram MCP server, the key every approval rule and setting is built on. */
const SERVER = "forge614-engram";

/** Ten pre-existing allow rules, the shape of a real ~/.claude/settings.json (one with escaped quotes). */
const TEN_RULES = [
  "Bash(git status)",
  "Bash(git diff:*)",
  'Bash(echo "quoted \\"inner\\" text")',
  "mcp__notion__notion-fetch",
  "mcp__playwright__browser_click",
  "mcp__playwright__browser_snapshot",
  "mcp__playwright__browser_navigate",
  "mcp__pencil",
  "Read(~/projects/**)",
  "WebFetch(domain:example.com)",
];

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-approvaldecision-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function claudeSettingsPath(): string {
  return claudeCodeAdapter.toolApproval!.configFile(home);
}

function codexConfigPath(): string {
  return codexAdapter.toolApproval!.configFile(home);
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("decideToolApprovalInstall — Claude Code", () => {
  test("creates permissions.allow when the settings file has no permissions at all", async () => {
    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    expect(result.configPath).toBe(claudeSettingsPath());
    expect(result.notice).toBeUndefined();
    expect(JSON.parse(result.write!.afterContent)).toEqual({ permissions: { allow: ["mcp__forge614-engram"] } });
    expect(result.write!.beforeHash).toBe(sha256(""));
  });

  test("appends at the end of ten existing rules without reordering them and keeps the rest of the file", async () => {
    const original = JSON.stringify({ defaultMode: "auto", permissions: { allow: TEN_RULES }, theme: "dark" }, null, 2);
    writeFileEnsuringDir(claudeSettingsPath(), original);

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    const written = JSON.parse(result.write!.afterContent);
    expect(written.permissions.allow).toEqual([...TEN_RULES, "mcp__forge614-engram"]);
    expect(written.defaultMode).toBe("auto");
    expect(written.theme).toBe("dark");
    expect(result.notice).toBeUndefined();
    expect(result.write!.beforeHash).toBe(sha256(original));
  });

  test("inserts without rewriting the array: a comment inside it and every other line survive byte for byte", async () => {
    const original =
      '{\n  "permissions": {\n    "allow": [\n      "Bash(git status)", // keep this comment\n      "mcp__pencil"\n    ]\n  }\n}\n';
    writeFileEnsuringDir(claudeSettingsPath(), original);

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.write!.afterContent).toBe(
      '{\n  "permissions": {\n    "allow": [\n      "Bash(git status)", // keep this comment\n      "mcp__pencil",\n      "mcp__forge614-engram"\n    ]\n  }\n}\n',
    );
  });

  test("creates the allow array when permissions exists without it", async () => {
    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { defaultMode: "dontAsk" } }));

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(JSON.parse(result.write!.afterContent)).toEqual({
      permissions: { defaultMode: "dontAsk", allow: ["mcp__forge614-engram"] },
    });
  });

  test("is a noop when the whole-server rule is already allowed", async () => {
    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { allow: [...TEN_RULES, "mcp__forge614-engram"] } }));

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "noop" });
    expect(result.write).toBeUndefined();
  });

  test("is a noop when the wildcard form is already allowed", async () => {
    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { allow: ["mcp__forge614-engram__*"] } }));

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "noop" });
  });

  test("does not treat a single-tool allow rule as approving the whole server", async () => {
    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { allow: ["mcp__forge614-engram__memory_get"] } }));

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    expect(JSON.parse(result.write!.afterContent).permissions.allow).toEqual([
      "mcp__forge614-engram__memory_get",
      "mcp__forge614-engram",
    ]);
  });

  test("is blocked when permissions.allow exists but is not an array", async () => {
    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { allow: "mcp__forge614-engram" } }));

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "blocked" });
    expect(result.blockedReason).toBe("allow-not-array");
    expect(result.write).toBeUndefined();
  });

  test("removes only the deny and ask rules that cover Engram, adds the allow rule and names what it removed", async () => {
    const original = JSON.stringify({
      permissions: {
        allow: TEN_RULES,
        deny: ["Bash(rm -rf:*)", "mcp__forge614-engram__memory_save", "mcp__notion__notion-update-page"],
        ask: ["mcp__forge614-engram", "Bash(git push:*)"],
      },
    });
    writeFileEnsuringDir(claudeSettingsPath(), original);

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    const written = JSON.parse(result.write!.afterContent);
    expect(written.permissions.deny).toEqual(["Bash(rm -rf:*)", "mcp__notion__notion-update-page"]);
    expect(written.permissions.ask).toEqual(["Bash(git push:*)"]);
    expect(written.permissions.allow).toEqual([...TEN_RULES, "mcp__forge614-engram"]);
    expect(result.notice).toBe(
      `Removed permissions.deny rule "mcp__forge614-engram__memory_save", permissions.ask rule "mcp__forge614-engram" from ${claudeSettingsPath()}: ` +
        "Claude Code evaluates deny and ask rules before allow rules, so they would keep the Engram tools blocked. " +
        'The approval is part of the Engram memory install; to turn it off, run "plan memory-remove --agent claude-code" and apply the plan.',
    );
  });

  test("still removes a covering deny rule when the allow rule is already there (write, not noop)", async () => {
    writeFileEnsuringDir(
      claudeSettingsPath(),
      JSON.stringify({ permissions: { allow: ["mcp__forge614-engram"], deny: ["mcp__forge614-engram__*"] } }),
    );

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    expect(JSON.parse(result.write!.afterContent).permissions).toEqual({ allow: ["mcp__forge614-engram"], deny: [] });
    expect(result.notice).toContain('permissions.deny rule "mcp__forge614-engram__*"');
  });

  test("builds on a seed instead of the disk content, but hashes the disk content", async () => {
    const onDisk = JSON.stringify({ theme: "dark" });
    writeFileEnsuringDir(claudeSettingsPath(), onDisk);
    const seeded = JSON.stringify({ theme: "dark", hooks: { SessionStart: [{ hooks: [{ type: "command", command: "x" }] }] } });

    const result = await decideToolApprovalInstall(claudeCodeAdapter, home, SERVER, { raw: seeded });

    const written = JSON.parse(result.write!.afterContent);
    expect(written.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: "x" }] }]);
    expect(written.permissions.allow).toEqual(["mcp__forge614-engram"]);
    expect(result.write!.beforeHash).toBe(sha256(onDisk));
  });
});

describe("decideToolApprovalInstall — Codex", () => {
  const ENTRY = '[mcp_servers.forge614-engram]\ncommand = "/bin/engram"\nargs = ["mcp"]\n';

  test("adds approve, without any notice, when the key is absent", async () => {
    writeFileEnsuringDir(codexConfigPath(), `model = "gpt-5"\n\n${ENTRY}`);

    const result = await decideToolApprovalInstall(codexAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    expect(result.notice).toBeUndefined();
    expect(parseToml(result.write!.afterContent)).toEqual({
      model: "gpt-5",
      mcp_servers: { "forge614-engram": { command: "/bin/engram", args: ["mcp"], default_tools_approval_mode: "approve" } },
    });
  });

  test("changes prompt to approve and says what it changed", async () => {
    writeFileEnsuringDir(codexConfigPath(), `${ENTRY}default_tools_approval_mode = "prompt"\n`);

    const result = await decideToolApprovalInstall(codexAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    expect(
      (parseToml(result.write!.afterContent) as { mcp_servers: Record<string, Record<string, unknown>> }).mcp_servers["forge614-engram"]!
        .default_tools_approval_mode,
    ).toBe("approve");
    expect(result.notice).toBe(
      `Changed default_tools_approval_mode of [mcp_servers.forge614-engram] in ${codexConfigPath()} from "prompt" to "approve" ` +
        'so Codex never asks to approve the Engram tools (with approval_policy = "never" a tool that asks is denied). ' +
        'The approval is part of the Engram memory install; to turn it off, run "plan memory-remove --agent codex" and apply the plan.',
    );
  });

  test("is a noop when the key is already approve", async () => {
    writeFileEnsuringDir(codexConfigPath(), `${ENTRY}default_tools_approval_mode = "approve"\n`);

    const result = await decideToolApprovalInstall(codexAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "noop" });
    expect(result.write).toBeUndefined();
  });

  test("builds on a seed that already carries the MCP entry", async () => {
    writeFileEnsuringDir(codexConfigPath(), 'model = "gpt-5"\n');

    const result = await decideToolApprovalInstall(codexAdapter, home, SERVER, { raw: `model = "gpt-5"\n\n${ENTRY}` });

    expect(parseToml(result.write!.afterContent)).toEqual({
      model: "gpt-5",
      mcp_servers: { "forge614-engram": { command: "/bin/engram", args: ["mcp"], default_tools_approval_mode: "approve" } },
    });
  });
});

describe("decideToolApprovalInstall — unsupported agent", () => {
  test("is blocked as unsupported for an adapter without toolApproval (Cursor)", async () => {
    const result = await decideToolApprovalInstall(cursorAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "blocked" });
    expect(result.blockedReason).toBe("unsupported");
  });
});

describe("decideToolApprovalRemove", () => {
  test("Claude: removes every Engram allow rule form (server, wildcard, single tool) and nothing else", async () => {
    const original = JSON.stringify({
      permissions: {
        allow: [
          "mcp__forge614-engram",
          ...TEN_RULES.slice(0, 5),
          "mcp__forge614-engram__*",
          ...TEN_RULES.slice(5),
          "mcp__forge614-engram__memory_save",
          "mcp__forge614-engram-other",
        ],
      },
      theme: "dark",
    });
    writeFileEnsuringDir(claudeSettingsPath(), original);

    const result = await decideToolApprovalRemove(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "write" });
    expect(JSON.parse(result.write!.afterContent)).toEqual({
      permissions: { allow: [...TEN_RULES, "mcp__forge614-engram-other"] },
      theme: "dark",
    });
  });

  test("Claude: leaves an empty allow array when the only rule was ours", async () => {
    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { allow: ["mcp__forge614-engram"] } }));

    const result = await decideToolApprovalRemove(claudeCodeAdapter, home, SERVER);

    expect(JSON.parse(result.write!.afterContent)).toEqual({ permissions: { allow: [] } });
  });

  test("Claude: is a noop when no Engram rule is present", async () => {
    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { allow: TEN_RULES } }));

    const result = await decideToolApprovalRemove(claudeCodeAdapter, home, SERVER);

    expect(result.decision).toEqual({ kind: "noop" });
  });

  test("Codex: removes only the approval key, and only when it is approve", async () => {
    writeFileEnsuringDir(
      codexConfigPath(),
      '[mcp_servers.forge614-engram]\ncommand = "/bin/engram"\nargs = ["mcp"]\ndefault_tools_approval_mode = "approve"\n',
    );
    const removed = await decideToolApprovalRemove(codexAdapter, home, SERVER);
    expect(removed.decision).toEqual({ kind: "write" });
    expect(parseToml(removed.write!.afterContent)).toEqual({
      mcp_servers: { "forge614-engram": { command: "/bin/engram", args: ["mcp"] } },
    });

    writeFileEnsuringDir(
      codexConfigPath(),
      '[mcp_servers.forge614-engram]\ncommand = "/bin/engram"\ndefault_tools_approval_mode = "prompt"\n',
    );
    const untouched = await decideToolApprovalRemove(codexAdapter, home, SERVER);
    expect(untouched.decision).toEqual({ kind: "noop" });
  });
});

describe("readToolApprovalState", () => {
  test("Claude: present only with a whole-server allow rule", async () => {
    expect(await readToolApprovalState(claudeCodeAdapter, home, SERVER)).toEqual({
      supported: true,
      path: claudeSettingsPath(),
      present: false,
    });

    writeFileEnsuringDir(claudeSettingsPath(), JSON.stringify({ permissions: { allow: ["mcp__forge614-engram__*"] } }));
    expect((await readToolApprovalState(claudeCodeAdapter, home, SERVER)).present).toBe(true);
  });

  test("Codex: present only when the key is approve", async () => {
    writeFileEnsuringDir(codexConfigPath(), '[mcp_servers.forge614-engram]\ncommand = "x"\ndefault_tools_approval_mode = "writes"\n');
    expect((await readToolApprovalState(codexAdapter, home, SERVER)).present).toBe(false);

    writeFileEnsuringDir(codexConfigPath(), '[mcp_servers.forge614-engram]\ncommand = "x"\ndefault_tools_approval_mode = "approve"\n');
    expect((await readToolApprovalState(codexAdapter, home, SERVER)).present).toBe(true);
  });

  test("Cursor: not supported", async () => {
    expect(await readToolApprovalState(cursorAdapter, home, SERVER)).toEqual({ supported: false, path: "", present: false });
  });
});
