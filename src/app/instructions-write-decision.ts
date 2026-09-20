import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import type { AgentAdapter } from "../modules/agents/types";
import { extractBlock, withBlock } from "../modules/instructions-writer/block";
import { MEMORY_PROTOCOL_BLOCK_ID } from "../modules/memory-protocol/constants";
import type { PlanWrite } from "../modules/config-writer/types";

const MANAGED_HEADER =
  "<!-- Managed by Forge614 Engines. Do not edit by hand; changes are overwritten on the next apply. -->";

export type InstructionsDecision =
  | { kind: "unsupported"; reason: string }
  | { kind: "noop" }
  | { kind: "write"; writes: PlanWrite[] }
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
    if (extractBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID) !== desiredBlock) {
      writes.push({
        path: primaryPath,
        beforeHash: hashOf(primary.raw),
        afterContent: withBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID, desiredBlock),
      });
    }
  }

  return writes.length === 0 ? { kind: "noop" } : { kind: "write", writes };
}

export async function decideInstructionsRemove(adapter: AgentAdapter, home: string): Promise<InstructionsDecision> {
  const target = adapter.instructions;
  if (!target) return { kind: "unsupported", reason: `${adapter.label} has no managed instructions to remove` };

  const primaryPath = target.primaryFile(home);
  const primary = await readOrEmpty(primaryPath);
  if (extractBlock(primary.raw, MEMORY_PROTOCOL_BLOCK_ID) === undefined) return { kind: "noop" };

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
  }

  return { kind: "write", writes };
}
