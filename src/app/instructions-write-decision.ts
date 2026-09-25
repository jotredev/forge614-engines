import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import type { AgentAdapter } from "../modules/agents/types";
import { blockMarkers, extractBlock, withBlock } from "../modules/instructions-writer/block";
import { MEMORY_PROTOCOL_BLOCK_ID } from "../modules/memory-protocol/constants";
import type { PlanWrite } from "../modules/config-writer/types";

const MANAGED_HEADER =
  "<!-- Managed by Forge614 Engines. Do not edit by hand; changes are overwritten on the next apply. -->";

export type InstructionsDecision =
  | { kind: "unsupported"; reason: string }
  | { kind: "noop" }
  | { kind: "write"; writes: PlanWrite[]; notice?: string }
  | { kind: "blocked"; reason: string; details: string };

async function readOrEmpty(path: string): Promise<{ raw: string; exists: boolean }> {
  try {
    return { raw: await readFile(path, "utf8"), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "", exists: false };
    throw error;
  }
}

function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// D5: an agent that no longer declares a contentFile (Claude Code, as of this change — see
// claude-code.ts) may still carry a pre-D5 "@<file>" reference block on disk, pointing at a
// satellite instructions file. matches that shape so the embed path below can migrate it.
const SATELLITE_REFERENCE_PATTERN = /^@(.+)$/;

/**
 * D5 migration: when a block being replaced or removed turns out to be a legacy "@<file>"
 * satellite reference, decides what becomes of that satellite file. It is deleted only when
 * Engines can prove it wrote it — its content starts with the exact MANAGED_HEADER marker every
 * satellite file Engines ever wrote always carried. Content Engines cannot vouch for (hand-authored,
 * hand-edited past recognition, or simply a coincidentally-named file) is left in place and reported
 * as a notice instead: never a failure, and never silently destroyed on the strength of a stale
 * block pointing at it.
 */
async function resolveLegacySatellite(currentBlock: string | undefined, primaryPath: string): Promise<{ write?: PlanWrite; notice?: string }> {
  const match = currentBlock?.match(SATELLITE_REFERENCE_PATTERN);
  if (!match) return {};
  const satellitePath = join(dirname(primaryPath), match[1]!);
  const satellite = await readOrEmpty(satellitePath);
  if (!satellite.exists) return {};
  if (satellite.raw.startsWith(MANAGED_HEADER)) {
    return { write: { path: satellitePath, beforeHash: hashOf(satellite.raw), afterContent: "", delete: true } };
  }
  return {
    notice: `A legacy satellite instructions file at ${satellitePath} could not be confirmed as Engines' own (it does not start with Engines' managed-header marker) and was left in place; delete it manually if it is no longer needed.`,
  };
}

export async function decideInstructionsInstall(
  adapter: AgentAdapter,
  home: string,
  protocolMarkdown: string,
): Promise<InstructionsDecision> {
  const target = adapter.instructions;
  if (!target) {
    return {
      kind: "unsupported",
      reason: `${adapter.label} has no officially supported mechanism to load global instructions automatically in new sessions`,
    };
  }

  for (const shadowPath of target.shadowingFiles(home)) {
    const shadow = await readOrEmpty(shadowPath);
    if (shadow.exists && shadow.raw.trim().length > 0) {
      return {
        kind: "blocked",
        reason: "shadowed",
        details: `${shadowPath} exists and takes priority, so ${adapter.label} would never read the managed instructions`,
      };
    }
  }

  const primaryPath = target.primaryFile(home);
  const primary = await readOrEmpty(primaryPath);
  const writes: PlanWrite[] = [];

  if (target.contentFile) {
    const contentPath = target.contentFile(home);
    const desiredContent = `${MANAGED_HEADER}\n\n${protocolMarkdown}`;
    const current = await readOrEmpty(contentPath);
    if (current.raw !== desiredContent) {
      writes.push({ path: contentPath, beforeHash: hashOf(current.raw), afterContent: desiredContent });
    }

    const desiredBlock = `@${basename(contentPath)}`;
    if (extractBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID) !== desiredBlock) {
      writes.push({
        path: primaryPath,
        beforeHash: hashOf(primary.raw),
        afterContent: withBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID, desiredBlock),
      });
    }
  } else {
    const desiredBlock = `${MANAGED_HEADER}\n\n${protocolMarkdown}`.trim();
    // The block is embedded directly between markers in the primary file. If the content itself
    // contained either marker, block.ts's indexOf-based lookup would terminate the block early and
    // strand the remainder outside any marker — permanently unremovable. Refuse to write instead.
    const { begin, end } = blockMarkers(MEMORY_PROTOCOL_BLOCK_ID);
    if (desiredBlock.includes(begin) || desiredBlock.includes(end)) {
      return {
        kind: "blocked",
        reason: "marker-collision",
        details: `The memory protocol's content contains a string that collides with ${adapter.label}'s managed-block markers, so it cannot be safely embedded in ${primaryPath}`,
      };
    }
    const currentBlock = extractBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID);
    if (currentBlock !== desiredBlock) {
      writes.push({
        path: primaryPath,
        beforeHash: hashOf(primary.raw),
        afterContent: withBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID, desiredBlock),
      });
      // D5: currentBlock may be a pre-migration "@<file>" reference (this agent used to have a
      // contentFile, or one day will lose it the way Claude Code just did) — resolve its satellite
      // file's fate alongside the block rewrite.
      const legacy = await resolveLegacySatellite(currentBlock, primaryPath);
      if (legacy.write) writes.push(legacy.write);
      if (legacy.notice) return { kind: "write", writes, notice: legacy.notice };
    }
  }

  return writes.length === 0 ? { kind: "noop" } : { kind: "write", writes };
}

export async function decideInstructionsRemove(adapter: AgentAdapter, home: string): Promise<InstructionsDecision> {
  const target = adapter.instructions;
  if (!target) return { kind: "unsupported", reason: `${adapter.label} has no managed instructions to remove` };

  const primaryPath = target.primaryFile(home);
  const primary = await readOrEmpty(primaryPath);
  const currentBlock = extractBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID);
  if (currentBlock === undefined) return { kind: "noop" };

  const writes: PlanWrite[] = [
    {
      path: primaryPath,
      beforeHash: hashOf(primary.raw),
      afterContent: withBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID, undefined),
    },
  ];

  if (target.contentFile) {
    const contentPath = target.contentFile(home);
    const content = await readOrEmpty(contentPath);
    if (content.exists) {
      writes.push({ path: contentPath, beforeHash: hashOf(content.raw), afterContent: "", delete: true });
    }
    return { kind: "write", writes };
  }

  // D5: this agent has no contentFile today, but the block being removed may still be a pre-D5
  // "@<file>" reference — same ownership-proof rule as the install/migration path.
  const legacy = await resolveLegacySatellite(currentBlock, primaryPath);
  if (legacy.write) writes.push(legacy.write);
  return { kind: "write", writes, ...(legacy.notice ? { notice: legacy.notice } : {}) };
}
