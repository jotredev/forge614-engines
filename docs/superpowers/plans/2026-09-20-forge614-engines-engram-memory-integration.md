# Forge614 Engram Memory Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Forge614 Engines plan, apply, verify, and cleanly retire a full "Forge614 Engram memory" integration (its public MCP server plus the universal memory protocol's instructions) for each of the three agents it already supports: Claude Code, Codex, and Cursor.

**Architecture:** Extend the existing plan/apply primitives (which are already generic file-write machinery) with one new write capability (delete) and one new plan action family (`memory-install`/`memory-remove`) that bundles an MCP-config decision and an instructions-file decision into a single coherent `Plan`. The protocol content itself is fetched fresh from `forge614-engram memory-protocol --json` on every install; nothing from Engram is copied by hand into this repository.

**Tech Stack:** TypeScript on Bun; `node:child_process`, `node:fs/promises`, `node:crypto`, `jsonc-parser`, `smol-toml` (already a dependency — no new dependencies).

**Spec:** `docs/superpowers/specs/2026-09-20-forge614-engines-engram-memory-integration-design.md`

## Global Constraints

- Never read or write `~/.forge614/engram/`, `engram.db`, `.env`, or any Engram-internal file. The only contact with Engram is spawning `forge614-engram memory-protocol --json` and reading its stdout.
- Never copy a hand-authored version of the protocol's `instructions`/`lifecycle` text into this repository. Engines only defines the *shape* (a TypeScript type + validator) of the JSON contract; the actual text always comes from a live command invocation.
- Never log, persist, or surface Engram's stderr content verbatim. On any protocol-fetch failure, use one of exactly four internal reason codes (`not-installed`, `command-failed`, `invalid-json`, `invalid-schema`) and one stable public error code, `ENGRAM_PROTOCOL_UNAVAILABLE`.
- `plan` operations are read-only and must never write a file. `apply` only ever applies a previously confirmed, persisted plan. This repository already enforces that split; do not blur it.
- Never remove or modify anything not bounded by a Forge614-owned marker or a Forge614-owned dedicated file. Never touch an unrecognized MCP entry — report `blocked`, do not guess.
- Do not add a `platform` parameter to any new config-path method — follow the existing convention (`configFile`/`configDir` are already platform-generic; only executable-discovery methods take `platform`).
- Do not add new Notion-mapped documentation pages. Extend the existing `docs/{es,en}/03,04,05,07-*.md` pages and refresh their fingerprints with `bun scripts/verify-documentation.mjs --refresh-fingerprints`.
- Preserve every existing public CLI behavior and error byte-for-byte: `plan mcp-install`, `plan mcp-remove`, `apply`, `capabilities`, `detect`, `update`, `headless` must keep passing their existing tests unmodified.
- Follow the existing layering rule (enforced by `tests/architecture/import-rules.test.ts`): `modules` < `infrastructure` < `app` < `interfaces`. A file may only import from its own layer or an earlier one.
- No release, tag, push, or publication of any kind as part of this plan.

---

## File Structure

New files:

- `src/modules/memory-protocol/types.ts` — `MemoryProtocol` type + `isMemoryProtocol` validator.
- `src/modules/memory-protocol/render.ts` — pure Markdown rendering of a `MemoryProtocol`.
- `src/modules/memory-protocol/constants.ts` — `ENGRAM_MCP_SERVER`, `MEMORY_PROTOCOL_BLOCK_ID`.
- `src/modules/memory-protocol/status.ts` — `computeOverallStatus`.
- `src/modules/instructions-writer/block.ts` — marker-delimited text block helpers.
- `src/infrastructure/engram/memory-protocol-client.ts` — spawns `forge614-engram memory-protocol --json`, validates, fingerprints.
- `src/app/mcp-write-decision.ts` — shared, non-throwing MCP install/remove decision helpers.
- `src/app/instructions-write-decision.ts` — shared, non-throwing instructions install/remove decision helpers.
- `src/app/plan-memory-install.ts` — `planMemoryInstall`.
- `src/app/plan-memory-remove.ts` — `planMemoryRemove`.
- `src/app/verify-memory-integration.ts` — `verifyMemoryIntegration`.

Modified files:

- `src/modules/agents/types.ts` — add `InstructionsTarget`, `AgentAdapter.instructions?`.
- `src/modules/config-writer/types.ts` — add `PlanWrite.delete?`, widen `Plan.action`, add `Plan.metadata?`, `MemoryIntegrationComponentStatus`, `MemoryIntegrationMetadata`.
- `src/infrastructure/config-io/atomic-write.ts` — add `atomicDelete`.
- `src/app/apply-plan.ts` — route `write.delete` through `atomicDelete`.
- `src/infrastructure/agents/claude-code.ts` — add `instructions` target (satellite file + import line).
- `src/infrastructure/agents/codex.ts` — add `instructions` target (embedded block + `AGENTS.override.md` shadow check).
- `src/infrastructure/agents/cursor.ts` — no functional change; a comment documents why `instructions` is intentionally absent.
- `src/app/plan-mcp-install.ts`, `src/app/plan-mcp-remove.ts` — refactor internals onto the new shared decision helpers, same external behavior.
- `src/interfaces/cli/commands.ts`, `src/interfaces/cli/main.ts` — new commands + error mapping.
- `scripts/verify-documentation.mjs` — recognize the new CLI subcommands.
- `docs/es/03-plan-seguro-de-mcp.md`, `docs/en/03-safe-mcp-planning.md`
- `docs/es/04-aplicacion-segura-y-recuperacion.md`, `docs/en/04-safe-application-and-recovery.md`
- `docs/es/05-referencia-del-cli-publico.md`, `docs/en/05-public-cli-reference.md`
- `docs/es/07-arquitectura-y-mapa-del-codigo.md`, `docs/en/07-architecture-and-code-map.md`
- `docs/notion-map.json` (fingerprints only, via the refresh script).

---

### Task 1: `PlanWrite.delete` + `atomicDelete`

**Files:**
- Modify: `src/modules/config-writer/types.ts`
- Modify: `src/infrastructure/config-io/atomic-write.ts`
- Modify: `src/infrastructure/config-io/atomic-write.test.ts`
- Modify: `src/app/apply-plan.ts`
- Modify: `src/app/apply-plan.test.ts`

**Interfaces:**
- Produces: `PlanWrite.delete?: boolean`; `atomicDelete(targetPath: string): Promise<AtomicWriteResult>`.

- [ ] **Step 1: Write the failing test for `atomicDelete`**

Append to `src/infrastructure/config-io/atomic-write.test.ts` (read the existing file first to match its exact imports/style):

```ts
describe("atomicDelete", () => {
  test("deletes an existing file and reports changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engines-atomicdelete-"));
    const target = join(dir, "file.txt");
    writeFileSync(target, "content");

    const result = await atomicDelete(target);

    expect(result.changed).toBe(true);
    expect(existsSync(target)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("is a noop when the file does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engines-atomicdelete-noop-"));
    const target = join(dir, "missing.txt");

    const result = await atomicDelete(target);

    expect(result.changed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

Add the needed imports at the top of the test file: `atomicDelete` from `./atomic-write`, and `existsSync`, `mkdtempSync`, `rmSync`, `writeFileSync` from `node:fs` (merge with any already-imported names rather than duplicating), plus `tmpdir` from `node:os` and `join` from `node:path` if not already present.

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/infrastructure/config-io/atomic-write.test.ts`
Expected: FAIL — `atomicDelete is not a function` (or a TypeScript error if `tsc` runs first; either way, it must not pass).

- [ ] **Step 3: Implement `atomicDelete`**

Append to `src/infrastructure/config-io/atomic-write.ts`:

```ts
export async function atomicDelete(targetPath: string): Promise<AtomicWriteResult> {
  try {
    await unlink(targetPath);
    return { changed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { changed: false };
    throw error;
  }
}
```

`unlink` is already imported at the top of this file from `node:fs/promises`; leave that import line as-is.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test src/infrastructure/config-io/atomic-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `delete` to `PlanWrite`**

In `src/modules/config-writer/types.ts`, change:

```ts
export interface PlanWrite {
  path: string;
  beforeHash: string;
  afterContent: string;
}
```

to:

```ts
export interface PlanWrite {
  path: string;
  beforeHash: string;
  afterContent: string;
  /** When true, apply removes the file instead of writing `afterContent` (which is then ignored, but kept as "" by convention). */
  delete?: boolean;
}
```

- [ ] **Step 6: Write the failing test for `applyPlan` deleting a file**

Append to `src/app/apply-plan.test.ts` (inside the existing `describe("applyPlan", ...)` block, matching its existing `hashOf` helper and `home`/`configPath` fixtures):

```ts
test("deletes a file when the write is marked delete", async () => {
  const deletedPath = join(home, "to-delete.md");
  writeFileSync(deletedPath, "old content");
  const plan: Plan = {
    planId: "plan-delete-1",
    agentId: "claude-code",
    action: "memory-remove",
    noop: false,
    writes: [{ path: deletedPath, beforeHash: hashOf("old content"), afterContent: "", delete: true }],
  };
  await savePlan(home, plan);

  const result = await applyPlan(home, "plan-delete-1");

  expect(result.changedFiles).toEqual([deletedPath]);
  expect(existsSync(deletedPath)).toBe(false);
});

test("refuses to delete when the file changed since the plan was computed", async () => {
  const deletedPath = join(home, "stale-delete.md");
  writeFileSync(deletedPath, "changed content");
  const plan: Plan = {
    planId: "plan-delete-2",
    agentId: "claude-code",
    action: "memory-remove",
    noop: false,
    writes: [{ path: deletedPath, beforeHash: hashOf("original content"), afterContent: "", delete: true }],
  };
  await savePlan(home, plan);

  await expect(applyPlan(home, "plan-delete-2")).rejects.toThrow(StalePlanError);
  expect(existsSync(deletedPath)).toBe(true);
});
```

