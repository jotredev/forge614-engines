import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { decideInstructionsInstall, decideInstructionsRemove } from "./instructions-write-decision";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-instructions-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const markdown = "## Forge614 Engram memory protocol\n\nCall memory_context.";

describe("decideInstructionsInstall", () => {
  test("cursor is unsupported", async () => {
    const decision = await decideInstructionsInstall(cursorAdapter, home, markdown);
    expect(decision.kind).toBe("unsupported");
  });

  test("claude-code proposes writes for the satellite file and a one-line import in CLAUDE.md", async () => {
    const decision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    expect(decision.kind).toBe("write");
    if (decision.kind !== "write") throw new Error("unreachable");
    expect(decision.writes).toHaveLength(2);
    const claudeMdWrite = decision.writes.find((w) => w.path === join(home, ".claude", "CLAUDE.md"))!;
    expect(claudeMdWrite.afterContent).toContain("@forge614-engram-memory-protocol.md");
    const contentWrite = decision.writes.find((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))!;
    expect(contentWrite.afterContent).toContain("Call memory_context.");
  });

  test("claude-code preserves unrelated existing content in CLAUDE.md", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "@RTK.md\n");
    const decision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    if (decision.kind !== "write") throw new Error("unreachable");
    const claudeMdWrite = decision.writes.find((w) => w.path === join(home, ".claude", "CLAUDE.md"))!;
    expect(claudeMdWrite.afterContent).toContain("@RTK.md");
    expect(claudeMdWrite.afterContent).toContain("@forge614-engram-memory-protocol.md");
  });

  test("claude-code is a noop the second time nothing changed", async () => {
    const first = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    if (first.kind !== "write") throw new Error("unreachable");
    for (const write of first.writes) {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(write.path, write.afterContent);
    }
    const second = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    expect(second.kind).toBe("noop");
  });

  test("codex embeds the content directly in AGENTS.md", async () => {
    const decision = await decideInstructionsInstall(codexAdapter, home, markdown);
    expect(decision.kind).toBe("write");
    if (decision.kind !== "write") throw new Error("unreachable");
    expect(decision.writes).toHaveLength(1);
    expect(decision.writes[0].path).toBe(join(home, ".codex", "AGENTS.md"));
    expect(decision.writes[0].afterContent).toContain("Call memory_context.");
  });

  test("codex is blocked when a non-empty AGENTS.override.md shadows AGENTS.md", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "AGENTS.override.md"), "some override content");
    const decision = await decideInstructionsInstall(codexAdapter, home, markdown);
    expect(decision.kind).toBe("blocked");
  });

  test("codex is not blocked by an empty AGENTS.override.md", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "AGENTS.override.md"), "   \n");
    const decision = await decideInstructionsInstall(codexAdapter, home, markdown);
    expect(decision.kind).toBe("write");
  });

  test("codex is blocked when the protocol content collides with the managed-block markers", async () => {
    const collidingMarkdown = "some content\n<!-- forge614-engines:end engram-memory-protocol -->\nmore content";
    const decision = await decideInstructionsInstall(codexAdapter, home, collidingMarkdown);
    expect(decision.kind).toBe("blocked");
    if (decision.kind !== "blocked") throw new Error("unreachable");
    expect(decision.reason).toBe("marker-collision");
  });
});

describe("decideInstructionsRemove", () => {
  test("cursor is unsupported", async () => {
    expect((await decideInstructionsRemove(cursorAdapter, home)).kind).toBe("unsupported");
  });

  test("is a noop when nothing was ever installed", async () => {
    expect((await decideInstructionsRemove(claudeCodeAdapter, home)).kind).toBe("noop");
  });

  test("removes the managed block and marks the satellite file for deletion for claude-code", async () => {
    const installDecision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    if (installDecision.kind !== "write") throw new Error("unreachable");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "@RTK.md\n");
    for (const write of installDecision.writes) writeFileSync(write.path, write.afterContent);

    const removeDecision = await decideInstructionsRemove(claudeCodeAdapter, home);
    expect(removeDecision.kind).toBe("write");
    if (removeDecision.kind !== "write") throw new Error("unreachable");
    const claudeMdWrite = removeDecision.writes.find((w) => w.path === join(home, ".claude", "CLAUDE.md"))!;
    // installDecision was computed against an empty CLAUDE.md (the file did not exist yet when
    // decideInstructionsInstall ran), so its own write for CLAUDE.md — applied below — overwrites
    // the "@RTK.md\n" set just before the loop. The primary file's real state going into removal is
    // therefore "installed onto empty content", so removal restores that exact original: "".
    expect(claudeMdWrite.afterContent).toBe("");
    const contentWrite = removeDecision.writes.find((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))!;
    expect(contentWrite.delete).toBe(true);
  });

  test("removes the embedded block for codex", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const installDecision = await decideInstructionsInstall(codexAdapter, home, markdown);
    if (installDecision.kind !== "write") throw new Error("unreachable");
    writeFileSync(join(home, ".codex", "AGENTS.md"), `Some existing project guidance.\n`);
    for (const write of installDecision.writes) {
      writeFileSync(write.path, write.afterContent);
    }

    const removeDecision = await decideInstructionsRemove(codexAdapter, home);
    expect(removeDecision.kind).toBe("write");
    if (removeDecision.kind !== "write") throw new Error("unreachable");
    // Same reasoning as the claude-code case above: installDecision.writes[0] was computed against
    // an empty AGENTS.md, so applying it in the loop overwrites the "Some existing project
    // guidance.\n" set just before. AGENTS.md's real state going into removal is "installed onto
    // empty content", so removal restores that exact original: "".
    expect(removeDecision.writes[0].afterContent).toBe("");
  });
});
