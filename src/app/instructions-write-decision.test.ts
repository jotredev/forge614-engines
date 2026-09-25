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

  // D5: Claude Code embeds the manual directly, the same as Codex — no more satellite file.
  test("claude-code embeds the manual directly in CLAUDE.md, same as Codex", async () => {
    const decision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    expect(decision.kind).toBe("write");
    if (decision.kind !== "write") throw new Error("unreachable");
    expect(decision.writes).toHaveLength(1);
    expect(decision.writes[0].path).toBe(join(home, ".claude", "CLAUDE.md"));
    expect(decision.writes[0].afterContent).toContain("Call memory_context.");
  });

  test("claude-code preserves unrelated existing content in CLAUDE.md", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "@RTK.md\n");
    const decision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    if (decision.kind !== "write") throw new Error("unreachable");
    const claudeMdWrite = decision.writes.find((w) => w.path === join(home, ".claude", "CLAUDE.md"))!;
    expect(claudeMdWrite.afterContent).toContain("@RTK.md");
    expect(claudeMdWrite.afterContent).toContain("Call memory_context.");
  });

  describe("D5 migration: a legacy '@<file>' satellite reference on disk", () => {
    const MANAGED_HEADER = "<!-- Managed by Forge614 Engines. Do not edit by hand; changes are overwritten on the next apply. -->";
    const BEGIN = "<!-- forge614-engines:begin engram-memory-protocol -->";
    const END = "<!-- forge614-engines:end engram-memory-protocol -->";
    const legacyClaudeMd = `${BEGIN}\n@forge614-engram-memory-protocol.md\n${END}\n`;

    test("replaces the reference block with the embedded manual and deletes the satellite when it carries Engines' own managed-header marker", async () => {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".claude", "CLAUDE.md"), legacyClaudeMd);
      writeFileSync(join(home, ".claude", "forge614-engram-memory-protocol.md"), `${MANAGED_HEADER}\n\nOld manual text.`);

      const decision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);

      expect(decision.kind).toBe("write");
      if (decision.kind !== "write") throw new Error("unreachable");
      expect(decision.notice).toBeUndefined();
      const claudeMdWrite = decision.writes.find((w) => w.path === join(home, ".claude", "CLAUDE.md"))!;
      expect(claudeMdWrite.afterContent).toContain("Call memory_context.");
      expect(claudeMdWrite.afterContent).not.toContain("@forge614-engram-memory-protocol.md");
      const satelliteWrite = decision.writes.find((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))!;
      expect(satelliteWrite.delete).toBe(true);
    });

    test("leaves a hand-authored satellite file untouched and reports a notice instead of deleting it", async () => {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".claude", "CLAUDE.md"), legacyClaudeMd);
      writeFileSync(join(home, ".claude", "forge614-engram-memory-protocol.md"), "My own private notes about Engram, written by hand.");

      const decision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);

      expect(decision.kind).toBe("write");
      if (decision.kind !== "write") throw new Error("unreachable");
      expect(decision.writes.some((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))).toBe(false);
      expect(decision.notice).toContain(join(home, ".claude", "forge614-engram-memory-protocol.md"));
    });

    test("migrates cleanly, with no notice, when the referenced satellite file is already gone", async () => {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".claude", "CLAUDE.md"), legacyClaudeMd);
      // No satellite file written at all.

      const decision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);

      expect(decision.kind).toBe("write");
      if (decision.kind !== "write") throw new Error("unreachable");
      expect(decision.notice).toBeUndefined();
      expect(decision.writes.some((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))).toBe(false);
    });
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

  test("removes the embedded block for claude-code (D5: same shape as codex, no satellite file)", async () => {
    const installDecision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    if (installDecision.kind !== "write") throw new Error("unreachable");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "@RTK.md\n");
    for (const write of installDecision.writes) writeFileSync(write.path, write.afterContent);

    const removeDecision = await decideInstructionsRemove(claudeCodeAdapter, home);
    expect(removeDecision.kind).toBe("write");
    if (removeDecision.kind !== "write") throw new Error("unreachable");
    expect(removeDecision.writes).toHaveLength(1);
    // installDecision was computed against an empty CLAUDE.md (the file did not exist yet when
    // decideInstructionsInstall ran), so its own write for CLAUDE.md — applied below — overwrites
    // the "@RTK.md\n" set just before the loop. The primary file's real state going into removal is
    // therefore "installed onto empty content", so removal restores that exact original: "".
    expect(removeDecision.writes[0].afterContent).toBe("");
  });

  test("D5 migration: removal also deletes a legacy satellite it can prove is its own, and warns instead when it cannot", async () => {
    const MANAGED_HEADER = "<!-- Managed by Forge614 Engines. Do not edit by hand; changes are overwritten on the next apply. -->";
    const legacyClaudeMd =
      "<!-- forge614-engines:begin engram-memory-protocol -->\n@forge614-engram-memory-protocol.md\n<!-- forge614-engines:end engram-memory-protocol -->\n";
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), legacyClaudeMd);
    writeFileSync(join(home, ".claude", "forge614-engram-memory-protocol.md"), `${MANAGED_HEADER}\n\nOld manual text.`);

    const provable = await decideInstructionsRemove(claudeCodeAdapter, home);
    expect(provable.kind).toBe("write");
    if (provable.kind !== "write") throw new Error("unreachable");
    expect(provable.notice).toBeUndefined();
    const satelliteWrite = provable.writes.find((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))!;
    expect(satelliteWrite.delete).toBe(true);

    writeFileSync(join(home, ".claude", "CLAUDE.md"), legacyClaudeMd);
    writeFileSync(join(home, ".claude", "forge614-engram-memory-protocol.md"), "Hand-authored notes, not Engines' own.");

    const unprovable = await decideInstructionsRemove(claudeCodeAdapter, home);
    if (unprovable.kind !== "write") throw new Error("unreachable");
    expect(unprovable.writes.some((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))).toBe(false);
    expect(unprovable.notice).toContain(join(home, ".claude", "forge614-engram-memory-protocol.md"));
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