Add `existsSync` to the existing `node:fs` import in that test file.

- [ ] **Step 7: Run it and confirm it fails**

Run: `bun test src/app/apply-plan.test.ts`
Expected: FAIL — the file still exists after apply (delete branch not implemented yet).

- [ ] **Step 8: Route deletes through `applyPlan`**

In `src/app/apply-plan.ts`, change the import line:

```ts
import { atomicWrite } from "../infrastructure/config-io/atomic-write";
```

to:

```ts
import { atomicDelete, atomicWrite } from "../infrastructure/config-io/atomic-write";
```

and change the write loop:

```ts
  const changedFiles: string[] = [];
  for (const write of plan.writes) {
    const result = await atomicWrite(write.path, write.afterContent);
    if (result.changed) changedFiles.push(write.path);
  }
```

to:

```ts
  const changedFiles: string[] = [];
  for (const write of plan.writes) {
    const result = write.delete ? await atomicDelete(write.path) : await atomicWrite(write.path, write.afterContent);
    if (result.changed) changedFiles.push(write.path);
  }
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `bun test src/app/apply-plan.test.ts src/infrastructure/config-io/atomic-write.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 10: Commit**

```bash
git add src/modules/config-writer/types.ts src/infrastructure/config-io/atomic-write.ts src/infrastructure/config-io/atomic-write.test.ts src/app/apply-plan.ts src/app/apply-plan.test.ts
git commit -m "feat: support deleting a file through apply-plan"
```

---

### Task 2: `MemoryProtocol` type and validator

**Files:**
- Create: `src/modules/memory-protocol/types.ts`
- Test: `src/modules/memory-protocol/types.test.ts`

**Interfaces:**
- Produces: `MemoryProtocol`, `MemoryProtocolLifecycle`, `MemoryProtocolScopes`, `MemoryProtocolSecurity`, `isMemoryProtocol(value: unknown): value is MemoryProtocol`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/memory-protocol/types.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { isMemoryProtocol, type MemoryProtocol } from "./types";

function validProtocol(): MemoryProtocol {
  return {
    id: "forge614-engram-memory",
    version: 1,
    instructions: "Use memory_context at the start of every session.",
    lifecycle: {
      start: ["Call memory_context."],
      save: ["Save explicit remember requests."],
      compact: ["Call memory_session_summary before compacting."],
      resume: ["Call memory_context after compaction."],
      end: ["Call memory_session_end."],
    },
    scopes: { shared: "Cross-client preferences.", project: "Repository-specific knowledge." },
    security: { neverSave: ["passwords", "tokens"] },
  };
}

