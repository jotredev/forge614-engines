# Forge614 Engram MCP Conflict Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Forge614 Shell a confirmed, non-interactive way to repair a
conflicting `forge614-engram` MCP entry in Claude Code's or Codex's config,
without Shell ever touching those files directly.

**Architecture:** Reuse the existing Plan/apply primitives (`Plan.writes`,
`applyPlan`'s stale-hash + snapshot + atomic write, `ConfigFormatIO.withMcpEntry`'s
single-key targeted edit). Add one new `Plan.action` member (`"mcp-repair"`)
and one new `Plan.repair` field carrying a 4-way classification
(`not-installed` / `already-correct` / `repairable-conflict` / `blocked`)
and a redacted preview. Three new CLI operations: `plan mcp-repair`,
`apply mcp-repair` (requires `--confirm`), `verify mcp-repair`.

**Tech Stack:** TypeScript, Bun (`bun test`, `tsc --noEmit`), `jsonc-parser`,
`smol-toml`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-forge614-engines-mcp-conflict-repair-design.md`

## Global Constraints

- Touch only the MCP entry named exactly `forge614-engram`. Never touch
  other MCP entries, instructions files, memory storage, SQLite, `.env`,
  or other products' configuration.
- Canonical entry: `name: "forge614-engram"`, `command:` from
  `resolveEngramExecutable(home)` (respects `FORGE614_HOME`, `.exe` on
  Windows), `args: ["mcp"]`.
- Apply must require an explicit `confirmed === true` argument; without
  it, zero writes, zero reads-for-hashing, nothing persisted.
- Before writing: preserve foreign content, fail closed if the file
  changed since the plan (reuse `applyPlan`'s existing `StalePlanError`),
  atomic write (reuse `atomicWrite`).
- Never print secrets/env/credentials to stdout/stderr — the redacted
  `plan.repair.existing` preview only ever echoes `command` (string) and
  `args` (string[]); every other key becomes `"<redacted>"`.
- Covers `claude-code` and `codex` only. No new `AgentId`, no TUI, no
  changes to Shell/Engram/Atlas/forge614-ai, no release/tag/push.
- Every new/changed source file must pass `bun test`, `bun run typecheck`,
  and `git diff --check`.

---

## Task 1: `ConfigFormatIO.isParsable` for JSON and TOML

**Files:**
- Modify: `src/infrastructure/config-io/config-format.ts`
- Modify: `src/infrastructure/config-io/json-format.ts`
- Modify: `src/infrastructure/config-io/toml-format.ts`
- Test: `src/infrastructure/config-io/json-format.test.ts`
- Test: `src/infrastructure/config-io/toml-format.test.ts`

**Interfaces:**
- Produces: `ConfigFormatIO.isParsable(raw: string): boolean`, implemented
  by `jsonConfigFormat` and `tomlConfigFormat`. Later tasks call
  `format.isParsable(raw)` where `format = configFormats[adapter.configFormat]`.

**Context:** Verified live that `jsonc-parser`'s `parse(text)` does **not**
throw on malformed JSON — it silently returns a best-effort object unless
you pass an `errors` array and check its length. `smol-toml`'s `parse()`
does throw a `TomlError`. Both formats need this method so "the config
file is corrupt" becomes a real, detectable state instead of a crash or a
silently-wrong classification.

- [ ] **Step 1: Write the failing tests**

Append to `src/infrastructure/config-io/json-format.test.ts` (read the
existing file first to match its imports/describe block):

```ts
describe("isParsable", () => {
  test("true for valid JSON", () => {
    expect(jsonConfigFormat.isParsable('{"a":1}')).toBe(true);
  });

  test("true for empty string (treated as empty document)", () => {
    expect(jsonConfigFormat.isParsable("")).toBe(true);
  });

  test("false for malformed JSON", () => {
    expect(jsonConfigFormat.isParsable("{ this is not json")).toBe(false);
  });
});
```

Append to `src/infrastructure/config-io/toml-format.test.ts`:

```ts
describe("isParsable", () => {
  test("true for valid TOML", () => {
    expect(tomlConfigFormat.isParsable('a = 1\n')).toBe(true);
  });

  test("true for empty string", () => {
    expect(tomlConfigFormat.isParsable("")).toBe(true);
  });

  test("false for malformed TOML", () => {
    expect(tomlConfigFormat.isParsable("this = is not [valid toml")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/infrastructure/config-io/json-format.test.ts src/infrastructure/config-io/toml-format.test.ts`
Expected: FAIL with `isParsable is not a function` (or similar) for both files.

- [ ] **Step 3: Implement**

In `src/infrastructure/config-io/config-format.ts`, add the method to the
interface:

```ts
export interface ConfigFormatIO {
  readOrDefault(path: string): Promise<{ raw: string; exists: boolean }>;
  getMcpEntry(raw: string, entryPath: string[], name: string): unknown;
  withMcpEntry(raw: string, entryPath: string[], name: string, value: unknown): string;
  isParsable(raw: string): boolean;
}
```

In `src/infrastructure/config-io/json-format.ts`, add (and export it from
`jsonConfigFormat`):

```ts
function isParsable(raw: string): boolean {
  const errors: import("jsonc-parser").ParseError[] = [];
  parse(raw, errors);
  return errors.length === 0;
}
```

```ts
export const jsonConfigFormat: ConfigFormatIO = { readOrDefault, getMcpEntry, withMcpEntry, isParsable };
```

In `src/infrastructure/config-io/toml-format.ts`, add:

```ts
function isParsable(raw: string): boolean {
  try {
    parseDocument(raw);
    return true;
  } catch {
    return false;
  }
}
```

```ts
export const tomlConfigFormat: ConfigFormatIO = { readOrDefault, getMcpEntry, withMcpEntry, isParsable };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/infrastructure/config-io/json-format.test.ts src/infrastructure/config-io/toml-format.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/infrastructure/config-io/config-format.ts src/infrastructure/config-io/json-format.ts src/infrastructure/config-io/toml-format.ts src/infrastructure/config-io/json-format.test.ts src/infrastructure/config-io/toml-format.test.ts
git commit -m "feat: add isParsable to ConfigFormatIO for JSON and TOML"
```

---

## Task 2: `isPathWritable` helper

**Files:**
- Create: `src/infrastructure/config-io/writable.ts`
- Test: `src/infrastructure/config-io/writable.test.ts`

**Interfaces:**
- Produces: `isPathWritable(path: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/config-io/writable.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPathWritable } from "./writable";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-writable-"));
});

afterEach(() => {
  chmodSync(join(dir, "existing.json"), 0o600).catch?.(() => {});
  rmSync(dir, { recursive: true, force: true });
});

describe("isPathWritable", () => {
  test("true for an existing writable file", async () => {
    const path = join(dir, "existing.json");
    writeFileSync(path, "{}");
    expect(await isPathWritable(path)).toBe(true);
  });

  test("true for a path that does not exist yet, when the parent directory is writable", async () => {
    expect(await isPathWritable(join(dir, "missing.json"))).toBe(true);
  });

  test("false for a path whose parent directory does not exist", async () => {
    expect(await isPathWritable(join(dir, "nested", "missing.json"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "false for a read-only existing file",
    async () => {
      const path = join(dir, "readonly.json");
      writeFileSync(path, "{}");
      chmodSync(path, 0o444);
      expect(await isPathWritable(path)).toBe(false);
      chmodSync(path, 0o644);
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/infrastructure/config-io/writable.test.ts`
Expected: FAIL — `writable.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// src/infrastructure/config-io/writable.ts
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";

export async function isPathWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    try {
      await access(dirname(path), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
```

Fix the test's `afterEach` (the `chmodSync(...).catch?.()` line is invalid
since `chmodSync` is synchronous and returns `undefined`) — replace it
with:

```ts
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
```

(The read-only test already restores permissions to `0o644` before the
temp directory is removed, so no extra cleanup is needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/infrastructure/config-io/writable.test.ts`
Expected: PASS. On CI running as root (rare, but some containers do),
the read-only test may still see `true` because root bypasses permission
bits — that's why it's wrapped in `test.skipIf(process.platform === "win32")`
for Windows only; if it turns out to also be flaky as root on Linux CI,
narrow the skip condition to also check `process.getuid?.() === 0` (Bun/Node
expose `process.getuid` on POSIX only).

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`

```bash
git add src/infrastructure/config-io/writable.ts src/infrastructure/config-io/writable.test.ts
git commit -m "feat: add isPathWritable helper"
```

---

## Task 3: `redactMcpEntry` helper

**Files:**
- Create: `src/modules/config-writer/redact.ts`
- Test: `src/modules/config-writer/redact.test.ts`

**Interfaces:**
- Produces: `redactMcpEntry(entry: unknown): unknown`.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/config-writer/redact.test.ts
import { describe, expect, test } from "bun:test";
import { redactMcpEntry } from "./redact";

describe("redactMcpEntry", () => {
  test("keeps command and args verbatim", () => {
    expect(redactMcpEntry({ command: "/bin/other", args: ["mcp", "--flag"] })).toEqual({
      command: "/bin/other",
      args: ["mcp", "--flag"],
    });
  });

  test("redacts every other key, including env", () => {
    expect(
      redactMcpEntry({ command: "/bin/other", args: ["mcp"], env: { API_KEY: "sk-secret" }, cwd: "/home/x" }),
    ).toEqual({ command: "/bin/other", args: ["mcp"], env: "<redacted>", cwd: "<redacted>" });
  });

  test("never echoes a non-object entry value", () => {
    expect(redactMcpEntry("sk-some-secret-string")).toEqual({ type: "string", redacted: true });
  });

  test("never echoes an array entry value", () => {
    expect(redactMcpEntry(["a", "b"])).toEqual({ type: "object", redacted: true });
  });

  test("passes through undefined", () => {
    expect(redactMcpEntry(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/config-writer/redact.test.ts`
Expected: FAIL — `redact.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// src/modules/config-writer/redact.ts

/**
 * Builds a preview-safe copy of a conflicting MCP entry for display: only
 * `command` (string) and `args` (string[]) are ever echoed verbatim. Every
 * other key — including a hypothetical `env` block holding another tool's
 * credentials — is masked. A non-object entry is never echoed at all, in
 * case the key was repurposed to hold a bare secret string.
 */
export function redactMcpEntry(entry: unknown): unknown {
  if (entry === undefined) return undefined;
  if (typeof entry !== "object" || entry === null) {
    return { type: typeof entry, redacted: true };
  }
  if (Array.isArray(entry)) {
    return { type: "object", redacted: true };
  }
  const record = entry as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (key === "command" && typeof value === "string") {
      result[key] = value;
    } else if (key === "args" && Array.isArray(value) && value.every((item) => typeof item === "string")) {
      result[key] = value;
    } else {
      result[key] = "<redacted>";
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/modules/config-writer/redact.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`

```bash
git add src/modules/config-writer/redact.ts src/modules/config-writer/redact.test.ts
git commit -m "feat: add redactMcpEntry preview helper"
```

---

## Task 4: Extend `Plan` types for repair

**Files:**
- Modify: `src/modules/config-writer/types.ts`

**Interfaces:**
- Produces: `McpRepairStatus`, `McpRepairPreview`, `Plan.action` gains
  `"mcp-repair"`, `Plan.repair?: McpRepairPreview`.
- Consumes: nothing new (pure type addition).

- [ ] **Step 1: Edit the file**

In `src/modules/config-writer/types.ts`, change the `Plan.action` union
and add the new field:

```ts
export interface Plan {
  planId: string;
  agentId: string;
  action: "mcp-install" | "mcp-remove" | "memory-install" | "memory-remove" | "mcp-repair";
  noop: boolean;
  writes: PlanWrite[];
  metadata?: MemoryIntegrationMetadata;
  repair?: McpRepairPreview;
}
```

Add, near the top of the file (after `PlanWrite`, before `Plan`):

```ts
export type McpRepairStatus = "not-installed" | "already-correct" | "repairable-conflict" | "blocked";

export interface McpRepairPreview {
  agentId: string;
  configPath: string;
  status: McpRepairStatus;
  canonical: { name: string; command: string; args: string[] };
  /** Redacted preview of the conflicting entry (see redactMcpEntry). Present only for repairable-conflict and blocked/not-writable. */
  existing?: unknown;
  blockedReason?: "unparsable-config" | "not-writable";
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors (this is a pure additive type change; no existing
code constructs a `Plan` with an incompatible `action` literal).

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS (no behavior changed yet).

- [ ] **Step 4: Commit**

```bash
git add src/modules/config-writer/types.ts
git commit -m "feat: add mcp-repair plan action and McpRepairPreview type"
```

---

## Task 5: `planMcpRepair`

**Files:**
- Create: `src/app/plan-mcp-repair.ts`
- Test: `src/app/plan-mcp-repair.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry.get(agentId): AgentAdapter | undefined`,
  `adapter.capabilities.supportsMcp: boolean`, `adapter.mcpEntryShape`,
  `configFormats[adapter.configFormat]: ConfigFormatIO` (from Task 1),
  `resolveEngramMcpServer(home): McpServerDefinition`,
  `isPathWritable(path): Promise<boolean>` (Task 2),
  `redactMcpEntry(entry): unknown` (Task 3), `newPlanId()`, `savePlan(home, plan)`.
- Produces: `planMcpRepair(registry, {agentId, home}): Promise<Plan>` with
  `plan.action === "mcp-repair"` and `plan.repair` populated. Task 6 and
  Task 7 depend on this shape.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/plan-mcp-repair.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { resolveEngramExecutable } from "../modules/memory-protocol/constants";
import { planMcpRepair } from "./plan-mcp-repair";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planrepair-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMcpRepair", () => {
  test("not-installed when the config file does not exist", async () => {
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("not-installed");
    expect(plan.noop).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });

  test("not-installed when the file exists but has no forge614-engram entry", async () => {
    writeFileSync(join(home, ".claude.json"), '{"mcpServers":{"other":{"command":"x","args":[]}}}');
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("not-installed");
  });

  test("already-correct when the canonical entry is already installed", async () => {
    const canonical = resolveEngramExecutable(home);
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: canonical, args: ["mcp"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("already-correct");
    expect(plan.noop).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });

  test("repairable-conflict for a stale Claude Code entry, preserving unrelated content", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("repairable-conflict");
    expect(plan.repair?.existing).toEqual({ command: "/old/path", args: ["serve"] });
    expect(plan.repair?.canonical).toEqual({ name: "forge614-engram", command: resolveEngramExecutable(home), args: ["mcp"] });
    expect(plan.noop).toBe(false);
    expect(plan.writes).toHaveLength(1);
    const parsed = JSON.parse(plan.writes[0].afterContent);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers.keep).toEqual({ command: "y", args: [] });
    expect(parsed.mcpServers["forge614-engram"]).toEqual({ command: resolveEngramExecutable(home), args: ["mcp"] });
  });

  test("repairable-conflict for a stale Codex entry", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `[mcp_servers.other]\ncommand = "z"\nargs = []\n\n[mcp_servers.forge614-engram]\ncommand = "/old/path"\nargs = ["serve"]\n`,
    );
    const plan = await planMcpRepair(registry, { agentId: "codex", home });
    expect(plan.repair?.status).toBe("repairable-conflict");
    expect(plan.writes).toHaveLength(1);
  });

  test("redacts non-command/args keys in the existing-entry preview", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"], env: { TOKEN: "secret" } } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.existing).toEqual({ command: "/old/path", args: ["serve"], env: "<redacted>" });
  });

  test("blocked with unparsable-config when the file is corrupt", async () => {
    writeFileSync(join(home, ".claude.json"), "{ not json at all");
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    expect(plan.repair?.status).toBe("blocked");
    expect(plan.repair?.blockedReason).toBe("unparsable-config");
    expect(plan.writes).toHaveLength(0);
  });

  test.skipIf(process.platform === "win32")("blocked with not-writable when the file cannot be written", async () => {
    const path = join(home, ".claude.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }));
    chmodSync(path, 0o444);
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    chmodSync(path, 0o644);
    expect(plan.repair?.status).toBe("blocked");
    expect(plan.repair?.blockedReason).toBe("not-writable");
    expect(plan.writes).toHaveLength(0);
  });

  test("throws for an unknown agent", async () => {
    await expect(planMcpRepair(registry, { agentId: "cursor" as never, home })).rejects.toThrow("Unknown agent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app/plan-mcp-repair.test.ts`
Expected: FAIL — `plan-mcp-repair.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// src/app/plan-mcp-repair.ts
import { createHash } from "node:crypto";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import type { McpRepairPreview, McpRepairStatus, Plan, PlanWrite } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { isPathWritable } from "../infrastructure/config-io/writable";
import { redactMcpEntry } from "../modules/config-writer/redact";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { newPlanId, savePlan } from "../infrastructure/plan-store";

export interface PlanMcpRepairInput {
  agentId: AgentId;
  home: string;
}

export async function planMcpRepair(registry: AgentRegistry, input: PlanMcpRepairInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const engramServer = resolveEngramMcpServer(input.home);
  const desired = adapter.mcpEntryShape(engramServer);
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);

  let status: McpRepairStatus;
  let blockedReason: McpRepairPreview["blockedReason"];
  let existingPreview: unknown;
  let writes: PlanWrite[] = [];

  if (!exists) {
    status = "not-installed";
  } else if (!format.isParsable(raw)) {
    status = "blocked";
    blockedReason = "unparsable-config";
  } else {
    const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, engramServer.name);
    if (existing === undefined) {
      status = "not-installed";
    } else if (JSON.stringify(existing) === JSON.stringify(desired)) {
      status = "already-correct";
    } else {
      existingPreview = redactMcpEntry(existing);
      if (await isPathWritable(configPath)) {
        status = "repairable-conflict";
        writes = [
          {
            path: configPath,
            beforeHash: createHash("sha256").update(raw).digest("hex"),
            afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, engramServer.name, desired),
          },
        ];
      } else {
        status = "blocked";
        blockedReason = "not-writable";
      }
    }
  }

  const repair: McpRepairPreview = {
    agentId: input.agentId,
    configPath,
    status,
    canonical: { name: engramServer.name, command: engramServer.command, args: engramServer.args },
    ...(existingPreview !== undefined ? { existing: existingPreview } : {}),
    ...(blockedReason ? { blockedReason } : {}),
  };

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-repair",
    noop: writes.length === 0,
    writes,
    repair,
  };

  await savePlan(input.home, plan);
  return plan;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/plan-mcp-repair.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`

```bash
git add src/app/plan-mcp-repair.ts src/app/plan-mcp-repair.test.ts
git commit -m "feat: add planMcpRepair"
```

---

## Task 6: `applyMcpRepair`

**Files:**
- Create: `src/app/apply-mcp-repair.ts`
- Test: `src/app/apply-mcp-repair.test.ts`

**Interfaces:**
- Consumes: `loadPlan(home, planId): Promise<Plan>` (from
  `../infrastructure/plan-store`), `applyPlan(home, planId): Promise<ApplyResult>`
  and `StalePlanError` (from `./apply-plan`), the `Plan.action === "mcp-repair"` /
  `Plan.repair` shape produced by Task 5.
- Produces: `applyMcpRepair(home, planId, confirmed): Promise<McpRepairApplyResult>`,
  `NotRepairableError`. Task 8 (CLI wiring) and Task 7's tests depend on
  these names.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/apply-mcp-repair.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { planMcpRepair } from "./plan-mcp-repair";
import { planMcpInstall } from "./plan-mcp-install";
import { applyMcpRepair, NotRepairableError } from "./apply-mcp-repair";
import { StalePlanError } from "./apply-plan";
import { resolveEngramExecutable } from "../modules/memory-protocol/constants";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-applyrepair-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("applyMcpRepair", () => {
  test("writes nothing and reports confirmed:false when not confirmed", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const result = await applyMcpRepair(home, plan.planId, false);
    expect(result.confirmed).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.changedFiles).toHaveLength(0);
    const stillOld = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    expect(stillOld.mcpServers["forge614-engram"]).toEqual({ command: "/old/path", args: ["serve"] });
  });

  test("applies the write when confirmed, preserving other content", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const result = await applyMcpRepair(home, plan.planId, true);
    expect(result.confirmed).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.changedFiles).toEqual([join(home, ".claude.json")]);
    const written = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    expect(written.other).toBe(true);
    expect(written.mcpServers.keep).toEqual({ command: "y", args: [] });
    expect(written.mcpServers["forge614-engram"]).toEqual({ command: resolveEngramExecutable(home), args: ["mcp"] });
  });

  test("fails closed with StalePlanError when the file changed since the plan", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, extra: { command: "z", args: [] } } }),
    );
    await expect(applyMcpRepair(home, plan.planId, true)).rejects.toThrow(StalePlanError);
  });

  test("is a no-write success for an already-correct plan even when confirmed", async () => {
    const canonical = resolveEngramExecutable(home);
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "forge614-engram": { command: canonical, args: ["mcp"] } } }));
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const result = await applyMcpRepair(home, plan.planId, true);
    expect(result.applied).toBe(true);
    expect(result.changedFiles).toHaveLength(0);
  });

  test("rejects a planId that is not a repair plan", async () => {
    const plan = await planMcpInstall(registry, { agentId: "claude-code", home, server: { name: "forge614-engram", command: "/x", args: ["mcp"] } });
    await expect(applyMcpRepair(home, plan.planId, true)).rejects.toThrow(NotRepairableError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app/apply-mcp-repair.test.ts`
Expected: FAIL — `apply-mcp-repair.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// src/app/apply-mcp-repair.ts
import { applyPlan, type ApplyResult } from "./apply-plan";
import { loadPlan } from "../infrastructure/plan-store";

export class NotRepairableError extends Error {
  constructor(planId: string) {
    super(`Plan "${planId}" is not a forge614-engram MCP repair plan`);
  }
}

export interface McpRepairApplyResult extends ApplyResult {
  confirmed: boolean;
}

export async function applyMcpRepair(home: string, planId: string, confirmed: boolean): Promise<McpRepairApplyResult> {
  const plan = await loadPlan(home, planId);
  if (plan.action !== "mcp-repair" || !plan.repair) throw new NotRepairableError(planId);

  if (!confirmed) {
    return { planId, applied: false, changedFiles: [], confirmed: false };
  }

  const result = await applyPlan(home, planId);
  return { ...result, confirmed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/apply-mcp-repair.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`

```bash
git add src/app/apply-mcp-repair.ts src/app/apply-mcp-repair.test.ts
git commit -m "feat: add applyMcpRepair with explicit confirmation"
```

---

## Task 7: `verifyMcpRepair`

**Files:**
- Create: `src/app/verify-mcp-repair.ts`
- Test: `src/app/verify-mcp-repair.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry.get`, `configFormats`, `resolveEngramMcpServer`,
  `loadPlan`, `snapshotDirectory` and `SnapshotManifest` (from
  `../infrastructure/snapshot/snapshot`), `NotRepairableError` (Task 6).
- Produces: `verifyMcpRepair(registry, {agentId, home, planId}): Promise<McpRepairVerification>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/verify-mcp-repair.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { codexAdapter } from "../infrastructure/agents/codex";
import { planMcpRepair } from "./plan-mcp-repair";
import { applyMcpRepair } from "./apply-mcp-repair";
import { verifyMcpRepair } from "./verify-mcp-repair";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-verifyrepair-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("verifyMcpRepair", () => {
  test("end-to-end for Claude Code: present, canonical, foreign entries preserved", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] }, keep: { command: "y", args: [] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    await applyMcpRepair(home, plan.planId, true);

    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.present).toBe(true);
    expect(verification.commandCanonical).toBe(true);
    expect(verification.argsCanonical).toBe(true);
    expect(verification.foreignPreserved).toBe(true);
    expect(verification.status).toBe("ok");
  });

  test("end-to-end for Codex", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      `[mcp_servers.other]\ncommand = "z"\nargs = []\n\n[mcp_servers.forge614-engram]\ncommand = "/old/path"\nargs = ["serve"]\n`,
    );
    const plan = await planMcpRepair(registry, { agentId: "codex", home });
    await applyMcpRepair(home, plan.planId, true);

    const verification = await verifyMcpRepair(registry, { agentId: "codex", home, planId: plan.planId });
    expect(verification.status).toBe("ok");
    expect(verification.foreignPreserved).toBe(true);
  });

  test("reports missing when the entry was never installed", async () => {
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.present).toBe(false);
    expect(verification.status).toBe("missing");
    expect(verification.foreignPreserved).toBe(true);
  });

  test("reports mismatch when not confirmed (conflict never repaired)", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/old/path", args: ["serve"] } } }),
    );
    const plan = await planMcpRepair(registry, { agentId: "claude-code", home });
    await applyMcpRepair(home, plan.planId, false);

    const verification = await verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId });
    expect(verification.status).toBe("mismatch");
    expect(verification.commandCanonical).toBe(false);
  });

  test("throws NotRepairableError for a non-repair plan", async () => {
    const { planMcpInstall } = await import("./plan-mcp-install");
    const { NotRepairableError } = await import("./apply-mcp-repair");
    const plan = await planMcpInstall(registry, { agentId: "claude-code", home, server: { name: "forge614-engram", command: "/x", args: ["mcp"] } });
    await expect(verifyMcpRepair(registry, { agentId: "claude-code", home, planId: plan.planId })).rejects.toThrow(NotRepairableError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app/verify-mcp-repair.test.ts`
Expected: FAIL — `verify-mcp-repair.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
// src/app/verify-mcp-repair.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { resolveEngramMcpServer } from "../modules/memory-protocol/constants";
import { loadPlan } from "../infrastructure/plan-store";
import { snapshotDirectory, type SnapshotManifest } from "../infrastructure/snapshot/snapshot";
import { NotRepairableError } from "./apply-mcp-repair";

export interface VerifyMcpRepairInput {
  agentId: AgentId;
  home: string;
  planId: string;
}

export interface McpRepairVerification {
  agentId: AgentId;
  planId: string;
  configPath: string;
  present: boolean;
  commandCanonical: boolean;
  argsCanonical: boolean;
  foreignPreserved: boolean;
  status: "ok" | "missing" | "mismatch";
}

export async function verifyMcpRepair(registry: AgentRegistry, input: VerifyMcpRepairInput): Promise<McpRepairVerification> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const plan = await loadPlan(input.home, input.planId);
  if (plan.action !== "mcp-repair" || !plan.repair) throw new NotRepairableError(input.planId);

  const engramServer = resolveEngramMcpServer(input.home);
  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);

  const parsable = !exists || format.isParsable(raw);
  const existing = parsable ? format.getMcpEntry(raw, adapter.mcpEntryPath, engramServer.name) : undefined;
  const entry = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : undefined;

  const present = entry !== undefined;
  const commandCanonical = present && entry!.command === engramServer.command;
  const argsCanonical =
    present &&
    Array.isArray(entry!.args) &&
    (entry!.args as unknown[]).length === engramServer.args.length &&
    (entry!.args as unknown[]).every((value, index) => value === engramServer.args[index]);

  let foreignPreserved = true;
  if (plan.writes.length > 0) {
    const dir = snapshotDirectory(input.home, input.planId);
    let beforeRaw: string | undefined;
    try {
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
      const entryManifest = manifest.files.find((file) => file.originalPath === configPath);
      if (entryManifest) beforeRaw = await readFile(join(dir, entryManifest.backupFileName), "utf8");
    } catch {
      beforeRaw = undefined;
    }
    if (beforeRaw === undefined) {
      // The repair was never confirmed/applied (no snapshot was ever taken), so
      // there is nothing to prove was preserved — fail closed on the claim.
      foreignPreserved = false;
    } else {
      const beforeStripped = format.withMcpEntry(beforeRaw, adapter.mcpEntryPath, engramServer.name, undefined);
      const afterStripped = format.withMcpEntry(raw, adapter.mcpEntryPath, engramServer.name, undefined);
      foreignPreserved = beforeStripped === afterStripped;
    }
  }

  const status: McpRepairVerification["status"] = !present ? "missing" : commandCanonical && argsCanonical ? "ok" : "mismatch";

  return {
    agentId: input.agentId,
    planId: input.planId,
    configPath,
    present,
    commandCanonical: Boolean(commandCanonical),
    argsCanonical: Boolean(argsCanonical),
    foreignPreserved,
    status,
  };
}
```

Note on the "not confirmed" test case in Step 1: when `applyMcpRepair` is
called with `confirmed: false`, it returns early and never calls
`applyPlan`, so `createSnapshot` never runs and no snapshot directory
exists for that `planId`. `plan.writes.length > 0` is still true (the
plan itself has a queued write), so the code above takes the
snapshot-comparison branch, finds no manifest, and sets
`foreignPreserved = false`. That's intentionally conservative — this
plan's write was never actually applied, so nothing was proven preserved.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/verify-mcp-repair.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`

```bash
git add src/app/verify-mcp-repair.ts src/app/verify-mcp-repair.test.ts
git commit -m "feat: add verifyMcpRepair"
```

---

## Task 8: CLI wiring (`plan mcp-repair`, `apply mcp-repair`, `verify mcp-repair`)

**Files:**
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/interfaces/cli/main.ts`
- Test: `src/interfaces/cli/cli.test.ts`

**Interfaces:**
- Consumes: `planMcpRepair`, `applyMcpRepair`, `verifyMcpRepair`,
  `NotRepairableError` (Tasks 5–7).
- Produces: three new CLI subcommands and one new error code
  (`NOT_REPAIRABLE`).

- [ ] **Step 1: Read the existing `cli.test.ts` to match its style**

Read `src/interfaces/cli/cli.test.ts` in full before writing new tests —
match its existing import style and how it tests `collectArgsUntilNextFlag`/
`errorCodeFor` (these are the two exported pure functions `main.ts`
exposes for direct unit testing; the command handlers themselves are
exercised through `commands.ts` unit tests instead, following the same
split the existing suite already uses for `mcp-install`/`mcp-remove`).

- [ ] **Step 2: Write the failing test**

Append to `src/interfaces/cli/cli.test.ts` (adjust the import list at the
top to add `NotRepairableError` from `../../app/apply-mcp-repair`):

```ts
import { NotRepairableError } from "../../app/apply-mcp-repair";
```

```ts
describe("errorCodeFor — mcp-repair", () => {
  test("maps NotRepairableError to NOT_REPAIRABLE", () => {
    expect(errorCodeFor(new NotRepairableError("abc"))).toBe("NOT_REPAIRABLE");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/interfaces/cli/cli.test.ts`
Expected: FAIL — `errorCodeFor` doesn't know `NotRepairableError` yet
(falls through to `INTERNAL_ERROR`).

- [ ] **Step 4: Implement — `commands.ts`**

In `src/interfaces/cli/commands.ts`, add imports:

```ts
import { applyMcpRepair } from "../../app/apply-mcp-repair";
import { planMcpRepair } from "../../app/plan-mcp-repair";
import { verifyMcpRepair } from "../../app/verify-mcp-repair";
```

Add functions (near the other `runPlan*`/`runVerify*` functions):

```ts
export async function runPlanMcpRepair(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMcpRepair(registry, { agentId, home: homedir() });
  printJson({ plan });
}

export async function runApplyMcpRepair(planId: string, confirmed: boolean): Promise<void> {
  const result = await applyMcpRepair(homedir(), planId, confirmed);
  printJson({ result });
}

export async function runVerifyMcpRepair(agentId: AgentId, planId: string): Promise<void> {
  const registry = buildDefaultRegistry();
  const verification = await verifyMcpRepair(registry, { agentId, home: homedir(), planId });
  printJson({ verification });
}
```

- [ ] **Step 5: Implement — `main.ts`**

Add imports:

```ts
import { runApplyMcpRepair, runPlanMcpRepair, runVerifyMcpRepair } from "./commands";
import { NotRepairableError } from "../../app/apply-mcp-repair";
```

(Merge these into the existing multi-line import from `"./commands"`
rather than adding a second import statement from the same module.)

In `errorCodeFor`, add one line (anywhere among the other
`instanceof` checks, before the final fallback):

```ts
if (error instanceof NotRepairableError) return "NOT_REPAIRABLE";
```

In `main()`, add three new blocks. Place the `plan mcp-repair` block next
to the other `plan` blocks:

```ts
if (command === "plan" && subcommand === "mcp-repair") {
  const agentId = flag(rest, "--agent") as AgentId;
  return runPlanMcpRepair(agentId);
}
```

Place `verify mcp-repair` next to the existing `verify memory-integration`
block:

```ts
if (command === "verify" && subcommand === "mcp-repair") {
  const agentId = flag(rest, "--agent") as AgentId;
  const planId = flag(rest, "--plan-id")!;
  return runVerifyMcpRepair(agentId, planId);
}
```

Place `apply mcp-repair` **immediately before** the existing generic
`if (command === "apply") { ... }` block (it must be checked first, since
both match on `command === "apply"`):

```ts
if (command === "apply" && subcommand === "mcp-repair") {
  const planId = flag(rest, "--plan-id")!;
  const confirmed = boolFlag(rest, "--confirm");
  return runApplyMcpRepair(planId, confirmed);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/interfaces/cli/cli.test.ts`
Expected: PASS.

Run: `bun test`
Expected: full suite PASS (this touches shared CLI dispatch, so run
everything, not just the new file).

- [ ] **Step 7: Manual smoke test of the wired CLI**

```bash
mkdir -p /tmp/engines-smoke-home
echo '{"mcpServers":{"forge614-engram":{"command":"/old/path","args":["serve"]}}}' > /tmp/engines-smoke-home/.claude.json
HOME=/tmp/engines-smoke-home bun src/interfaces/cli/main.ts plan mcp-repair --agent claude-code
```

Expected: JSON with `plan.repair.status === "repairable-conflict"` and a
`planId`. Then, using that `planId`:

```bash
HOME=/tmp/engines-smoke-home bun src/interfaces/cli/main.ts apply mcp-repair --plan-id <planId>
```

Expected: `result.confirmed === false`, `result.applied === false`, and
`/tmp/engines-smoke-home/.claude.json` is unchanged (check with `cat`).
Then:

```bash
HOME=/tmp/engines-smoke-home bun src/interfaces/cli/main.ts apply mcp-repair --plan-id <planId> --confirm
```

Expected: `result.confirmed === true`, `result.applied === true`, and the
file now has the canonical entry. Clean up: `rm -rf /tmp/engines-smoke-home`.

- [ ] **Step 8: Commit**

```bash
git add src/interfaces/cli/commands.ts src/interfaces/cli/main.ts src/interfaces/cli/cli.test.ts
git commit -m "feat: wire plan/apply/verify mcp-repair into the CLI"
```

---

## Task 9: Keep `scripts/verify-documentation.mjs` aware of the new commands

**Files:**
- Modify: `scripts/verify-documentation.mjs`

**Interfaces:**
- Consumes: nothing new from earlier tasks — this only widens a regex so
  the existing `verifyDocumentation()` recognizes the three new CLI terms
  once Task 10 documents them.

**Context:** `publicCliContract()` extracts recognized `plan`/`verify`
subcommand terms with a narrow regex tied to the exact subcommand names
that existed before this task. Task 8 added `command === "apply" &&
subcommand === "mcp-repair"` (a new *combination*: `apply` gains a
subcommand form it never had), plus `mcp-repair` under `plan`/`verify`.
Without this change, `bun run verify:docs` would fail with `Unknown CLI
term` once Task 10's docs mention `plan mcp-repair` / `apply mcp-repair` /
`verify mcp-repair`. This script is not run in CI today (`.github/workflows/verify.yml`
does not call `bun run verify:docs`), so this task does not block Task
8's `bun test`/`typecheck`, but it must land before Task 10 leaves
`verify:docs` broken.

- [ ] **Step 1: Read the current regex**

Read `scripts/verify-documentation.mjs` and find this line inside
`publicCliContract`:

```js
for (const subcommand of source.matchAll(
  /command === "(plan|verify)" && subcommand === "((?:mcp|memory)-(?:install|remove)|memory-integration)"/g,
)) {
```

- [ ] **Step 2: Edit it**

Replace that line with:

```js
for (const subcommand of source.matchAll(
  /command === "(plan|verify|apply)" && subcommand === "((?:mcp|memory)-(?:install|remove)|memory-integration|mcp-repair)"/g,
)) {
```

- [ ] **Step 3: Verify the regex change alone (no doc changes yet) doesn't break anything**

Run: `bun run verify:docs`
Expected: still passes — this step only widens what the parser is
*capable* of recognizing; `main.ts` already has real `apply`+`mcp-repair`,
`plan`+`mcp-repair`, `verify`+`mcp-repair` combinations after Task 8, so
`commands` now additionally contains `"plan mcp-repair"`, `"apply
mcp-repair"`, `"verify mcp-repair"` — none of which any doc references
yet, so nothing new is required to mention them.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-documentation.mjs
git commit -m "chore: recognize mcp-repair CLI subcommands in verify-documentation"
```

---

## Task 10: Documentation (es/en, 03/04/05) and fingerprint refresh

**Files:**
- Modify: `docs/es/03-plan-seguro-de-mcp.md`
- Modify: `docs/en/03-safe-mcp-planning.md`
- Modify: `docs/es/04-aplicacion-segura-y-recuperacion.md`
- Modify: `docs/en/04-safe-application-and-recovery.md`
- Modify: `docs/es/05-referencia-del-cli-publico.md`
- Modify: `docs/en/05-public-cli-reference.md`
- Modify: `docs/notion-map.json` (only via the `--refresh-fingerprints`
  command below — never hand-edit the `sha256` fields)

**Context:** Read all six target files in full before editing (each pair
already read for 03/05 during design; also read 04 in both languages
before writing into it) so new sections match each file's existing
heading style, tone, and cross-reference conventions (e.g. `(ver 06)`-
style back-references, the "La analogía" opening pattern used in 03/05).

- [ ] **Step 1: Extend `docs/es/03-plan-seguro-de-mcp.md`**

Add a new section after "Planear la integración de memoria" and before
"Resolver Engram sin depender de PATH":

```markdown
## Reparar un conflicto MCP existente

```text
forge614-engines plan mcp-repair --agent codex
```

`plan mcp-repair` clasifica la entrada `forge614-engram` en uno de cuatro
estados: `not-installed` (no existe), `already-correct` (ya es la
canónica, no hay nada que hacer), `repairable-conflict` (existe con otro
contenido y el archivo se puede escribir) o `blocked` (el archivo está
dañado —`blockedReason: "unparsable-config"`— o no se puede escribir
—`blockedReason: "not-writable"`—). El plan trae `repair.existing`: una
vista previa de la entrada conflictiva donde solo `command` y `args` se
muestran tal cual; cualquier otra clave (por ejemplo un `env` con
credenciales de otra herramienta) aparece como `"<redacted>"`. Shell debe
mostrar `plan.repair`, no `plan.writes[].afterContent` (ese campo es
plomería interna con el archivo completo, igual que en cualquier otro
plan, y se guarda con acceso restringido).
```

- [ ] **Step 2: Extend `docs/en/03-safe-mcp-planning.md`**

Add the mirrored English section, in the same position, using the
existing English file's tone (read it first for exact phrasing style —
its "The analogy" framing and heading level pattern).

- [ ] **Step 3: Extend `docs/es/04-aplicacion-segura-y-recuperacion.md`**

Read the file first, then add a section describing the confirmed-apply
step:

```markdown
## Aplicar una reparación solo con confirmación explícita

```text
forge614-engines apply mcp-repair --plan-id <id> --confirm
```

A diferencia de `apply` genérico, `apply mcp-repair` exige la bandera
`--confirm`. Sin ella, la respuesta trae `confirmed: false` y
`applied: false`, y Engines no lee, no calcula huellas ni escribe nada.
Con `--confirm`, aplica el mismo mecanismo que cualquier otro plan: huella
del contenido anterior, respaldo (snapshot) y escritura atómica. Si el
archivo cambió desde que se generó el plan, falla con `STALE_PLAN` y no
sobrescribe nada.
```

- [ ] **Step 4: Extend `docs/en/04-safe-application-and-recovery.md`**

Mirror Step 3 in English, matching that file's existing style.

- [ ] **Step 5: Extend `docs/es/05-referencia-del-cli-publico.md`**

Add three rows to the commands table (after the `verify memory-integration`
row):

```markdown
| `forge614-engines plan mcp-repair --agent <id>` | `plan` de reparación con estado (`not-installed`/`already-correct`/`repairable-conflict`/`blocked`) | Solo guarda el plan |
| `forge614-engines apply mcp-repair --plan-id <id> [--confirm]` | `result` de aplicación confirmada | Sí, y solo con `--confirm` |
| `forge614-engines verify mcp-repair --agent <id> --plan-id <id>` | `verification` de esa reparación puntual | No |
```

Add one row to the errors table:

```markdown
| `NOT_REPAIRABLE` | el `planId` dado no es un plan de reparación de `forge614-engram` |
```

- [ ] **Step 6: Extend `docs/en/05-public-cli-reference.md`**

Mirror Steps 5's table rows in English, matching that file's existing
column wording.

- [ ] **Step 7: Refresh fingerprints**

```bash
bun scripts/verify-documentation.mjs --refresh-fingerprints
```

- [ ] **Step 8: Verify**

Run: `bun run verify:docs`
Expected: passes, reporting the same total document count as before
(this task adds no new documents, only edits existing ones).

- [ ] **Step 9: Commit**

```bash
git add docs/es/03-plan-seguro-de-mcp.md docs/en/03-safe-mcp-planning.md \
  docs/es/04-aplicacion-segura-y-recuperacion.md docs/en/04-safe-application-and-recovery.md \
  docs/es/05-referencia-del-cli-publico.md docs/en/05-public-cli-reference.md \
  docs/notion-map.json
git commit -m "docs: document plan/apply/verify mcp-repair"
```

---

## Task 11: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all tests pass, including every new file from Tasks 1–8.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Check for merge-conflict markers / whitespace issues**

Run: `git diff --check`
Expected: no output (no issues).

- [ ] **Step 4: Confirm nothing outside the intended scope changed**

Run: `git status` and `git diff --stat`
Expected: only the files listed across Tasks 1–10 are modified/created —
nothing under a different product's directory, no `.claude/agents/`
additions, no release/version bump, no TUI files.

- [ ] **Step 5: Re-read the design doc's required-tests list and confirm coverage**

Cross-check `docs/superpowers/specs/2026-09-21-forge614-engines-mcp-conflict-repair-design.md`
against the tests written in Tasks 5–7: stale-Claude-conflict → repair →
verify (Task 7), stale-Codex-conflict → repair → verify (Task 7), no
confirmation → zero writes (Task 6), file changed after plan → fails
without overwriting (Task 6), other MCP entries survive byte-for-byte
(Task 5 + Task 7's `foreignPreserved`), already-correct entry → no-op
(Task 5 + Task 6), absent entry → normal `not-installed` flow, no
duplication (Task 5 + Task 7), canonical path resolution (reused,
pre-existing `resolveEngramExecutable` coverage plus Task 5's own
assertions against it), custom `FORGE614_HOME` (already covered by
`resolveEngramExecutable`'s existing tests, exercised transitively by
every Task 5 test through `resolveEngramMcpServer`), no secret leakage
(Task 3's `redactMcpEntry` tests), `bun test`/`bun run typecheck`/
`git diff --check` (this task's Steps 1–3). If any of these has no
concrete assertion behind it, add it before considering the plan done.

This task has no code to commit — it's the final gate before declaring
the plan complete.