describe("isMemoryProtocol", () => {
  test("accepts a well-formed protocol document", () => {
    expect(isMemoryProtocol(validProtocol())).toBe(true);
  });

  test("rejects a wrong id", () => {
    expect(isMemoryProtocol({ ...validProtocol(), id: "something-else" })).toBe(false);
  });

  test("rejects a wrong version", () => {
    expect(isMemoryProtocol({ ...validProtocol(), version: 2 })).toBe(false);
  });

  test("rejects a missing lifecycle key", () => {
    const protocol = validProtocol();
    // @ts-expect-error deliberately malformed for the test
    delete protocol.lifecycle.compact;
    expect(isMemoryProtocol(protocol)).toBe(false);
  });

  test("rejects a lifecycle array containing a non-string", () => {
    const protocol = validProtocol();
    // @ts-expect-error deliberately malformed for the test
    protocol.lifecycle.start = [1, 2];
    expect(isMemoryProtocol(protocol)).toBe(false);
  });

  test("rejects null and non-objects", () => {
    expect(isMemoryProtocol(null)).toBe(false);
    expect(isMemoryProtocol("a string")).toBe(false);
    expect(isMemoryProtocol(42)).toBe(false);
  });

  test("rejects empty instructions", () => {
    expect(isMemoryProtocol({ ...validProtocol(), instructions: "" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/modules/memory-protocol/types.test.ts`
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 3: Implement the type and validator**

Create `src/modules/memory-protocol/types.ts`:

```ts
export interface MemoryProtocolLifecycle {
  start: string[];
  save: string[];
  compact: string[];
  resume: string[];
  end: string[];
}

export interface MemoryProtocolScopes {
  shared: string;
  project: string;
}

export interface MemoryProtocolSecurity {
  neverSave: string[];
}

export interface MemoryProtocol {
  id: "forge614-engram-memory";
  version: 1;
  instructions: string;
  lifecycle: MemoryProtocolLifecycle;
  scopes: MemoryProtocolScopes;
  security: MemoryProtocolSecurity;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const LIFECYCLE_KEYS = ["start", "save", "compact", "resume", "end"] as const;

export function isMemoryProtocol(value: unknown): value is MemoryProtocol {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.id !== "forge614-engram-memory") return false;
  if (candidate.version !== 1) return false;
  if (typeof candidate.instructions !== "string" || candidate.instructions.length === 0) return false;

  const lifecycle = candidate.lifecycle;
  if (typeof lifecycle !== "object" || lifecycle === null) return false;
  const lifecycleRecord = lifecycle as Record<string, unknown>;
  for (const key of LIFECYCLE_KEYS) {
    if (!isStringArray(lifecycleRecord[key])) return false;
  }

  const scopes = candidate.scopes;
  if (typeof scopes !== "object" || scopes === null) return false;
  const scopesRecord = scopes as Record<string, unknown>;
  if (typeof scopesRecord.shared !== "string" || typeof scopesRecord.project !== "string") return false;

  const security = candidate.security;
  if (typeof security !== "object" || security === null) return false;
  if (!isStringArray((security as Record<string, unknown>).neverSave)) return false;

  return true;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test src/modules/memory-protocol/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory-protocol/types.ts src/modules/memory-protocol/types.test.ts
git commit -m "feat: define and validate the Engram memory protocol shape"
```

---

### Task 3: Protocol Markdown renderer

**Files:**
- Create: `src/modules/memory-protocol/render.ts`
- Test: `src/modules/memory-protocol/render.test.ts`

**Interfaces:**
- Consumes: `MemoryProtocol` from Task 2.
- Produces: `renderProtocolMarkdown(protocol: MemoryProtocol): string` — deterministic (same input always produces the same output, byte for byte).

- [ ] **Step 1: Write the failing test**

Create `src/modules/memory-protocol/render.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MemoryProtocol } from "./types";
import { renderProtocolMarkdown } from "./render";

const protocol: MemoryProtocol = {
  id: "forge614-engram-memory",
  version: 1,
  instructions: "Call memory_context at the start of a conversation.",
  lifecycle: {
    start: ["Call memory_context."],
    save: ["Save explicit remember requests."],
    compact: ["Call memory_session_summary before compacting."],
    resume: ["Call memory_context after compaction."],
    end: ["Call memory_session_end."],
  },
  scopes: { shared: "Cross-client preferences.", project: "Repository-specific knowledge." },
  security: { neverSave: ["passwords", "tokens"] },
};

describe("renderProtocolMarkdown", () => {
  test("includes the protocol id, version, and instructions verbatim", () => {
    const markdown = renderProtocolMarkdown(protocol);
    expect(markdown).toContain("forge614-engram-memory");
    expect(markdown).toContain("version 1");
    expect(markdown).toContain("Call memory_context at the start of a conversation.");
  });

  test("includes every lifecycle phase and every security rule", () => {
    const markdown = renderProtocolMarkdown(protocol);
    for (const phase of ["Start", "Save", "Compact", "Resume", "End"]) {
      expect(markdown).toContain(phase);
    }
    expect(markdown).toContain("Call memory_session_summary before compacting.");
    expect(markdown).toContain("passwords");
    expect(markdown).toContain("tokens");
  });

  test("is deterministic for the same input", () => {
    expect(renderProtocolMarkdown(protocol)).toBe(renderProtocolMarkdown(protocol));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/modules/memory-protocol/render.test.ts`
Expected: FAIL — cannot find module `./render`.

- [ ] **Step 3: Implement the renderer**

Create `src/modules/memory-protocol/render.ts`:

```ts
import type { MemoryProtocol } from "./types";

function section(title: string, lines: string[]): string {
  return [`### ${title}`, "", ...lines.map((line) => `- ${line}`)].join("\n");
}

export function renderProtocolMarkdown(protocol: MemoryProtocol): string {
  return [
    "## Forge614 Engram memory protocol",
    "",
    `Protocol: ${protocol.id} (version ${protocol.version})`,
    "",
    protocol.instructions,
    "",
    "## Lifecycle",
    "",
    section("Start", protocol.lifecycle.start),
    "",
    section("Save", protocol.lifecycle.save),
    "",
    section("Compact", protocol.lifecycle.compact),
    "",
    section("Resume", protocol.lifecycle.resume),
    "",
    section("End", protocol.lifecycle.end),
    "",
    "## Scopes",
    "",
    `- Shared: ${protocol.scopes.shared}`,
    `- Project: ${protocol.scopes.project}`,
    "",
    "## Security",
    "",
    ...protocol.security.neverSave.map((item) => `- Never save: ${item}`),
  ].join("\n");
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test src/modules/memory-protocol/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory-protocol/render.ts src/modules/memory-protocol/render.test.ts
git commit -m "feat: render the Engram memory protocol as deterministic Markdown"
```

---

### Task 4: Protocol constants and overall-status helper

**Files:**
- Create: `src/modules/memory-protocol/constants.ts`
- Create: `src/modules/memory-protocol/status.ts`
- Test: `src/modules/memory-protocol/status.test.ts`

**Interfaces:**
- Consumes: `MemoryIntegrationComponentStatus` (defined in this task, in `src/modules/config-writer/types.ts` — see Step 3).
- Produces: `ENGRAM_MCP_SERVER: McpServerDefinition`; `MEMORY_PROTOCOL_BLOCK_ID: string`; `computeOverallStatus(mcp, instructions): "complete" | "partial" | "unsupported"`.

- [ ] **Step 1: Add the component-status and metadata types**

In `src/modules/config-writer/types.ts`, add (below the existing `PlanWrite`/`Plan` definitions, before `ConfigConflictError`):

```ts
export type MemoryIntegrationComponentStatus =
  | { kind: "unsupported"; reason: string }
  | { kind: "noop" }
  | { kind: "write" }
  | { kind: "blocked"; reason: string; details: string };

export type MemoryIntegrationOverallStatus = "complete" | "partial" | "unsupported";

export interface MemoryIntegrationMetadata {
  protocol?: { source: string; id: string; version: number; fingerprint: string };
  mcp: { path: string; status: MemoryIntegrationComponentStatus };
  instructions: { paths: string[]; status: MemoryIntegrationComponentStatus };
  overallStatus: MemoryIntegrationOverallStatus;
}
```

Then widen `Plan`:

```ts
export interface Plan {
  planId: string;
  agentId: string;
  action: "mcp-install" | "mcp-remove" | "memory-install" | "memory-remove";
  noop: boolean;
  writes: PlanWrite[];
  metadata?: MemoryIntegrationMetadata;
}
```

- [ ] **Step 2: Write the failing test for `computeOverallStatus`**

Create `src/modules/memory-protocol/status.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MemoryIntegrationComponentStatus } from "../config-writer/types";
import { computeOverallStatus } from "./status";

const noop: MemoryIntegrationComponentStatus = { kind: "noop" };
const write: MemoryIntegrationComponentStatus = { kind: "write" };
const blocked: MemoryIntegrationComponentStatus = { kind: "blocked", reason: "x", details: "x" };
const unsupported: MemoryIntegrationComponentStatus = { kind: "unsupported", reason: "x" };

describe("computeOverallStatus", () => {
  test("is complete when both components are noop or write", () => {
    expect(computeOverallStatus(noop, write)).toBe("complete");
    expect(computeOverallStatus(write, noop)).toBe("complete");
  });

  test("is partial when only one component is ok", () => {
    expect(computeOverallStatus(write, unsupported)).toBe("partial");
    expect(computeOverallStatus(blocked, noop)).toBe("partial");
  });

  test("is unsupported when neither component is ok", () => {
    expect(computeOverallStatus(blocked, unsupported)).toBe("unsupported");
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun test src/modules/memory-protocol/status.test.ts`
Expected: FAIL — cannot find module `./status`.

- [ ] **Step 4: Implement `computeOverallStatus` and the constants**

Create `src/modules/memory-protocol/status.ts`:

```ts
import type { MemoryIntegrationComponentStatus, MemoryIntegrationOverallStatus } from "../config-writer/types";

function isOk(status: MemoryIntegrationComponentStatus): boolean {
  return status.kind === "noop" || status.kind === "write";
}

export function computeOverallStatus(
  mcp: MemoryIntegrationComponentStatus,
  instructions: MemoryIntegrationComponentStatus,
): MemoryIntegrationOverallStatus {
  const mcpOk = isOk(mcp);
  const instructionsOk = isOk(instructions);
  if (mcpOk && instructionsOk) return "complete";
  if (!mcpOk && !instructionsOk) return "unsupported";
  return "partial";
}
```

Create `src/modules/memory-protocol/constants.ts`:

```ts
import type { McpServerDefinition } from "../agents/types";

export const ENGRAM_MCP_SERVER: McpServerDefinition = {
  name: "engram",
  command: "forge614-engram",
  args: ["mcp"],
};

export const MEMORY_PROTOCOL_BLOCK_ID = "engram-memory-protocol";
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test src/modules/memory-protocol/status.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors (this confirms the `Plan`/`PlanWrite` widening in Step 1 didn't break `plan-mcp-install.ts`, `plan-mcp-remove.ts`, or `apply-plan.ts`, since `action`'s new members and `metadata` are additive).

- [ ] **Step 7: Commit**

```bash
git add src/modules/config-writer/types.ts src/modules/memory-protocol/constants.ts src/modules/memory-protocol/status.ts src/modules/memory-protocol/status.test.ts
git commit -m "feat: add memory-integration plan metadata shape and overall-status rule"
```

---

### Task 5: Marker-delimited text block helpers

**Files:**
- Create: `src/modules/instructions-writer/block.ts`
- Test: `src/modules/instructions-writer/block.test.ts`

**Interfaces:**
- Produces: `blockMarkers(blockId)`, `extractBlock(raw, blockId): string | undefined`, `withBlock(raw, blockId, content: string | undefined): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/instructions-writer/block.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { extractBlock, withBlock } from "./block";

describe("extractBlock", () => {
  test("returns undefined when the markers are absent", () => {
    expect(extractBlock("", "x")).toBeUndefined();
    expect(extractBlock("some unrelated content", "x")).toBeUndefined();
  });

  test("returns the trimmed content between the markers", () => {
    const raw = "<!-- forge614-engines:begin x -->\nhello\n<!-- forge614-engines:end x -->\n";
    expect(extractBlock(raw, "x")).toBe("hello");
  });
});

describe("withBlock", () => {
  test("appends a block to an empty file", () => {
    expect(withBlock("", "x", "hello")).toBe("<!-- forge614-engines:begin x -->\nhello\n<!-- forge614-engines:end x -->\n");
  });

  test("appends a block after existing content, preserving it", () => {
    const result = withBlock("existing content\n", "x", "hello");
    expect(result).toBe("existing content\n\n<!-- forge614-engines:begin x -->\nhello\n<!-- forge614-engines:end x -->\n");
  });

  test("updates an existing block in place without disturbing surrounding content", () => {
    const withHello = withBlock("existing content\n", "x", "hello");
    const withGoodbye = withBlock(withHello, "x", "goodbye");
    expect(withGoodbye).toBe("existing content\n\n<!-- forge614-engines:begin x -->\ngoodbye\n<!-- forge614-engines:end x -->\n");
  });

  test("removing a block restores the original surrounding content exactly", () => {
    const original = "existing content\n";
    const withHello = withBlock(original, "x", "hello");
    expect(withBlock(withHello, "x", undefined)).toBe(original);
  });

  test("removing the only content in the file leaves it empty", () => {
    const onlyBlock = withBlock("", "x", "hello");
    expect(withBlock(onlyBlock, "x", undefined)).toBe("");
  });

  test("removing an absent block is a noop", () => {
    expect(withBlock("existing content\n", "x", undefined)).toBe("existing content\n");
  });

  test("two different block ids in the same file do not interfere", () => {
    const withFirst = withBlock("", "a", "one");
    const withBoth = withBlock(withFirst, "b", "two");
    expect(extractBlock(withBoth, "a")).toBe("one");
    expect(extractBlock(withBoth, "b")).toBe("two");
    const withoutFirst = withBlock(withBoth, "a", undefined);
    expect(extractBlock(withoutFirst, "b")).toBe("two");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/modules/instructions-writer/block.test.ts`
Expected: FAIL — cannot find module `./block`.

- [ ] **Step 3: Implement the block helpers**

Create `src/modules/instructions-writer/block.ts`:

```ts
export function blockMarkers(blockId: string): { begin: string; end: string } {
  return {
    begin: `<!-- forge614-engines:begin ${blockId} -->`,
    end: `<!-- forge614-engines:end ${blockId} -->`,
  };
}

export function extractBlock(raw: string, blockId: string): string | undefined {
  const { begin, end } = blockMarkers(blockId);
  const beginIndex = raw.indexOf(begin);
  const endIndex = raw.indexOf(end);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) return undefined;
  return raw.slice(beginIndex + begin.length, endIndex).trim();
}

export function withBlock(raw: string, blockId: string, content: string | undefined): string {
  const { begin, end } = blockMarkers(blockId);
  const beginIndex = raw.indexOf(begin);
  const endIndex = raw.indexOf(end);
  const hasBlock = beginIndex !== -1 && endIndex !== -1 && endIndex >= beginIndex;

  if (content === undefined) {
    if (!hasBlock) return raw;
    const before = raw.slice(0, beginIndex).replace(/\n+$/, "\n");
    const after = raw.slice(endIndex + end.length).replace(/^\n+/, "");
    return before === "\n" && after === "" ? "" : `${before}${after}`;
  }

  const rendered = `${begin}\n${content}\n${end}`;
  if (hasBlock) {
    return `${raw.slice(0, beginIndex)}${rendered}${raw.slice(endIndex + end.length)}`;
  }
  if (raw.length === 0) return `${rendered}\n`;
  const separator = raw.endsWith("\n") ? "" : "\n";
  return `${raw}${separator}\n${rendered}\n`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test src/modules/instructions-writer/block.test.ts`
Expected: PASS. If the "removing the only content" case fails, check the `before === "\n" && after === ""` special case in the removal branch — with `raw` equal to exactly `${rendered}\n` and no other content, `before` is `""` (not `"\n"`) after the regex replace since there was nothing before the marker to begin with; adjust the guard to `before === "" && after === ""` if that's what the failing assertion shows, and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/modules/instructions-writer/block.ts src/modules/instructions-writer/block.test.ts
git commit -m "feat: add marker-delimited text block read/write helpers"
```

---

### Task 6: `AgentAdapter.instructions` target

**Files:**
- Modify: `src/modules/agents/types.ts`
- Test: none new (compiles as part of `bun run typecheck`; adapter-specific tests come in Task 8).

**Interfaces:**
- Produces: `InstructionsTarget`, `AgentAdapter.instructions?: InstructionsTarget`.

- [ ] **Step 1: Add the interface**

In `src/modules/agents/types.ts`, add after `HeadlessCommand`:

```ts
export interface InstructionsTarget {
  /** File the agent reads automatically at the start of every new session. */
  primaryFile(home: string): string;
  /** Files that, if present, would take priority over `primaryFile` and silently shadow it. */
  shadowingFiles(home: string): string[];
  /** When present, `primaryFile` holds only a one-line import pointing at this file (same directory), which holds the full rendered content. When absent, the full content is embedded directly inside `primaryFile`'s managed block. */
  contentFile?(home: string): string;
}
```

Then add the field to `AgentAdapter`:

```ts
export interface AgentAdapter {
  id: AgentId;
  label: string;
  capabilities: AgentCapabilities;
  configFormat: ConfigFormat;
  mcpEntryPath: string[];
  candidateExecutableNames(platform: NodeJS.Platform): string[];
  knownInstallPaths(platform: NodeJS.Platform, home: string): string[];
  configDir(home: string): string;
  configFile(home: string): string;
  mcpEntryShape(server: McpServerDefinition): unknown;
  headlessCommand?(executable: string, opts: HeadlessOptions): HeadlessCommand;
  /** Absent when this agent has no officially supported, stable, file-based mechanism to auto-load global instructions in new sessions. */
  instructions?: InstructionsTarget;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors (the new field is optional, so `claudeCodeAdapter`/`codexAdapter`/`cursorAdapter` still satisfy the interface without changes yet).

- [ ] **Step 3: Commit**

```bash
git add src/modules/agents/types.ts
git commit -m "feat: model an agent's global-instructions mechanism in AgentAdapter"
```

---

### Task 7: Engram protocol client (infrastructure)

**Files:**
- Create: `src/infrastructure/engram/memory-protocol-client.ts`
- Test: `src/infrastructure/engram/memory-protocol-client.test.ts`

**Interfaces:**
- Consumes: `isMemoryProtocol` from Task 2.
- Produces: `fetchMemoryProtocol(options?)`, `EngramProtocolUnavailableError`, `EngramProtocolFailureReason`.

- [ ] **Step 1: Write the failing tests**

Create `src/infrastructure/engram/memory-protocol-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngramProtocolUnavailableError, fetchMemoryProtocol } from "./memory-protocol-client";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-engram-client-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, script);
  return path;
}

const VALID_PROTOCOL = {
  id: "forge614-engram-memory",
  version: 1,
  instructions: "Call memory_context at the start of a conversation.",
  lifecycle: {
    start: ["Call memory_context."],
    save: ["Save explicit remember requests."],
    compact: ["Call memory_session_summary before compacting."],
    resume: ["Call memory_context after compaction."],
    end: ["Call memory_session_end."],
  },
  scopes: { shared: "Cross-client.", project: "Repository-specific." },
  security: { neverSave: ["passwords"] },
};

describe("fetchMemoryProtocol", () => {
  test("returns the protocol, raw stdout, and a stable fingerprint on success", async () => {
    const script = fixture("ok.js", `console.log(${JSON.stringify(JSON.stringify(VALID_PROTOCOL))});`);

    const result = await fetchMemoryProtocol({ command: process.execPath, args: [script] });

    expect(result.protocol.id).toBe("forge614-engram-memory");
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const again = await fetchMemoryProtocol({ command: process.execPath, args: [script] });
    expect(again.fingerprint).toBe(result.fingerprint);
  });

  test("throws not-installed when the executable does not exist", async () => {
    const missing = join(dir, "does-not-exist-binary");

    const error = await fetchMemoryProtocol({ command: missing, args: [] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("not-installed");
  });

  test("throws command-failed when the process exits non-zero", async () => {
    const script = fixture("fail.js", "process.exit(1);");

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("command-failed");
  });

  test("throws invalid-json when stdout is not JSON", async () => {
    const script = fixture("bad-json.js", "console.log('not json at all');");

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("invalid-json");
  });

  test("throws invalid-schema when stdout is JSON but does not match the protocol shape", async () => {
    const script = fixture("bad-schema.js", "console.log(JSON.stringify({ hello: 'world' }));");

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect(error).toBeInstanceOf(EngramProtocolUnavailableError);
    expect((error as EngramProtocolUnavailableError).reason).toBe("invalid-schema");
  });

  test("never includes stderr content in the thrown error", async () => {
    const script = fixture(
      "secret-stderr.js",
      "process.stderr.write(JSON.stringify({code:'X',error:'super-secret-token-abc'}));process.exit(1);",
    );

    const error = await fetchMemoryProtocol({ command: process.execPath, args: [script] }).catch((e) => e);

    expect((error as Error).message).not.toContain("super-secret-token-abc");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/infrastructure/engram/memory-protocol-client.test.ts`
Expected: FAIL — cannot find module `./memory-protocol-client`.

- [ ] **Step 3: Implement the client**

Create `src/infrastructure/engram/memory-protocol-client.ts`:

```ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { isMemoryProtocol, type MemoryProtocol } from "../../modules/memory-protocol/types";

const execFileAsync = promisify(execFile);

export type EngramProtocolFailureReason = "not-installed" | "command-failed" | "invalid-json" | "invalid-schema";

export class EngramProtocolUnavailableError extends Error {
  readonly reason: EngramProtocolFailureReason;
  constructor(reason: EngramProtocolFailureReason) {
    super(`forge614-engram memory-protocol --json is unavailable: ${reason}`);
    this.reason = reason;
  }
}

export interface MemoryProtocolFetchOptions {
  command: string;
  args: string[];
}

export interface MemoryProtocolFetchResult {
  protocol: MemoryProtocol;
  raw: string;
  fingerprint: string;
}

const DEFAULT_OPTIONS: MemoryProtocolFetchOptions = { command: "forge614-engram", args: ["memory-protocol", "--json"] };

export async function fetchMemoryProtocol(
  options: MemoryProtocolFetchOptions = DEFAULT_OPTIONS,
): Promise<MemoryProtocolFetchResult> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(options.command, options.args));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new EngramProtocolUnavailableError(code === "ENOENT" ? "not-installed" : "command-failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new EngramProtocolUnavailableError("invalid-json");
  }

  if (!isMemoryProtocol(parsed)) throw new EngramProtocolUnavailableError("invalid-schema");

  return { protocol: parsed, raw: stdout, fingerprint: createHash("sha256").update(stdout).digest("hex") };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test src/infrastructure/engram/memory-protocol-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/engram/memory-protocol-client.ts src/infrastructure/engram/memory-protocol-client.test.ts
git commit -m "feat: fetch and validate the Engram memory protocol over a subprocess"
```

---

### Task 8: Adapter `instructions` targets for Claude Code and Codex

**Files:**
- Modify: `src/infrastructure/agents/claude-code.ts`
- Modify: `src/infrastructure/agents/claude-code.test.ts`
- Modify: `src/infrastructure/agents/codex.ts`
- Modify: `src/infrastructure/agents/codex.test.ts`
- Modify: `src/infrastructure/agents/cursor.test.ts`

**Interfaces:**
- Consumes: `InstructionsTarget` from Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `src/infrastructure/agents/claude-code.test.ts` (inside the existing `describe`, reusing the file's existing `join` import):

```ts
test("manages global instructions through CLAUDE.md with a satellite content file", () => {
  const target = claudeCodeAdapter.instructions;
  expect(target).toBeDefined();
  expect(target?.primaryFile("/home/u")).toBe(join("/home/u", ".claude", "CLAUDE.md"));
  expect(target?.shadowingFiles("/home/u")).toEqual([]);
  expect(target?.contentFile?.("/home/u")).toBe(join("/home/u", ".claude", "forge614-engram-memory-protocol.md"));
});
```

Append to `src/infrastructure/agents/codex.test.ts` (inside the existing `describe`, reusing the file's existing `join` import):

```ts
test("manages global instructions through AGENTS.md, embedded, watching for AGENTS.override.md", () => {
  const target = codexAdapter.instructions;
  expect(target).toBeDefined();
  expect(target?.primaryFile("/home/u")).toBe(join("/home/u", ".codex", "AGENTS.md"));
  expect(target?.shadowingFiles("/home/u")).toEqual([join("/home/u", ".codex", "AGENTS.override.md")]);
  expect(target?.contentFile).toBeUndefined();
});
```

Append to `src/infrastructure/agents/cursor.test.ts` (inside the existing `describe`):

```ts
test("has no global instructions mechanism (no officially documented file for User Rules)", () => {
  expect(cursorAdapter.instructions).toBeUndefined();
});
```

- [ ] **Step 2: Run them and confirm the Claude Code and Codex ones fail**

Run: `bun test src/infrastructure/agents/claude-code.test.ts src/infrastructure/agents/codex.test.ts src/infrastructure/agents/cursor.test.ts`
Expected: the new Claude Code and Codex tests FAIL (`target` is `undefined`); the new Cursor test already PASSES (nothing to implement there).

- [ ] **Step 3: Implement the Claude Code target**

In `src/infrastructure/agents/claude-code.ts`, add `instructions` to `claudeCodeAdapter`, right after `mcpEntryShape`:

```ts
  instructions: {
    primaryFile(home) {
      return join(home, ".claude", "CLAUDE.md");
    },
    shadowingFiles() {
      return [];
    },
    contentFile(home) {
      return join(home, ".claude", "forge614-engram-memory-protocol.md");
    },
  },
```

- [ ] **Step 4: Implement the Codex target**

In `src/infrastructure/agents/codex.ts`, add `instructions` to `codexAdapter`, right after `mcpEntryShape`:

```ts
  instructions: {
    primaryFile(home) {
      return join(home, ".codex", "AGENTS.md");
    },
    shadowingFiles(home) {
      return [join(home, ".codex", "AGENTS.override.md")];
    },
  },
```

Leave `cursor.ts` untouched except for a short comment documenting the omission, added right after `mcpEntryShape` in `cursorAdapter`:

```ts
  // No `instructions` target: Cursor's global "User Rules" are only configurable
  // through the Cursor Settings UI (cursor.com/docs/rules), with no officially
  // documented external file. `.cursor/rules/*.mdc` is file-based but
  // project-scoped, not global, so it cannot satisfy "loads in every new
  // session" without a project path this adapter does not have.
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `bun test src/infrastructure/agents/claude-code.test.ts src/infrastructure/agents/codex.test.ts src/infrastructure/agents/cursor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/agents/claude-code.ts src/infrastructure/agents/claude-code.test.ts src/infrastructure/agents/codex.ts src/infrastructure/agents/codex.test.ts src/infrastructure/agents/cursor.test.ts
git commit -m "feat: declare each agent's real global-instructions mechanism"
```

---

### Task 9: Shared, non-throwing MCP decision helpers (refactor)

**Files:**
- Create: `src/app/mcp-write-decision.ts`
- Test: `src/app/mcp-write-decision.test.ts`
- Modify: `src/app/plan-mcp-install.ts`
- Modify: `src/app/plan-mcp-remove.ts`

**Interfaces:**
- Produces: `decideMcpInstall(adapter, home, server)`, `decideMcpRemove(adapter, home, server)`.
- Must not change: the public behavior of `planMcpInstall`/`planMcpRemove` (their existing tests in `plan-mcp-install.test.ts`/`plan-mcp-remove.test.ts` must keep passing unmodified).

- [ ] **Step 1: Write the failing tests for the new helpers**

Create `src/app/mcp-write-decision.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { decideMcpInstall, decideMcpRemove } from "./mcp-write-decision";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-mcpdecision-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const server = { name: "engram", command: "forge614-engram", args: ["mcp"] };

describe("decideMcpInstall", () => {
  test("proposes a write when no entry exists", async () => {
    const result = await decideMcpInstall(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("write");
    expect(result.write?.path).toBe(join(home, ".claude.json"));
  });

  test("is a noop when the exact entry already exists", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { engram: { command: "forge614-engram", args: ["mcp"] } } }));
    const result = await decideMcpInstall(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("noop");
    expect(result.write).toBeUndefined();
  });

  test("reports a conflict without proposing a write", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { engram: { command: "/other" } } }));
    const result = await decideMcpInstall(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("conflict");
    expect(result.write).toBeUndefined();
  });
});

describe("decideMcpRemove", () => {
  test("is a noop when the entry is absent", async () => {
    const result = await decideMcpRemove(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("noop");
  });

  test("proposes a write when the recognized entry exists", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { engram: { command: "forge614-engram", args: ["mcp"] } } }));
    const result = await decideMcpRemove(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("write");
    expect(JSON.parse(result.write!.afterContent).mcpServers?.engram).toBeUndefined();
  });

  test("reports unrecognized without proposing a write", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { engram: { command: "/other" } } }));
    const result = await decideMcpRemove(claudeCodeAdapter, home, server);
    expect(result.decision.kind).toBe("unrecognized");
    expect(result.write).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/app/mcp-write-decision.test.ts`
Expected: FAIL — cannot find module `./mcp-write-decision`.

- [ ] **Step 3: Implement the shared helpers**

Create `src/app/mcp-write-decision.ts`:

```ts
import { createHash } from "node:crypto";
import type { AgentAdapter, McpServerDefinition } from "../modules/agents/types";
import { decideMcpWrite, type DiffDecision } from "../modules/config-writer/decide";
import type { PlanWrite } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";

export interface McpInstallDecision {
  configPath: string;
  decision: DiffDecision;
  write?: PlanWrite;
}

export async function decideMcpInstall(
  adapter: AgentAdapter,
  home: string,
  server: McpServerDefinition,
): Promise<McpInstallDecision> {
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const desired = adapter.mcpEntryShape(server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, server.name);
  const decision = decideMcpWrite(existing, desired);

  if (decision.kind !== "write") return { configPath, decision };

  return {
    configPath,
    decision,
    write: {
      path: configPath,
      beforeHash: createHash("sha256").update(exists ? raw : "").digest("hex"),
      afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, server.name, desired),
    },
  };
}

export type McpRemoveDiffDecision = { kind: "noop" } | { kind: "unrecognized" } | { kind: "write" };

export interface McpRemoveDecision {
  configPath: string;
  decision: McpRemoveDiffDecision;
  write?: PlanWrite;
}

export async function decideMcpRemove(
  adapter: AgentAdapter,
  home: string,
  server: McpServerDefinition,
): Promise<McpRemoveDecision> {
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const expected = adapter.mcpEntryShape(server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, server.name);

  if (existing === undefined) return { configPath, decision: { kind: "noop" } };
  if (JSON.stringify(existing) !== JSON.stringify(expected)) return { configPath, decision: { kind: "unrecognized" } };

  return {
    configPath,
    decision: { kind: "write" },
    write: {
      path: configPath,
      beforeHash: createHash("sha256").update(exists ? raw : "").digest("hex"),
      afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, server.name, undefined),
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test src/app/mcp-write-decision.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `planMcpInstall` onto the shared helper**

Replace the body of `src/app/plan-mcp-install.ts` with:

```ts
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import { ConfigConflictError, type Plan } from "../modules/config-writer/types";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpInstall } from "./mcp-write-decision";

export interface PlanMcpInstallInput {
  agentId: AgentId;
  server: McpServerDefinition;
  home: string;
}

export async function planMcpInstall(registry: AgentRegistry, input: PlanMcpInstallInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const { configPath, decision, write } = await decideMcpInstall(adapter, input.home, input.server);
  if (decision.kind === "conflict") throw new ConfigConflictError(configPath, input.server.name);

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-install",
    noop: decision.kind === "noop",
    writes: write ? [write] : [],
  };

  await savePlan(input.home, plan);
  return plan;
}
```

- [ ] **Step 6: Refactor `planMcpRemove` onto the shared helper**

Replace the body of `src/app/plan-mcp-remove.ts` with:

```ts
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import type { Plan } from "../modules/config-writer/types";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpRemove } from "./mcp-write-decision";

export class UnrecognizedEntryError extends Error {
  constructor(name: string) {
    super(`Refusing to remove "${name}": it does not match what this system would have installed`);
  }
}

export interface PlanMcpRemoveInput {
  agentId: AgentId;
  server: McpServerDefinition;
  home: string;
}

export async function planMcpRemove(registry: AgentRegistry, input: PlanMcpRemoveInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const { decision, write } = await decideMcpRemove(adapter, input.home, input.server);
  if (decision.kind === "unrecognized") throw new UnrecognizedEntryError(input.server.name);

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-remove",
    noop: decision.kind === "noop",
    writes: write ? [write] : [],
  };

  await savePlan(input.home, plan);
  return plan;
}
```

- [ ] **Step 7: Run the full existing suite for these three files and confirm nothing regressed**

Run: `bun test src/app/plan-mcp-install.test.ts src/app/plan-mcp-remove.test.ts src/app/mcp-write-decision.test.ts`
Expected: PASS — the pre-existing `plan-mcp-install.test.ts`/`plan-mcp-remove.test.ts` assertions (noop, write, `ConfigConflictError`, `UnrecognizedEntryError`) must pass exactly as before, since the observable behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/app/mcp-write-decision.ts src/app/mcp-write-decision.test.ts src/app/plan-mcp-install.ts src/app/plan-mcp-remove.ts
git commit -m "refactor: extract shared MCP install/remove decision logic"
```

---

### Task 10: Instructions install/remove decision helpers

**Files:**
- Create: `src/app/instructions-write-decision.ts`
- Test: `src/app/instructions-write-decision.test.ts`

**Interfaces:**
- Consumes: `InstructionsTarget` (Task 6), `extractBlock`/`withBlock` (Task 5), `MEMORY_PROTOCOL_BLOCK_ID` (Task 4).
- Produces: `InstructionsDecision`, `decideInstructionsInstall(adapter, home, protocolMarkdown)`, `decideInstructionsRemove(adapter, home)`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/instructions-write-decision.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
});

describe("decideInstructionsRemove", () => {
  test("cursor is unsupported", async () => {
    expect((await decideInstructionsRemove(cursorAdapter, home)).kind).toBe("unsupported");
  });

  test("is a noop when nothing was ever installed", async () => {
    expect((await decideInstructionsRemove(claudeCodeAdapter, home)).kind).toBe("noop");
  });

  test("removes exactly the managed block and the satellite file for claude-code", async () => {
    const installDecision = await decideInstructionsInstall(claudeCodeAdapter, home, markdown);
    if (installDecision.kind !== "write") throw new Error("unreachable");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "@RTK.md\n");
    for (const write of installDecision.writes) writeFileSync(write.path, write.afterContent);

    const removeDecision = await decideInstructionsRemove(claudeCodeAdapter, home);
    expect(removeDecision.kind).toBe("write");
    if (removeDecision.kind !== "write") throw new Error("unreachable");
    const claudeMdWrite = removeDecision.writes.find((w) => w.path === join(home, ".claude", "CLAUDE.md"))!;
    expect(claudeMdWrite.afterContent).toBe("@RTK.md\n");
    const contentWrite = removeDecision.writes.find((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))!;
    expect(contentWrite.delete).toBe(true);
  });

  test("removes the embedded block for codex without touching unrelated content", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const installDecision = await decideInstructionsInstall(codexAdapter, home, markdown);
    if (installDecision.kind !== "write") throw new Error("unreachable");
    writeFileSync(join(home, ".codex", "AGENTS.md"), `Some existing project guidance.\n`);
    for (const write of installDecision.writes) {
      const base = write.path === join(home, ".codex", "AGENTS.md") ? "Some existing project guidance.\n" : "";
      writeFileSync(write.path, write.afterContent.replace(/^/, base === "" ? "" : ""));
    }
    // Re-run install against the seeded file to get the real merged content, then remove it.
    const seededDecision = await decideInstructionsInstall(codexAdapter, home, markdown);
    if (seededDecision.kind !== "noop" && seededDecision.kind !== "write") throw new Error("unreachable");

    const removeDecision = await decideInstructionsRemove(codexAdapter, home);
    expect(removeDecision.kind).toBe("write");
    if (removeDecision.kind !== "write") throw new Error("unreachable");
    expect(removeDecision.writes[0].afterContent).toBe("Some existing project guidance.\n");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/app/instructions-write-decision.test.ts`
Expected: FAIL — cannot find module `./instructions-write-decision`.

- [ ] **Step 3: Implement the helpers**

Create `src/app/instructions-write-decision.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test src/app/instructions-write-decision.test.ts`
Expected: PASS. If the "preserves unrelated existing content" or "removes exactly the managed block" assertions fail on exact string equality, re-check them against the real output of `withBlock` from Task 5 (re-read `src/modules/instructions-writer/block.ts` to confirm the exact separator behavior) and adjust the expected strings in the test — the behavior contract that must hold is: unrelated content survives byte-for-byte, and removing the block after installing onto empty content restores the exact original.

- [ ] **Step 5: Commit**

```bash
git add src/app/instructions-write-decision.ts src/app/instructions-write-decision.test.ts
git commit -m "feat: decide instructions-file writes for install and remove"
```

---

### Task 11: `planMemoryInstall`

**Files:**
- Create: `src/app/plan-memory-install.ts`
- Test: `src/app/plan-memory-install.test.ts`

**Interfaces:**
- Consumes: `fetchMemoryProtocol`/`EngramProtocolUnavailableError` (Task 7), `decideMcpInstall` (Task 9), `decideInstructionsInstall` (Task 10), `renderProtocolMarkdown` (Task 3), `ENGRAM_MCP_SERVER` (Task 4), `computeOverallStatus` (Task 4).
- Produces: `planMemoryInstall(registry, {agentId, home, protocolOptions?}): Promise<Plan>`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/plan-memory-install.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { EngramProtocolUnavailableError } from "../infrastructure/engram/memory-protocol-client";
import { planMemoryInstall } from "./plan-memory-install";

let home: string;
let registry: AgentRegistry;
let okScript: string;
let missingCommand: string;

const PROTOCOL = {
  id: "forge614-engram-memory",
  version: 1,
  instructions: "Call memory_context at the start of a conversation.",
  lifecycle: {
    start: ["Call memory_context."],
    save: ["Save explicit remember requests."],
    compact: ["Call memory_session_summary before compacting."],
    resume: ["Call memory_context after compaction."],
    end: ["Call memory_session_end."],
  },
  scopes: { shared: "Cross-client.", project: "Repository-specific." },
  security: { neverSave: ["passwords"] },
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planmemoryinstall-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(cursorAdapter);
  okScript = join(home, "ok-engram.js");
  writeFileSync(okScript, `console.log(${JSON.stringify(JSON.stringify(PROTOCOL))});`);
  missingCommand = join(home, "does-not-exist-engram");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const protocolOptions = () => ({ command: process.execPath, args: [okScript] });

describe("planMemoryInstall", () => {
  test("is complete for claude-code: installs the MCP entry and the instructions block", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("complete");
    expect(plan.writes.length).toBeGreaterThanOrEqual(3);
    const mcpWrite = plan.writes.find((w) => w.path === join(home, ".claude.json"))!;
    expect(JSON.parse(mcpWrite.afterContent).mcpServers.engram).toEqual({ command: "forge614-engram", args: ["mcp"] });
  });

  test("is partial for cursor: mcp installs, instructions are unsupported", async () => {
    const plan = await planMemoryInstall(registry, { agentId: "cursor", home, protocolOptions: protocolOptions() });

    expect(plan.metadata?.overallStatus).toBe("partial");
    expect(plan.metadata?.instructions.status.kind).toBe("unsupported");
    expect(plan.writes.some((w) => w.path === join(home, ".cursor", "mcp.json"))).toBe(true);
  });

  test("is a noop end to end the second time nothing changed", async () => {
    const first = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });
    for (const write of first.writes) writeFileSync(write.path, write.afterContent);

    const second = await planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: protocolOptions() });

    expect(second.noop).toBe(true);
    expect(second.metadata?.overallStatus).toBe("complete");
  });

  test("throws EngramProtocolUnavailableError and writes nothing when Engram is not installed", async () => {
    writeFileSync(join(home, ".claude.json"), "{}");

    await expect(
      planMemoryInstall(registry, { agentId: "claude-code", home, protocolOptions: { command: missingCommand, args: [] } }),
    ).rejects.toThrow(EngramProtocolUnavailableError);

    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe("{}");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/app/plan-memory-install.test.ts`
Expected: FAIL — cannot find module `./plan-memory-install`.

- [ ] **Step 3: Implement `planMemoryInstall`**

Create `src/app/plan-memory-install.ts`:

```ts
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { ENGRAM_MCP_SERVER } from "../modules/memory-protocol/constants";
import { renderProtocolMarkdown } from "../modules/memory-protocol/render";
import { computeOverallStatus } from "../modules/memory-protocol/status";
import { fetchMemoryProtocol, type MemoryProtocolFetchOptions } from "../infrastructure/engram/memory-protocol-client";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpInstall } from "./mcp-write-decision";
import { decideInstructionsInstall, type InstructionsDecision } from "./instructions-write-decision";

export interface PlanMemoryInstallInput {
  agentId: AgentId;
  home: string;
  /** Test seam for the Engram subprocess invocation; production callers omit this. */
  protocolOptions?: MemoryProtocolFetchOptions;
}

function instructionsComponentStatus(decision: InstructionsDecision): MemoryIntegrationComponentStatus {
  return decision.kind === "write" ? { kind: "write" } : decision;
}

export async function planMemoryInstall(registry: AgentRegistry, input: PlanMemoryInstallInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const { protocol, raw, fingerprint } = await fetchMemoryProtocol(input.protocolOptions);
  const protocolMarkdown = renderProtocolMarkdown(protocol);

  const mcpDecision = await decideMcpInstall(adapter, input.home, ENGRAM_MCP_SERVER);
  const instructionsDecision = await decideInstructionsInstall(adapter, input.home, protocolMarkdown);

  const writes: PlanWrite[] = [];
  if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);

  const mcpStatus: MemoryIntegrationComponentStatus =
    mcpDecision.decision.kind === "conflict"
      ? {
          kind: "blocked",
          reason: "mcp-conflict",
          details: `An existing "${ENGRAM_MCP_SERVER.name}" MCP entry with different content is already present at ${mcpDecision.configPath}`,
        }
      : mcpDecision.decision.kind === "noop"
        ? { kind: "noop" }
        : { kind: "write" };

  const instructionsStatus = instructionsComponentStatus(instructionsDecision);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "memory-install",
    noop: writes.length === 0,
    writes,
    metadata: {
      protocol: { source: "forge614-engram memory-protocol --json", id: protocol.id, version: protocol.version, fingerprint: fingerprint },
      mcp: { path: mcpDecision.configPath, status: mcpStatus },
      instructions: { paths: instructionsPaths, status: instructionsStatus },
      overallStatus: computeOverallStatus(mcpStatus, instructionsStatus),
    },
  };

  void raw; // fingerprint already captures raw; kept named for clarity at the call site above.
  await savePlan(input.home, plan);
  return plan;
}
```

Remove the `void raw;` line above if the linter/typecheck complains about an unused-looking pattern — `raw` is actually consumed by `fingerprint` already at the destructuring site, so simplify the destructure to `const { protocol, fingerprint } = await fetchMemoryProtocol(...)` and drop `raw` entirely; re-run typecheck after simplifying.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test src/app/plan-memory-install.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors (this catches the leftover `raw`/`void raw` cleanup from Step 3).

- [ ] **Step 6: Commit**

```bash
git add src/app/plan-memory-install.ts src/app/plan-memory-install.test.ts
git commit -m "feat: plan a full Engram memory integration install for one agent"
```

---

### Task 12: `planMemoryRemove`

**Files:**
- Create: `src/app/plan-memory-remove.ts`
- Test: `src/app/plan-memory-remove.test.ts`

**Interfaces:**
- Consumes: `decideMcpRemove` (Task 9), `decideInstructionsRemove` (Task 10), `ENGRAM_MCP_SERVER`/`computeOverallStatus` (Task 4).
- Produces: `planMemoryRemove(registry, {agentId, home}): Promise<Plan>`. Never calls `fetchMemoryProtocol`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/plan-memory-remove.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { planMemoryInstall } from "./plan-memory-install";
import { planMemoryRemove } from "./plan-memory-remove";

let home: string;
let registry: AgentRegistry;

const PROTOCOL_SCRIPT_CONTENT = `console.log(${JSON.stringify(
  JSON.stringify({
    id: "forge614-engram-memory",
    version: 1,
    instructions: "Call memory_context.",
    lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
    scopes: { shared: "s", project: "p" },
    security: { neverSave: ["passwords"] },
  }),
)});`;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planmemoryremove-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(cursorAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMemoryRemove", () => {
  test("is a noop when nothing was ever installed", async () => {
    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });
    expect(plan.noop).toBe(true);
    expect(plan.metadata?.overallStatus).toBe("complete");
  });

  test("removes a full prior install and needs no Engram executable at all", async () => {
    const script = join(home, "engram.js");
    writeFileSync(script, PROTOCOL_SCRIPT_CONTENT);
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) writeFileSync(write.path, write.afterContent);

    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });

    expect(plan.noop).toBe(false);
    const claudeMdWrite = plan.writes.find((w) => w.path === join(home, ".claude.json"))!;
    expect(JSON.parse(claudeMdWrite.afterContent).mcpServers?.engram).toBeUndefined();
    const contentWrite = plan.writes.find((w) => w.path === join(home, ".claude", "forge614-engram-memory-protocol.md"))!;
    expect(contentWrite.delete).toBe(true);
  });

  test("blocks the mcp component as data (not a thrown error) when the entry is unrecognized", async () => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { engram: { command: "/something/else" } } }));

    const plan = await planMemoryRemove(registry, { agentId: "claude-code", home });

    expect(plan.metadata?.mcp.status.kind).toBe("blocked");
    expect(plan.writes.some((w) => w.path === join(home, ".claude.json"))).toBe(false);
  });

  test("cursor's instructions component is unsupported, mcp still removes", async () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { engram: { command: "forge614-engram", args: ["mcp"] } } }));

    const plan = await planMemoryRemove(registry, { agentId: "cursor", home });

    expect(plan.metadata?.instructions.status.kind).toBe("unsupported");
    expect(plan.writes.some((w) => w.path === join(home, ".cursor", "mcp.json"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/app/plan-memory-remove.test.ts`
Expected: FAIL — cannot find module `./plan-memory-remove`.

- [ ] **Step 3: Implement `planMemoryRemove`**

Create `src/app/plan-memory-remove.ts`:

```ts
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { MemoryIntegrationComponentStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { ENGRAM_MCP_SERVER } from "../modules/memory-protocol/constants";
import { computeOverallStatus } from "../modules/memory-protocol/status";
import { newPlanId, savePlan } from "../infrastructure/plan-store";
import { decideMcpRemove } from "./mcp-write-decision";
import { decideInstructionsRemove, type InstructionsDecision } from "./instructions-write-decision";

export interface PlanMemoryRemoveInput {
  agentId: AgentId;
  home: string;
}

function instructionsComponentStatus(decision: InstructionsDecision): MemoryIntegrationComponentStatus {
  return decision.kind === "write" ? { kind: "write" } : decision;
}

export async function planMemoryRemove(registry: AgentRegistry, input: PlanMemoryRemoveInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const mcpDecision = await decideMcpRemove(adapter, input.home, ENGRAM_MCP_SERVER);
  const instructionsDecision = await decideInstructionsRemove(adapter, input.home);

  const writes: PlanWrite[] = [];
  if (mcpDecision.decision.kind === "write" && mcpDecision.write) writes.push(mcpDecision.write);
  if (instructionsDecision.kind === "write") writes.push(...instructionsDecision.writes);

  const mcpStatus: MemoryIntegrationComponentStatus =
    mcpDecision.decision.kind === "unrecognized"
      ? {
          kind: "blocked",
          reason: "mcp-unrecognized",
          details: `The "${ENGRAM_MCP_SERVER.name}" MCP entry at ${mcpDecision.configPath} does not match what Forge614 would have installed`,
        }
      : mcpDecision.decision.kind === "noop"
        ? { kind: "noop" }
        : { kind: "write" };

  const instructionsStatus = instructionsComponentStatus(instructionsDecision);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "memory-remove",
    noop: writes.length === 0,
    writes,
    metadata: {
      mcp: { path: mcpDecision.configPath, status: mcpStatus },
      instructions: { paths: instructionsPaths, status: instructionsStatus },
      overallStatus: computeOverallStatus(mcpStatus, instructionsStatus),
    },
  };

  await savePlan(input.home, plan);
  return plan;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test src/app/plan-memory-remove.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/plan-memory-remove.ts src/app/plan-memory-remove.test.ts
git commit -m "feat: plan a full Engram memory integration removal for one agent, without needing Engram"
```

---

### Task 13: `verifyMemoryIntegration`

**Files:**
- Create: `src/app/verify-memory-integration.ts`
- Test: `src/app/verify-memory-integration.test.ts`

**Interfaces:**
- Consumes: `decideMcpRemove` (Task 9, reused purely for detection), `extractBlock`/`MEMORY_PROTOCOL_BLOCK_ID` (Tasks 5/4).
- Produces: `verifyMemoryIntegration(registry, {agentId, home}): Promise<MemoryIntegrationVerification>`. Read-only; never calls Engram.

- [ ] **Step 1: Write the failing tests**

Create `src/app/verify-memory-integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { cursorAdapter } from "../infrastructure/agents/cursor";
import { planMemoryInstall } from "./plan-memory-install";
import { verifyMemoryIntegration } from "./verify-memory-integration";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-verifymemory-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(cursorAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("verifyMemoryIntegration", () => {
  test("reports absent for both components when nothing is installed", async () => {
    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });
    expect(result.mcp.present).toBe(false);
    expect(result.instructions.present).toBe(false);
    expect(result.overallStatus).toBe("partial");
  });

  test("reports complete after a real install for claude-code", async () => {
    const script = join(home, "engram.js");
    writeFileSync(
      script,
      `console.log(${JSON.stringify(
        JSON.stringify({
          id: "forge614-engram-memory",
          version: 1,
          instructions: "Call memory_context.",
          lifecycle: { start: ["s"], save: ["s"], compact: ["s"], resume: ["s"], end: ["s"] },
          scopes: { shared: "s", project: "p" },
          security: { neverSave: ["passwords"] },
        }),
      )});`,
    );
    const installed = await planMemoryInstall(registry, {
      agentId: "claude-code",
      home,
      protocolOptions: { command: process.execPath, args: [script] },
    });
    for (const write of installed.writes) writeFileSync(write.path, write.afterContent);

    const result = await verifyMemoryIntegration(registry, { agentId: "claude-code", home });

    expect(result.mcp.present).toBe(true);
    expect(result.instructions.present).toBe(true);
    expect(result.overallStatus).toBe("complete");
  });

  test("cursor's instructions are always reported unsupported", async () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { engram: { command: "forge614-engram", args: ["mcp"] } } }));

    const result = await verifyMemoryIntegration(registry, { agentId: "cursor", home });

    expect(result.mcp.present).toBe(true);
    expect(result.instructions.supported).toBe(false);
    expect(result.overallStatus).toBe("partial");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test src/app/verify-memory-integration.test.ts`
Expected: FAIL — cannot find module `./verify-memory-integration`.

- [ ] **Step 3: Implement `verifyMemoryIntegration`**

Create `src/app/verify-memory-integration.ts`:

```ts
import { readFile } from "node:fs/promises";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import { ENGRAM_MCP_SERVER } from "../modules/memory-protocol/constants";
import { extractBlock } from "../modules/instructions-writer/block";
import { MEMORY_PROTOCOL_BLOCK_ID } from "../modules/memory-protocol/constants";
import { decideMcpRemove } from "./mcp-write-decision";

export interface VerifyMemoryIntegrationInput {
  agentId: AgentId;
  home: string;
}

export interface MemoryIntegrationVerification {
  agentId: AgentId;
  mcp: { path: string; present: boolean };
  instructions: { supported: boolean; paths: string[]; present: boolean };
  overallStatus: "complete" | "partial" | "unsupported";
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function verifyMemoryIntegration(
  registry: AgentRegistry,
  input: VerifyMemoryIntegrationInput,
): Promise<MemoryIntegrationVerification> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);

  const mcpDecision = await decideMcpRemove(adapter, input.home, ENGRAM_MCP_SERVER);
  const mcpPresent = mcpDecision.decision.kind === "write";

  const instructionsSupported = Boolean(adapter.instructions);
  const instructionsPaths = adapter.instructions
    ? [adapter.instructions.primaryFile(input.home), ...(adapter.instructions.contentFile ? [adapter.instructions.contentFile(input.home)] : [])]
    : [];
  let instructionsPresent = false;
  if (adapter.instructions) {
    const primary = await readOrEmpty(adapter.instructions.primaryFile(input.home));
    instructionsPresent = extractBlock(primary, MEMORY_PROTOCOL_BLOCK_ID) !== undefined;
  }

  const overallStatus: MemoryIntegrationVerification["overallStatus"] = !instructionsSupported
    ? "partial"
    : mcpPresent && instructionsPresent
      ? "complete"
      : "partial";

  return {
    agentId: input.agentId,
    mcp: { path: mcpDecision.configPath, present: mcpPresent },
    instructions: { supported: instructionsSupported, paths: instructionsPaths, present: instructionsPresent },
    overallStatus,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test src/app/verify-memory-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/verify-memory-integration.ts src/app/verify-memory-integration.test.ts
git commit -m "feat: verify a previously applied Engram memory integration"
```

---

### Task 14: CLI wiring

**Files:**
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/interfaces/cli/main.ts`
- Modify: `src/interfaces/cli/cli.test.ts`

**Interfaces:**
- Produces new commands: `plan memory-install --agent <id>`, `plan memory-remove --agent <id>`, `verify memory-integration --agent <id>`. Reuses the existing `apply --plan-id <id>` command unmodified.

- [ ] **Step 1: Write the failing CLI e2e tests**

Append to `src/interfaces/cli/cli.test.ts` (inside the existing `describe`, reusing its `runCli` helper):

```ts
test("plan memory-install for an agent without Engram installed reports ENGRAM_PROTOCOL_UNAVAILABLE", async () => {
  const { stdout, exitCode } = await runCli(["plan", "memory-install", "--agent", "claude-code"]);

  expect(exitCode).toBe(1);
  const parsed = JSON.parse(stdout);
  expect(parsed.error.code).toBe("ENGRAM_PROTOCOL_UNAVAILABLE");
});

test("plan memory-remove is a noop when nothing was installed", async () => {
  const { stdout, exitCode } = await runCli(["plan", "memory-remove", "--agent", "cursor"]);

  expect(exitCode).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.plan.noop).toBe(true);
});

test("verify memory-integration reports absent components when nothing was installed", async () => {
  const { stdout, exitCode } = await runCli(["verify", "memory-integration", "--agent", "cursor"]);

  expect(exitCode).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.verification.mcp.present).toBe(false);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test src/interfaces/cli/cli.test.ts`
Expected: FAIL — `UNKNOWN_COMMAND` for all three new invocations.

- [ ] **Step 3: Add the command functions**

In `src/interfaces/cli/commands.ts`, add these imports alongside the existing ones:

```ts
import { planMemoryInstall } from "../../app/plan-memory-install";
import { planMemoryRemove } from "../../app/plan-memory-remove";
import { verifyMemoryIntegration } from "../../app/verify-memory-integration";
```

and these functions at the end of the file:

```ts
export async function runPlanMemoryInstall(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMemoryInstall(registry, { agentId, home: homedir() });
  printJson({ plan });
}

export async function runPlanMemoryRemove(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMemoryRemove(registry, { agentId, home: homedir() });
  printJson({ plan });
}

export async function runVerifyMemoryIntegration(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const verification = await verifyMemoryIntegration(registry, { agentId, home: homedir() });
  printJson({ verification });
}
```

- [ ] **Step 4: Wire the commands and the error code into `main.ts`**

In `src/interfaces/cli/main.ts`, update the imports:

```ts
import {
  runApply,
  runCapabilities,
  runDetect,
  runHeadlessCommand,
  runPlanMcpInstall,
  runPlanMcpRemove,
  runPlanMemoryInstall,
  runPlanMemoryRemove,
  runUpdate,
  runVerifyMemoryIntegration,
} from "./commands";
import { EngramProtocolUnavailableError } from "../../infrastructure/engram/memory-protocol-client";
```

(keep every other existing import line unchanged). Add the new error mapping inside `errorCodeFor`, right after the `ConfigConflictError` line:

```ts
  if (error instanceof EngramProtocolUnavailableError) return "ENGRAM_PROTOCOL_UNAVAILABLE";
```

Add the new command branches inside `main()`, right after the existing `plan mcp-remove` branch:

```ts
  if (command === "plan" && subcommand === "memory-install") {
    const agentId = flag(rest, "--agent") as AgentId;
    return runPlanMemoryInstall(agentId);
  }

  if (command === "plan" && subcommand === "memory-remove") {
    const agentId = flag(rest, "--agent") as AgentId;
    return runPlanMemoryRemove(agentId);
  }
```

and, right after the existing `update` branch, add a new top-level `verify` branch:

```ts
  if (command === "verify" && subcommand === "memory-integration") {
    const agentId = flag(rest, "--agent") as AgentId;
    return runVerifyMemoryIntegration(agentId);
  }
```

- [ ] **Step 5: Run the CLI tests and confirm they pass**

Run: `bun test src/interfaces/cli/cli.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS, zero failures.

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/cli/commands.ts src/interfaces/cli/main.ts src/interfaces/cli/cli.test.ts
git commit -m "feat: expose plan memory-install/remove and verify memory-integration over the CLI"
```

---

### Task 15: Documentation and `verify-documentation.mjs`

**Files:**
- Modify: `scripts/verify-documentation.mjs`
- Modify: `docs/es/03-plan-seguro-de-mcp.md`, `docs/en/03-safe-mcp-planning.md`
- Modify: `docs/es/04-aplicacion-segura-y-recuperacion.md`, `docs/en/04-safe-application-and-recovery.md`
- Modify: `docs/es/05-referencia-del-cli-publico.md`, `docs/en/05-public-cli-reference.md`
- Modify: `docs/es/07-arquitectura-y-mapa-del-codigo.md`, `docs/en/07-architecture-and-code-map.md`
- Modify: `docs/notion-map.json` (fingerprints only, via script)

**Interfaces:** none (documentation + a verifier-script regex).

- [ ] **Step 1: Widen the CLI-contract regex in `verify-documentation.mjs`**

In `scripts/verify-documentation.mjs`, replace:

```js
async function publicCliContract(root) {
  const source = await readFile(join(root, "src", "interfaces", "cli", "main.ts"), "utf8");
  const commands = new Set([...source.matchAll(/command === "([a-z]+)"/g)].map((match) => match[1]));
  for (const subcommand of source.matchAll(/command === "plan" && subcommand === "(mcp-(?:install|remove))"/g)) {
    commands.add(`plan ${subcommand[1]}`);
  }
  const errorCodes = new Set([...source.matchAll(/return "([A-Z][A-Z_]+)"/g)].map((match) => match[1]));
  return { commands, errorCodes };
}
```

with:

```js
async function publicCliContract(root) {
  const source = await readFile(join(root, "src", "interfaces", "cli", "main.ts"), "utf8");
  const commands = new Set([...source.matchAll(/command === "([a-z]+)"/g)].map((match) => match[1]));
  for (const subcommand of source.matchAll(
    /command === "(plan|verify)" && subcommand === "((?:mcp|memory)-(?:install|remove)|memory-integration)"/g,
  )) {
    commands.add(`${subcommand[1]} ${subcommand[2]}`);
  }
  const errorCodes = new Set([...source.matchAll(/return "([A-Z][A-Z_]+)"/g)].map((match) => match[1]));
  return { commands, errorCodes };
}
```

- [ ] **Step 2: Run the verifier's own tests**

Run: `bun test scripts/verify-documentation.test.ts`
Expected: PASS (the fixture-based tests only reference the old commands, which the widened regex still matches identically).

- [ ] **Step 3: Update the public CLI reference docs**

Read `docs/en/05-public-cli-reference.md` and `docs/es/05-referencia-del-cli-publico.md` first, then add a new row to each command table and a new row to each error table, plus one example line and one prose sentence. For the English page, in the commands table add:

```markdown
| `forge614-engines plan memory-install --agent <id>` | one coherent memory-integration `plan` | Stores the plan only |
| `forge614-engines plan memory-remove --agent <id>` | one coherent memory-integration removal `plan` | Stores the plan only |
| `forge614-engines verify memory-integration --agent <id>` | current MCP/instructions `verification` | No |
```

and, after the existing examples block, add:

```markdown
`plan memory-install` reads the protocol fresh from `forge614-engram memory-protocol --json` every time, decides the MCP entry and the instructions file(s) for the given agent, and returns one plan that already contains every write `apply` needs — install and remove for the memory integration share the same `apply --plan-id <id>` command as any other plan. `verify memory-integration` never touches Engram; it only inspects the files Engines itself manages.
```

and, in the errors table, add:

```markdown
| `ENGRAM_PROTOCOL_UNAVAILABLE` | Engram is not installed, the command failed, or its JSON did not match the protocol shape |
```

Mirror the same three additions in Spanish inside `docs/es/05-referencia-del-cli-publico.md` (translate the prose; keep every command name, flag, and error code in English/verbatim, matching how the rest of that file already keeps CLI tokens untranslated).

- [ ] **Step 4: Update the safe-planning and safe-application docs**

In `docs/en/03-safe-mcp-planning.md` (and its Spanish pair), add a short new section after "Removing carefully" describing that `plan memory-install`/`plan memory-remove` bundle the MCP decision and the instructions decision into one plan, that a per-component conflict (a different `engram` MCP entry, or a non-empty `AGENTS.override.md` shadowing Codex's `AGENTS.md`) is reported as `blocked` inside that one plan rather than aborting it, and that Cursor's instructions component is always reported `unsupported` because Cursor has no officially documented global, file-based mechanism for it. In `docs/en/04-safe-application-and-recovery.md` (and its Spanish pair), add one sentence noting that a write can also be a deletion (used to fully remove Claude Code's dedicated instructions content file on `plan memory-remove`), applied through the exact same hash-check and snapshot path as every other write.

- [ ] **Step 5: Update the architecture doc**

In `docs/en/07-architecture-and-code-map.md` (and its Spanish pair), add `memory-protocol/`, `instructions-writer/`, and `infrastructure/engram/` to the "Main pieces" list, one sentence each, matching the file's existing terse style.

- [ ] **Step 6: Refresh fingerprints and verify**

Run: `bun scripts/verify-documentation.mjs --refresh-fingerprints`
Then run: `bun run verify:docs`
Expected: `Verified 16 documentation files for Forge614 Engines 1.3.2.` (the count must stay 16 — no new document was added, only existing ones changed).

- [ ] **Step 7: Run the full suite once more**

Run: `bun test`
Expected: PASS, including `scripts/verify-documentation.test.ts`'s `"accepts the complete local documentation index"` test.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-documentation.mjs docs/es docs/en docs/notion-map.json
git commit -m "docs: document the Engram memory-integration commands and error code"
```

---

### Task 16: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: every test passes, including every pre-existing test file untouched by this plan (`smoke.test.ts`, `detect.test.ts`, `capabilities.test.ts`, `self-update.test.ts`, `headless-command.test.ts`, `pipeline.test.ts`, `plan-store.test.ts`, `json-format.test.ts`, `toml-format.test.ts`, `registry.test.ts`, `decide.test.ts`, `tests/architecture/import-rules.test.ts`).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Documentation contract**

Run: `bun run verify:docs`
Expected: `Verified 16 documentation files for Forge614 Engines 1.3.2.`

- [ ] **Step 4: Whitespace/line-ending check**

Run: `git diff --check`
Expected: no output (no trailing whitespace or conflict markers; confirms the new Markdown/text-writer code never introduced `\r\n`).

- [ ] **Step 5: Architecture layering**

Run: `bun test tests/architecture/import-rules.test.ts`
Expected: PASS — confirms every new file (`app/*` importing only `modules`/`infrastructure`; `infrastructure/*` importing only `modules`) respects the existing layer order.

- [ ] **Step 6: Report**

Summarize, without pasting full file contents: every file created or modified (from "File Structure" above), the exact mechanism used per agent (Claude Code: `~/.claude/CLAUDE.md` import block + satellite file; Codex: embedded block in `~/.codex/AGENTS.md`, blocked by a non-empty `AGENTS.override.md`; Cursor: MCP only, instructions `unsupported`), and the exact commands/output for every check above.
