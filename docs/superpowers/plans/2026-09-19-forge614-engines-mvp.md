# forge614-engines MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working `forge614-engines` CLI that detects Claude Code, Codex and Cursor on the machine, and can safely plan/preview → snapshot → apply installing or removing an MCP server entry in each of their configs.

**Architecture:** Layered TypeScript on Bun (`modules/` pure types+rules, `infrastructure/` real fs/process adapters, `app/` orchestration, `interfaces/cli/` the CLI surface), enforced by an AST-based import-layering test. Each agent is one adapter module implementing a shared `AgentAdapter` interface; adding an agent never requires touching `detect`/`plan`/`apply` logic.

**Tech Stack:** TypeScript, Bun (runtime + test runner), `jsonc-parser` (JSON/JSONC edits), `smol-toml` (TOML for Codex).

**Spec:** `docs/superpowers/specs/2026-09-19-forge614-engines-design.md`

## Global Constraints

- No TUI, no interactive prompts — this product never talks to the end user directly (spec §2).
- No autonomous writes — every config write goes through `plan` (read-only) → snapshot → `apply`, and `apply` only runs when given a `planId` (spec §5).
- All CLI output is JSON with a `schemaVersion` field (spec §6).
- Storage lives only under `~/.forge614/engines/` — never touch sibling product folders (spec §7).
- `modules/` never imports `infrastructure/`, `app/`, or `interfaces/`; `infrastructure/` never imports `app/` or `interfaces/`; `app/` never imports `interfaces/` (spec §9, enforced by Task 14).
- Detection is always live — no required caching in this plan (spec §4).

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/smoke.test.ts`

**Interfaces:**
- Produces: a working `bun test` and `bun run typecheck` toolchain that every later task relies on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "forge614-engines",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "bun-types": "^1.3.8"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.tmp
```

- [ ] **Step 4: Install dependencies**

Run: `bun install`

- [ ] **Step 5: Write the smoke test**

```ts
// src/smoke.test.ts
import { describe, expect, test } from "bun:test";

describe("project scaffolding", () => {
  test("bun test runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it**

Run: `bun test`
Expected: 1 pass.

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore src/smoke.test.ts bun.lock
git commit -m "chore: scaffold bun/typescript project"
```

---

### Task 2: Agent adapter types + registry with capability validation

**Files:**
- Create: `src/modules/agents/types.ts`
- Create: `src/modules/agents/registry.ts`
- Test: `src/modules/agents/registry.test.ts`

**Interfaces:**
- Produces: `AgentAdapter`, `AgentId`, `ConfigFormat`, `AgentCapabilities`, `McpServerDefinition`, `HeadlessOptions`, `HeadlessCommand` (types.ts); `AgentRegistry`, `DuplicateAgentError`, `InvalidCapabilityManifestError`, `validateCapabilityManifest` (registry.ts). Every later task imports from these two files.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/agents/registry.test.ts
import { describe, expect, test } from "bun:test";
import { AgentRegistry, DuplicateAgentError, InvalidCapabilityManifestError } from "./registry";
import type { AgentAdapter } from "./types";

function fakeAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    id: "claude-code",
    label: "Fake",
    capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false },
    configFormat: "json",
    mcpEntryPath: ["mcpServers"],
    candidateExecutableNames: () => ["fake"],
    knownInstallPaths: () => [],
    configDir: (home) => `${home}/.fake`,
    configFile: (home) => `${home}/.fake.json`,
    mcpEntryShape: (server) => ({ command: server.command, args: server.args }),
    ...overrides,
  };
}

describe("AgentRegistry", () => {
  test("registers and retrieves a valid adapter", () => {
    const registry = new AgentRegistry();
    registry.register(fakeAdapter());
    expect(registry.get("claude-code")?.label).toBe("Fake");
    expect(registry.list()).toHaveLength(1);
  });

  test("rejects duplicate registration", () => {
    const registry = new AgentRegistry();
    registry.register(fakeAdapter());
    expect(() => registry.register(fakeAdapter())).toThrow(DuplicateAgentError);
  });

  test("rejects an adapter claiming headless support without headlessCommand", () => {
    const registry = new AgentRegistry();
    const adapter = fakeAdapter({
      capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: true },
    });
    expect(() => registry.register(adapter)).toThrow(InvalidCapabilityManifestError);
  });

  test("rejects an adapter claiming MCP support with an empty mcpEntryPath", () => {
    const registry = new AgentRegistry();
    const adapter = fakeAdapter({ mcpEntryPath: [] });
    expect(() => registry.register(adapter)).toThrow(InvalidCapabilityManifestError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/agents/registry.test.ts`
Expected: FAIL (`./registry` and `./types` don't exist yet).

- [ ] **Step 3: Create `src/modules/agents/types.ts`**

```ts
export type AgentId = "claude-code" | "codex" | "cursor";

export type ConfigFormat = "json";

export interface McpServerDefinition {
  name: string;
  command: string;
  args: string[];
}

export interface HeadlessOptions {
  prompt: string;
  timeoutMs?: number;
}

export interface HeadlessCommand {
  command: string;
  args: string[];
}

export interface AgentCapabilities {
  supportsMcp: boolean;
  supportsHooks: boolean;
  supportsHeadlessExec: boolean;
}

export interface AgentAdapter {
  id: AgentId;
  label: string;
  capabilities: AgentCapabilities;
  configFormat: ConfigFormat;
  /** Key path inside the config document where MCP servers live, e.g. ["mcpServers"]. */
  mcpEntryPath: string[];
  candidateExecutableNames(platform: NodeJS.Platform): string[];
  knownInstallPaths(platform: NodeJS.Platform, home: string): string[];
  configDir(home: string): string;
  configFile(home: string): string;
  mcpEntryShape(server: McpServerDefinition): unknown;
  headlessCommand?(executable: string, opts: HeadlessOptions): HeadlessCommand;
}
```

- [ ] **Step 4: Create `src/modules/agents/registry.ts`**

```ts
import type { AgentAdapter, AgentId } from "./types";

export class DuplicateAgentError extends Error {
  constructor(id: AgentId) {
    super(`Agent already registered: ${id}`);
  }
}

export class InvalidCapabilityManifestError extends Error {
  constructor(id: AgentId, reason: string) {
    super(`Invalid capability manifest for ${id}: ${reason}`);
  }
}

export function validateCapabilityManifest(adapter: AgentAdapter): void {
  if (adapter.capabilities.supportsHeadlessExec && typeof adapter.headlessCommand !== "function") {
    throw new InvalidCapabilityManifestError(
      adapter.id,
      "supportsHeadlessExec is true but headlessCommand() is not implemented",
    );
  }
  if (adapter.capabilities.supportsMcp && adapter.mcpEntryPath.length === 0) {
    throw new InvalidCapabilityManifestError(adapter.id, "supportsMcp is true but mcpEntryPath is empty");
  }
}

export class AgentRegistry {
  private readonly adapters = new Map<AgentId, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) throw new DuplicateAgentError(adapter.id);
    validateCapabilityManifest(adapter);
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentId): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/modules/agents/registry.test.ts`
Expected: 4 pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agents/types.ts src/modules/agents/registry.ts src/modules/agents/registry.test.ts
git commit -m "feat: add agent adapter interface and self-validating registry"
```

---

### Task 3: Detection infrastructure (PATH scan + per-agent detection)

**Files:**
- Create: `src/infrastructure/detection/path-scan.ts`
- Create: `src/infrastructure/detection/path-scan.test.ts`
- Create: `src/infrastructure/detection/detect-agent.ts`
- Create: `src/infrastructure/detection/detect-agent.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter` (Task 2).
- Produces: `findExecutableInPath(candidateNames, env, platform)`, `detectAgent(adapter, home, env, platform)`, `AgentDetectionResult`.

- [ ] **Step 1: Write the failing test for path scanning**

```ts
// src/infrastructure/detection/path-scan.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutableInPath } from "./path-scan";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-pathscan-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("findExecutableInPath", () => {
  test("finds an executable file in PATH", async () => {
    const binPath = join(dir, "fake-agent");
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, "darwin");
    expect(result).toBe(binPath);
  });

  test("ignores a non-executable file", async () => {
    writeFileSync(join(dir, "fake-agent"), "not executable");

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, "darwin");
    expect(result).toBeUndefined();
  });

  test("ignores a directory that shares the binary's name", async () => {
    mkdirSync(join(dir, "fake-agent"));

    const result = await findExecutableInPath(["fake-agent"], { PATH: dir }, "darwin");
    expect(result).toBeUndefined();
  });

  test("dedupes repeated PATH directories", async () => {
    const binPath = join(dir, "fake-agent");
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);

    const result = await findExecutableInPath(["fake-agent"], { PATH: `${dir}:${dir}` }, "darwin");
    expect(result).toBe(binPath);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/infrastructure/detection/path-scan.test.ts`
Expected: FAIL (`./path-scan` doesn't exist).

- [ ] **Step 3: Implement `path-scan.ts`**

```ts
// src/infrastructure/detection/path-scan.ts
import { access, stat, constants } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export async function findExecutableInPath(
  candidateNames: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const separator = platform === "win32" ? ";" : ":";
  const directories = [...new Set(pathValue.split(separator).filter((dir) => isAbsolute(dir)))];

  for (const directory of directories) {
    for (const name of candidateNames) {
      const candidate = join(directory, name);
      try {
        const info = await stat(candidate);
        if (!info.isFile()) continue;
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/infrastructure/detection/path-scan.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Write the failing test for `detectAgent`**

```ts
// src/infrastructure/detection/detect-agent.test.ts
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

function fakeAdapter(): AgentAdapter {
  return {
    id: "claude-code",
    label: "Fake",
    capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false },
    configFormat: "json",
    mcpEntryPath: ["mcpServers"],
    candidateExecutableNames: () => ["fake-agent"],
    knownInstallPaths: () => [],
    configDir: (h) => join(h, ".fake"),
    configFile: (h) => join(h, ".fake.json"),
    mcpEntryShape: (server) => ({ command: server.command, args: server.args }),
  };
}

describe("detectAgent", () => {
  test("reports installed:false, configFound:false when nothing exists", async () => {
    const result = await detectAgent(fakeAdapter(), home, { PATH: dir }, "darwin");
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

    const result = await detectAgent(fakeAdapter(), home, { PATH: dir }, "darwin");
    expect(result.installed).toBe(true);
    expect(result.executable).toBe(binPath);
    expect(result.configFound).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test src/infrastructure/detection/detect-agent.test.ts`
Expected: FAIL (`./detect-agent` doesn't exist).

- [ ] **Step 7: Implement `detect-agent.ts`**

```ts
// src/infrastructure/detection/detect-agent.ts
import { stat } from "node:fs/promises";
import type { AgentAdapter, AgentId } from "../../modules/agents/types";
import { findExecutableInPath } from "./path-scan";

export interface AgentDetectionResult {
  id: AgentId;
  label: string;
  installed: boolean;
  executable: string | undefined;
  configDir: string;
  configFound: boolean;
}

export async function detectAgent(
  adapter: AgentAdapter,
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<AgentDetectionResult> {
  let executable = await findExecutableInPath(adapter.candidateExecutableNames(platform), env, platform);

  if (!executable) {
    for (const candidate of adapter.knownInstallPaths(platform, home)) {
      try {
        const info = await stat(candidate);
        if (info.isFile()) {
          executable = candidate;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  const configDirPath = adapter.configDir(home);
  let configFound = false;
  try {
    await stat(configDirPath);
    configFound = true;
  } catch {
    configFound = false;
  }

  return {
    id: adapter.id,
    label: adapter.label,
    installed: executable !== undefined,
    executable,
    configDir: configDirPath,
    configFound,
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test src/infrastructure/detection/detect-agent.test.ts`
Expected: 2 pass.

- [ ] **Step 9: Commit**

```bash
git add src/infrastructure/detection
git commit -m "feat: add PATH scanning and per-agent detection"
```

---

### Task 4: Claude Code adapter

**Files:**
- Create: `src/infrastructure/agents/claude-code.ts`
- Create: `src/infrastructure/agents/claude-code.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter`, `McpServerDefinition` (Task 2).
- Produces: `claudeCodeAdapter: AgentAdapter`.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/agents/claude-code.test.ts
import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "./claude-code";

describe("claudeCodeAdapter", () => {
  test("has the expected identity and capabilities", () => {
    expect(claudeCodeAdapter.id).toBe("claude-code");
    expect(claudeCodeAdapter.capabilities).toEqual({
      supportsMcp: true,
      supportsHooks: true,
      supportsHeadlessExec: true,
    });
  });

  test("points at ~/.claude.json for config", () => {
    expect(claudeCodeAdapter.configFile("/home/u")).toBe("/home/u/.claude.json");
    expect(claudeCodeAdapter.configDir("/home/u")).toBe("/home/u/.claude");
  });

  test("builds the {command,args} MCP entry shape", () => {
    const shape = claudeCodeAdapter.mcpEntryShape({ name: "forge614-engram", command: "/bin/engram", args: ["mcp"] });
    expect(shape).toEqual({ command: "/bin/engram", args: ["mcp"] });
  });

  test("builds a headless invocation with -p", () => {
    const headless = claudeCodeAdapter.headlessCommand?.("/bin/claude", { prompt: "hello" });
    expect(headless).toEqual({ command: "/bin/claude", args: ["-p", "hello"] });
  });

  test("uses claude.exe as the candidate name on windows", () => {
    expect(claudeCodeAdapter.candidateExecutableNames("win32")).toEqual(["claude.exe"]);
    expect(claudeCodeAdapter.candidateExecutableNames("darwin")).toEqual(["claude"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/infrastructure/agents/claude-code.test.ts`
Expected: FAIL (`./claude-code` doesn't exist).

- [ ] **Step 3: Implement `claude-code.ts`**

```ts
// src/infrastructure/agents/claude-code.ts
import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  label: "Claude Code",
  capabilities: { supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true },
  configFormat: "json",
  mcpEntryPath: ["mcpServers"],
  candidateExecutableNames(platform) {
    return platform === "win32" ? ["claude.exe"] : ["claude"];
  },
  knownInstallPaths(_platform, home) {
    return [join(home, ".local", "bin", "claude")];
  },
  configDir(home) {
    return join(home, ".claude");
  },
  configFile(home) {
    return join(home, ".claude.json");
  },
  mcpEntryShape(server: McpServerDefinition) {
    return { command: server.command, args: server.args };
  },
  headlessCommand(executable, opts) {
    return { command: executable, args: ["-p", opts.prompt] };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/infrastructure/agents/claude-code.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/agents/claude-code.ts src/infrastructure/agents/claude-code.test.ts
git commit -m "feat: add Claude Code agent adapter"
```

---

### Task 5: Detection orchestration, default registry, and the `detect` CLI command

**Files:**
- Create: `src/app/default-registry.ts`
- Create: `src/app/detect.ts`
- Create: `src/app/detect.test.ts`
- Create: `src/interfaces/cli/commands.ts`
- Create: `src/interfaces/cli/main.ts`
- Test: `src/interfaces/cli/cli.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry` (Task 2), `claudeCodeAdapter` (Task 4), `detectAgent`/`AgentDetectionResult` (Task 3).
- Produces: `buildDefaultRegistry()`, `detectAgents(registry, home, env, platform)`, CLI command `detect`.

- [ ] **Step 1: Write the failing test for `detectAgents`**

```ts
// src/app/detect.test.ts
import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { detectAgents } from "./detect";
import type { AgentAdapter } from "../modules/agents/types";

function fakeAdapter(id: AgentAdapter["id"]): AgentAdapter {
  return {
    id,
    label: id,
    capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false },
    configFormat: "json",
    mcpEntryPath: ["mcpServers"],
    candidateExecutableNames: () => [],
    knownInstallPaths: () => [],
    configDir: (h) => `${h}/.${id}`,
    configFile: (h) => `${h}/.${id}.json`,
    mcpEntryShape: (server) => ({ command: server.command, args: server.args }),
  };
}

describe("detectAgents", () => {
  test("runs detection for every registered adapter", async () => {
    const registry = new AgentRegistry();
    registry.register(fakeAdapter("claude-code"));
    registry.register(fakeAdapter("codex"));

    const results = await detectAgents(registry, "/home/u", { PATH: "" }, "darwin");
    expect(results.map((r) => r.id).sort()).toEqual(["claude-code", "codex"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/detect.test.ts`
Expected: FAIL (`./detect` doesn't exist).

- [ ] **Step 3: Implement `src/app/detect.ts`**

```ts
import type { AgentRegistry } from "../modules/agents/registry";
import { detectAgent, type AgentDetectionResult } from "../infrastructure/detection/detect-agent";

export async function detectAgents(
  registry: AgentRegistry,
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<AgentDetectionResult[]> {
  const results: AgentDetectionResult[] = [];
  for (const adapter of registry.list()) {
    results.push(await detectAgent(adapter, home, env, platform));
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/app/detect.test.ts`
Expected: 1 pass.

- [ ] **Step 5: Implement `src/app/default-registry.ts`**

```ts
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";

export function buildDefaultRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  return registry;
}
```

- [ ] **Step 6: Implement `src/interfaces/cli/commands.ts`**

```ts
import { homedir } from "node:os";
import { buildDefaultRegistry } from "../../app/default-registry";
import { detectAgents } from "../../app/detect";

const SCHEMA_VERSION = 1;

export function printJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...payload }, null, 2));
}

export async function runDetect(): Promise<void> {
  const registry = buildDefaultRegistry();
  const agents = await detectAgents(registry, homedir(), process.env, process.platform);
  printJson({ agents });
}
```

- [ ] **Step 7: Implement `src/interfaces/cli/main.ts`**

```ts
#!/usr/bin/env bun
import { runDetect } from "./commands";

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  if (command === "detect") {
    await runDetect();
    return;
  }

  console.error(`Unknown command: ${process.argv.slice(2).join(" ")}`);
  process.exitCode = 1;
}

main();
```

- [ ] **Step 8: Write a subprocess-level CLI test**

```ts
// src/interfaces/cli/cli.test.ts
import { describe, expect, test } from "bun:test";

describe("forge614-engines CLI", () => {
  test("detect --json outputs a schemaVersion and an agents array", async () => {
    const proc = Bun.spawn(["bun", "src/interfaces/cli/main.ts", "detect"], {
      stdout: "pipe",
      env: { ...process.env },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe(1);
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents.some((a: { id: string }) => a.id === "claude-code")).toBe(true);
  });
});
```

- [ ] **Step 9: Run all tests**

Run: `bun test`
Expected: all pass, including the new CLI test.

- [ ] **Step 10: Commit**

```bash
git add src/app/default-registry.ts src/app/detect.ts src/app/detect.test.ts src/interfaces/cli
git commit -m "feat: wire up detect command end to end"
```

---

### Task 6: JSON config format I/O

**Files:**
- Create: `src/infrastructure/config-io/config-format.ts`
- Create: `src/infrastructure/config-io/json-format.ts`
- Create: `src/infrastructure/config-io/json-format.test.ts`
- Create: `src/infrastructure/config-io/formats.ts`

**Interfaces:**
- Produces: `ConfigFormatIO` interface, `jsonConfigFormat: ConfigFormatIO`, `configFormats: Record<ConfigFormat, ConfigFormatIO>`.

- [ ] **Step 1: Add the `jsonc-parser` dependency**

Run: `bun add jsonc-parser`

- [ ] **Step 2: Write the failing test**

```ts
// src/infrastructure/config-io/json-format.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonConfigFormat } from "./json-format";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-jsonfmt-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("jsonConfigFormat", () => {
  test("readOrDefault returns exists:false and '{}' when the file is missing", async () => {
    const result = await jsonConfigFormat.readOrDefault(join(dir, "missing.json"));
    expect(result).toEqual({ raw: "{}", exists: false });
  });

  test("readOrDefault returns the real content when the file exists", async () => {
    const path = join(dir, "config.json");
    writeFileSync(path, '{"other":true}');
    const result = await jsonConfigFormat.readOrDefault(path);
    expect(result).toEqual({ raw: '{"other":true}', exists: true });
  });

  test("getMcpEntry reads a nested value, undefined if absent", () => {
    expect(jsonConfigFormat.getMcpEntry('{"mcpServers":{"foo":{"command":"x"}}}', ["mcpServers"], "foo")).toEqual({
      command: "x",
    });
    expect(jsonConfigFormat.getMcpEntry("{}", ["mcpServers"], "foo")).toBeUndefined();
  });

  test("withMcpEntry inserts a new entry without touching unrelated keys", () => {
    const updated = jsonConfigFormat.withMcpEntry('{"other":true}', ["mcpServers"], "foo", { command: "x", args: [] });
    const parsed = JSON.parse(updated);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers.foo).toEqual({ command: "x", args: [] });
  });

  test("withMcpEntry removes an entry when given undefined", () => {
    const updated = jsonConfigFormat.withMcpEntry('{"mcpServers":{"foo":{"command":"x"}}}', ["mcpServers"], "foo", undefined);
    const parsed = JSON.parse(updated);
    expect(parsed.mcpServers?.foo).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/infrastructure/config-io/json-format.test.ts`
Expected: FAIL (`./json-format` doesn't exist).

- [ ] **Step 4: Implement `config-format.ts`**

```ts
// src/infrastructure/config-io/config-format.ts
export interface ConfigFormatIO {
  readOrDefault(path: string): Promise<{ raw: string; exists: boolean }>;
  getMcpEntry(raw: string, entryPath: string[], name: string): unknown;
  withMcpEntry(raw: string, entryPath: string[], name: string, value: unknown): string;
}
```

- [ ] **Step 5: Implement `json-format.ts`**

```ts
// src/infrastructure/config-io/json-format.ts
import { readFile } from "node:fs/promises";
import { applyEdits, modify, parse } from "jsonc-parser";
import type { ConfigFormatIO } from "./config-format";

async function readOrDefault(path: string): Promise<{ raw: string; exists: boolean }> {
  try {
    return { raw: await readFile(path, "utf8"), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "{}", exists: false };
    throw error;
  }
}

function getMcpEntry(raw: string, entryPath: string[], name: string): unknown {
  const document = parse(raw) as Record<string, unknown>;
  const fullPath = [...entryPath, name];
  return fullPath.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
    document,
  );
}

function withMcpEntry(raw: string, entryPath: string[], name: string, value: unknown): string {
  const edits = modify(raw, [...entryPath, name], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  return applyEdits(raw, edits);
}

export const jsonConfigFormat: ConfigFormatIO = { readOrDefault, getMcpEntry, withMcpEntry };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/infrastructure/config-io/json-format.test.ts`
Expected: 5 pass.

- [ ] **Step 7: Implement `formats.ts`**

```ts
// src/infrastructure/config-io/formats.ts
import type { ConfigFormat } from "../../modules/agents/types";
import type { ConfigFormatIO } from "./config-format";
import { jsonConfigFormat } from "./json-format";

export const configFormats: Record<ConfigFormat, ConfigFormatIO> = {
  json: jsonConfigFormat,
};
```

- [ ] **Step 8: Run full test suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock src/infrastructure/config-io
git commit -m "feat: add JSON/JSONC config read-modify-write helpers"
```

---

### Task 7: Plan types, pure diff decision, and plan persistence

**Files:**
- Create: `src/modules/config-writer/types.ts`
- Create: `src/modules/config-writer/decide.ts`
- Create: `src/modules/config-writer/decide.test.ts`
- Create: `src/infrastructure/plan-store.ts`
- Create: `src/infrastructure/plan-store.test.ts`

**Interfaces:**
- Produces: `Plan`, `PlanWrite`, `ConfigConflictError` (types.ts); `decideMcpWrite`, `DiffDecision` (decide.ts); `newPlanId`, `savePlan`, `loadPlan`, `plansDirectory` (plan-store.ts).

- [ ] **Step 1: Write the failing test for the pure decision logic**

```ts
// src/modules/config-writer/decide.test.ts
import { describe, expect, test } from "bun:test";
import { decideMcpWrite } from "./decide";

describe("decideMcpWrite", () => {
  test("write when nothing exists yet", () => {
    expect(decideMcpWrite(undefined, { command: "x" })).toEqual({ kind: "write" });
  });

  test("noop when the existing entry already matches", () => {
    expect(decideMcpWrite({ command: "x" }, { command: "x" })).toEqual({ kind: "noop" });
  });

  test("conflict when an existing entry differs", () => {
    expect(decideMcpWrite({ command: "y" }, { command: "x" })).toEqual({ kind: "conflict" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/config-writer/decide.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `types.ts`**

```ts
// src/modules/config-writer/types.ts
export interface PlanWrite {
  path: string;
  beforeHash: string;
  afterContent: string;
}

export interface Plan {
  planId: string;
  agentId: string;
  action: "mcp-install" | "mcp-remove";
  noop: boolean;
  writes: PlanWrite[];
}

export class ConfigConflictError extends Error {
  constructor(path: string, key: string) {
    super(`Refusing to write "${key}" into ${path}: an existing entry with different content is already there`);
  }
}
```

- [ ] **Step 4: Implement `decide.ts`**

```ts
// src/modules/config-writer/decide.ts
export type DiffDecision = { kind: "noop" } | { kind: "conflict" } | { kind: "write" };

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function decideMcpWrite(existingEntry: unknown, desiredEntry: unknown): DiffDecision {
  if (existingEntry === undefined) return { kind: "write" };
  if (deepEqual(existingEntry, desiredEntry)) return { kind: "noop" };
  return { kind: "conflict" };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/modules/config-writer/decide.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Write the failing test for plan persistence**

```ts
// src/infrastructure/plan-store.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, newPlanId, savePlan } from "./plan-store";
import type { Plan } from "../modules/config-writer/types";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planstore-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("plan-store", () => {
  test("saves and loads a plan by id", async () => {
    const plan: Plan = { planId: newPlanId(), agentId: "claude-code", action: "mcp-install", noop: false, writes: [] };
    await savePlan(home, plan);
    const loaded = await loadPlan(home, plan.planId);
    expect(loaded).toEqual(plan);
  });

  test("newPlanId returns distinct ids", () => {
    expect(newPlanId()).not.toBe(newPlanId());
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test src/infrastructure/plan-store.test.ts`
Expected: FAIL.

- [ ] **Step 8: Implement `plan-store.ts`**

```ts
// src/infrastructure/plan-store.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plan } from "../modules/config-writer/types";

export function plansDirectory(home: string): string {
  return join(home, ".forge614", "engines", "plans");
}

export function newPlanId(): string {
  return randomUUID();
}

export async function savePlan(home: string, plan: Plan): Promise<void> {
  const dir = plansDirectory(home);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${plan.planId}.json`), JSON.stringify(plan, null, 2), "utf8");
}

export async function loadPlan(home: string, planId: string): Promise<Plan> {
  const raw = await readFile(join(plansDirectory(home), `${planId}.json`), "utf8");
  return JSON.parse(raw) as Plan;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test src/infrastructure/plan-store.test.ts`
Expected: 2 pass.

- [ ] **Step 10: Commit**

```bash
git add src/modules/config-writer src/infrastructure/plan-store.ts src/infrastructure/plan-store.test.ts
git commit -m "feat: add plan types, pure diff decision, and plan persistence"
```

---

### Task 8: `plan mcp-install` (app + CLI)

**Files:**
- Create: `src/app/plan-mcp-install.ts`
- Create: `src/app/plan-mcp-install.test.ts`
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/interfaces/cli/main.ts`

**Interfaces:**
- Consumes: `configFormats` (Task 6), `decideMcpWrite`, `Plan`, `ConfigConflictError` (Task 7), `savePlan`/`newPlanId` (Task 7), `AgentRegistry` (Task 2).
- Produces: `planMcpInstall(registry, input)`, CLI `plan mcp-install`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/plan-mcp-install.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { ConfigConflictError } from "../modules/config-writer/types";
import { planMcpInstall } from "./plan-mcp-install";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planinstall-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMcpInstall", () => {
  test("adds a new MCP entry, preserving unrelated existing content", async () => {
    writeFileSync(join(home, ".claude.json"), '{"other":true}');

    const plan = await planMcpInstall(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(false);
    expect(plan.writes).toHaveLength(1);
    const parsed = JSON.parse(plan.writes[0].afterContent);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers["forge614-engram"]).toEqual({ command: "/bin/engram", args: ["mcp"] });
  });

  test("is a noop when the exact same entry is already installed", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/bin/engram", args: ["mcp"] } } }),
    );

    const plan = await planMcpInstall(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });

  test("throws ConfigConflictError when a different entry already uses that name", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/other/path" } } }),
    );

    await expect(
      planMcpInstall(registry, {
        agentId: "claude-code",
        home,
        server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
      }),
    ).rejects.toThrow(ConfigConflictError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/plan-mcp-install.test.ts`
Expected: FAIL (`./plan-mcp-install` doesn't exist).

- [ ] **Step 3: Implement `plan-mcp-install.ts`**

```ts
// src/app/plan-mcp-install.ts
import { createHash } from "node:crypto";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import { decideMcpWrite } from "../modules/config-writer/decide";
import { ConfigConflictError, type Plan } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { newPlanId, savePlan } from "../infrastructure/plan-store";

export interface PlanMcpInstallInput {
  agentId: AgentId;
  server: McpServerDefinition;
  home: string;
}

export async function planMcpInstall(registry: AgentRegistry, input: PlanMcpInstallInput): Promise<Plan> {
  const adapter = registry.get(input.agentId);
  if (!adapter) throw new Error(`Unknown agent: ${input.agentId}`);
  if (!adapter.capabilities.supportsMcp) throw new Error(`${input.agentId} does not support MCP servers`);

  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const desired = adapter.mcpEntryShape(input.server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, input.server.name);

  const decision = decideMcpWrite(existing, desired);
  if (decision.kind === "conflict") throw new ConfigConflictError(configPath, input.server.name);

  const planId = newPlanId();
  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-install",
    noop: decision.kind === "noop",
    writes:
      decision.kind === "noop"
        ? []
        : [
            {
              path: configPath,
              beforeHash: createHash("sha256")
                .update(exists ? raw : "")
                .digest("hex"),
              afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, input.server.name, desired),
            },
          ],
  };

  await savePlan(input.home, plan);
  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/app/plan-mcp-install.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Add the CLI command — modify `src/interfaces/cli/commands.ts`**

Add this import at the top and this function at the end of the file:

```ts
import { planMcpInstall } from "../../app/plan-mcp-install";
import type { AgentId } from "../../modules/agents/types";
```

```ts
export async function runPlanMcpInstall(agentId: AgentId, name: string, command: string, args: string[]): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMcpInstall(registry, { agentId, home: homedir(), server: { name, command, args } });
  printJson({ plan });
}
```

- [ ] **Step 6: Wire the CLI — modify `src/interfaces/cli/main.ts`**

Replace the `main()` body with:

```ts
function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (command === "detect") return runDetect();

  if (command === "plan" && subcommand === "mcp-install") {
    const agentId = flag(rest, "--agent") as AgentId;
    const name = flag(rest, "--name")!;
    const cmd = flag(rest, "--command")!;
    const argsIndex = rest.indexOf("--args");
    const args = argsIndex === -1 ? [] : rest.slice(argsIndex + 1);
    return runPlanMcpInstall(agentId, name, cmd, args);
  }

  console.error(`Unknown command: ${process.argv.slice(2).join(" ")}`);
  process.exitCode = 1;
}
```

Update the top import to: `import { runDetect, runPlanMcpInstall } from "./commands";` and add `import type { AgentId } from "../../modules/agents/types";`.

- [ ] **Step 7: Run full test suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/plan-mcp-install.ts src/app/plan-mcp-install.test.ts src/interfaces/cli
git commit -m "feat: add plan mcp-install command"
```

---

### Task 9: Atomic write

**Files:**
- Create: `src/infrastructure/config-io/atomic-write.ts`
- Create: `src/infrastructure/config-io/atomic-write.test.ts`

**Interfaces:**
- Produces: `atomicWrite(targetPath, content)`, `AtomicWriteResult`.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/config-io/atomic-write.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "./atomic-write";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-atomicwrite-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  test("creates a new file and reports changed:true", async () => {
    const target = join(dir, "config.json");
    const result = await atomicWrite(target, '{"a":1}');
    expect(result.changed).toBe(true);
    expect(readFileSync(target, "utf8")).toBe('{"a":1}');
  });

  test("reports changed:false and leaves the file untouched when content is identical", async () => {
    const target = join(dir, "config.json");
    writeFileSync(target, '{"a":1}');
    const result = await atomicWrite(target, '{"a":1}');
    expect(result.changed).toBe(false);
    expect(readFileSync(target, "utf8")).toBe('{"a":1}');
  });

  test("overwrites existing content", async () => {
    const target = join(dir, "config.json");
    writeFileSync(target, '{"a":1}');
    const result = await atomicWrite(target, '{"a":2}');
    expect(result.changed).toBe(true);
    expect(readFileSync(target, "utf8")).toBe('{"a":2}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/infrastructure/config-io/atomic-write.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `atomic-write.ts`**

```ts
// src/infrastructure/config-io/atomic-write.ts
import { createHash } from "node:crypto";
import { open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AtomicWriteResult {
  changed: boolean;
}

export async function atomicWrite(targetPath: string, content: string): Promise<AtomicWriteResult> {
  let existing: string | undefined;
  try {
    existing = await readFile(targetPath, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing === content) return { changed: false };

  const tempPath = join(dirname(targetPath), `.${Math.random().toString(36).slice(2)}.tmp`);
  const handle = await open(tempPath, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  await rename(tempPath, targetPath);

  const verifyContent = await readFile(targetPath, "utf8");
  const expectedHash = createHash("sha256").update(content).digest("hex");
  const actualHash = createHash("sha256").update(verifyContent).digest("hex");
  if (expectedHash !== actualHash) {
    throw new Error(`Atomic write verification failed for ${targetPath}`);
  }

  if (process.platform !== "win32") {
    const dirHandle = await open(dirname(targetPath), "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  }

  return { changed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/infrastructure/config-io/atomic-write.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/config-io/atomic-write.ts src/infrastructure/config-io/atomic-write.test.ts
git commit -m "feat: add atomic, checksum-verified config file writes"
```

---

### Task 10: Snapshot / backup

**Files:**
- Create: `src/infrastructure/snapshot/snapshot.ts`
- Create: `src/infrastructure/snapshot/snapshot.test.ts`

**Interfaces:**
- Produces: `createSnapshot(home, planId, filePaths)`, `restoreSnapshot(home, planId)`, `snapshotDirectory(home, planId)`, `SnapshotManifest`.

**Note:** the spec (§5) describes a compressed archive; this task implements a plain file copy + checksum manifest instead. It gives the same restorability guarantee with far less code and no new dependency — revisit compression only if snapshot disk usage becomes a real problem.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/snapshot/snapshot.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot, restoreSnapshot } from "./snapshot";

let home: string;
let configPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-snapshot-"));
  configPath = join(home, "config.json");
  writeFileSync(configPath, '{"original":true}');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("snapshot", () => {
  test("creates a manifest recording the backed-up file and its checksum", async () => {
    const manifest = await createSnapshot(home, "plan-1", [configPath]);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].originalPath).toBe(configPath);
  });

  test("restoreSnapshot puts the original content back after the file changes", async () => {
    await createSnapshot(home, "plan-1", [configPath]);
    writeFileSync(configPath, '{"modified":true}');

    await restoreSnapshot(home, "plan-1");

    expect(readFileSync(configPath, "utf8")).toBe('{"original":true}');
  });

  test("skips files that did not exist before the plan", async () => {
    const missingPath = join(home, "missing.json");
    const manifest = await createSnapshot(home, "plan-2", [missingPath]);
    expect(manifest.files).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/infrastructure/snapshot/snapshot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `snapshot.ts`**

```ts
// src/infrastructure/snapshot/snapshot.ts
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface SnapshotManifestEntry {
  originalPath: string;
  backupFileName: string;
  sha256: string;
}

export interface SnapshotManifest {
  planId: string;
  createdAt: string;
  files: SnapshotManifestEntry[];
}

export function snapshotDirectory(home: string, planId: string): string {
  return join(home, ".forge614", "engines", "snapshots", planId);
}

export async function createSnapshot(home: string, planId: string, filePaths: string[]): Promise<SnapshotManifest> {
  const dir = snapshotDirectory(home, planId);
  await mkdir(dir, { recursive: true });

  const files: SnapshotManifestEntry[] = [];
  for (const filePath of filePaths) {
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const backupFileName = `${basename(filePath)}.bak`;
    await copyFile(filePath, join(dir, backupFileName));
    files.push({
      originalPath: filePath,
      backupFileName,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  const manifest: SnapshotManifest = { planId, createdAt: new Date().toISOString(), files };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function restoreSnapshot(home: string, planId: string): Promise<void> {
  const dir = snapshotDirectory(home, planId);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
  for (const file of manifest.files) {
    await copyFile(join(dir, file.backupFileName), file.originalPath);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/infrastructure/snapshot/snapshot.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/snapshot
git commit -m "feat: add restorable config snapshots before apply"
```

---

### Task 11: `apply` (app + CLI)

**Files:**
- Create: `src/app/apply-plan.ts`
- Create: `src/app/apply-plan.test.ts`
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/interfaces/cli/main.ts`

**Interfaces:**
- Consumes: `loadPlan` (Task 7), `createSnapshot` (Task 10), `atomicWrite` (Task 9).
- Produces: `applyPlan(home, planId)`, `ApplyResult`, `StalePlanError`, CLI `apply`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/apply-plan.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { savePlan } from "../infrastructure/plan-store";
import type { Plan } from "../modules/config-writer/types";
import { applyPlan, StalePlanError } from "./apply-plan";

let home: string;
let configPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-apply-"));
  configPath = join(home, "config.json");
  writeFileSync(configPath, '{"other":true}');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("applyPlan", () => {
  test("writes the planned content and reports the changed file", async () => {
    const plan: Plan = {
      planId: "plan-1",
      agentId: "claude-code",
      action: "mcp-install",
      noop: false,
      writes: [{ path: configPath, beforeHash: hashOf('{"other":true}'), afterContent: '{"other":true,"new":true}' }],
    };
    await savePlan(home, plan);

    const result = await applyPlan(home, "plan-1");

    expect(result.changedFiles).toEqual([configPath]);
    expect(readFileSync(configPath, "utf8")).toBe('{"other":true,"new":true}');
  });

  test("does nothing for a noop plan", async () => {
    const plan: Plan = { planId: "plan-2", agentId: "claude-code", action: "mcp-install", noop: true, writes: [] };
    await savePlan(home, plan);

    const result = await applyPlan(home, "plan-2");

    expect(result.changedFiles).toEqual([]);
  });

  test("refuses to apply when the file changed since the plan was computed", async () => {
    const plan: Plan = {
      planId: "plan-3",
      agentId: "claude-code",
      action: "mcp-install",
      noop: false,
      writes: [{ path: configPath, beforeHash: hashOf('{"stale":true}'), afterContent: '{"new":true}' }],
    };
    await savePlan(home, plan);

    await expect(applyPlan(home, "plan-3")).rejects.toThrow(StalePlanError);
    expect(readFileSync(configPath, "utf8")).toBe('{"other":true}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/apply-plan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `apply-plan.ts`**

```ts
// src/app/apply-plan.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "../infrastructure/config-io/atomic-write";
import { createSnapshot } from "../infrastructure/snapshot/snapshot";
import { loadPlan } from "../infrastructure/plan-store";

export class StalePlanError extends Error {
  constructor(path: string) {
    super(`File changed since the plan was computed: ${path}`);
  }
}

export interface ApplyResult {
  planId: string;
  applied: boolean;
  changedFiles: string[];
}

export async function applyPlan(home: string, planId: string): Promise<ApplyResult> {
  const plan = await loadPlan(home, planId);

  if (plan.noop || plan.writes.length === 0) {
    return { planId, applied: true, changedFiles: [] };
  }

  for (const write of plan.writes) {
    let current: string;
    try {
      current = await readFile(write.path, "utf8");
    } catch {
      current = "";
    }
    const currentHash = createHash("sha256").update(current).digest("hex");
    if (currentHash !== write.beforeHash) throw new StalePlanError(write.path);
  }

  await createSnapshot(
    home,
    planId,
    plan.writes.map((w) => w.path),
  );

  const changedFiles: string[] = [];
  for (const write of plan.writes) {
    const result = await atomicWrite(write.path, write.afterContent);
    if (result.changed) changedFiles.push(write.path);
  }

  return { planId, applied: true, changedFiles };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/app/apply-plan.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Add the CLI command — modify `src/interfaces/cli/commands.ts`**

Add:

```ts
import { applyPlan } from "../../app/apply-plan";
```

```ts
export async function runApply(planId: string): Promise<void> {
  const result = await applyPlan(homedir(), planId);
  printJson({ result });
}
```

- [ ] **Step 6: Wire the CLI — modify `src/interfaces/cli/main.ts`**

Add this branch inside `main()`, before the "Unknown command" fallback:

```ts
  if (command === "apply") {
    return runApply(flag(rest, "--plan-id")!);
  }
```

Update the import line to: `import { runApply, runDetect, runPlanMcpInstall } from "./commands";`

- [ ] **Step 7: Run full test suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/apply-plan.ts src/app/apply-plan.test.ts src/interfaces/cli
git commit -m "feat: add apply command with preflight staleness check and snapshot"
```

---

### Task 12: `plan mcp-remove` (app + CLI)

**Files:**
- Create: `src/app/plan-mcp-remove.ts`
- Create: `src/app/plan-mcp-remove.test.ts`
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/interfaces/cli/main.ts`

**Interfaces:**
- Consumes: `configFormats` (Task 6), `savePlan`/`newPlanId` (Task 7), `AgentRegistry` (Task 2).
- Produces: `planMcpRemove(registry, input)`, `UnrecognizedEntryError`, CLI `plan mcp-remove`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/plan-mcp-remove.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { planMcpRemove, UnrecognizedEntryError } from "./plan-mcp-remove";

let home: string;
let registry: AgentRegistry;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-planremove-"));
  registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("planMcpRemove", () => {
  test("removes exactly the entry it recognizes as its own", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ other: true, mcpServers: { "forge614-engram": { command: "/bin/engram", args: ["mcp"] } } }),
    );

    const plan = await planMcpRemove(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(false);
    const parsed = JSON.parse(plan.writes[0].afterContent);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers?.["forge614-engram"]).toBeUndefined();
  });

  test("is a noop when the entry is already absent", async () => {
    writeFileSync(join(home, ".claude.json"), "{}");

    const plan = await planMcpRemove(registry, {
      agentId: "claude-code",
      home,
      server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
    });

    expect(plan.noop).toBe(true);
  });

  test("refuses to remove an entry that does not match what it would have installed", async () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "forge614-engram": { command: "/some/other/path" } } }),
    );

    await expect(
      planMcpRemove(registry, {
        agentId: "claude-code",
        home,
        server: { name: "forge614-engram", command: "/bin/engram", args: ["mcp"] },
      }),
    ).rejects.toThrow(UnrecognizedEntryError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/plan-mcp-remove.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `plan-mcp-remove.ts`**

```ts
// src/app/plan-mcp-remove.ts
import { createHash } from "node:crypto";
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId, McpServerDefinition } from "../modules/agents/types";
import type { Plan } from "../modules/config-writer/types";
import { configFormats } from "../infrastructure/config-io/formats";
import { newPlanId, savePlan } from "../infrastructure/plan-store";

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

  const format = configFormats[adapter.configFormat];
  const configPath = adapter.configFile(input.home);
  const { raw, exists } = await format.readOrDefault(configPath);
  const expected = adapter.mcpEntryShape(input.server);
  const existing = format.getMcpEntry(raw, adapter.mcpEntryPath, input.server.name);

  const planId = newPlanId();

  if (existing === undefined) {
    const plan: Plan = { planId, agentId: input.agentId, action: "mcp-remove", noop: true, writes: [] };
    await savePlan(input.home, plan);
    return plan;
  }

  if (JSON.stringify(existing) !== JSON.stringify(expected)) {
    throw new UnrecognizedEntryError(input.server.name);
  }

  const plan: Plan = {
    planId,
    agentId: input.agentId,
    action: "mcp-remove",
    noop: false,
    writes: [
      {
        path: configPath,
        beforeHash: createHash("sha256")
          .update(exists ? raw : "")
          .digest("hex"),
        afterContent: format.withMcpEntry(raw, adapter.mcpEntryPath, input.server.name, undefined),
      },
    ],
  };
  await savePlan(input.home, plan);
  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/app/plan-mcp-remove.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Add the CLI command — modify `src/interfaces/cli/commands.ts`**

Add:

```ts
import { planMcpRemove } from "../../app/plan-mcp-remove";
```

```ts
export async function runPlanMcpRemove(agentId: AgentId, name: string, command: string, args: string[]): Promise<void> {
  const registry = buildDefaultRegistry();
  const plan = await planMcpRemove(registry, { agentId, home: homedir(), server: { name, command, args } });
  printJson({ plan });
}
```

- [ ] **Step 6: Wire the CLI — modify `src/interfaces/cli/main.ts`**

Add this branch, alongside the `plan mcp-install` branch:

```ts
  if (command === "plan" && subcommand === "mcp-remove") {
    const agentId = flag(rest, "--agent") as AgentId;
    const name = flag(rest, "--name")!;
    const cmd = flag(rest, "--command")!;
    const argsIndex = rest.indexOf("--args");
    const args = argsIndex === -1 ? [] : rest.slice(argsIndex + 1);
    return runPlanMcpRemove(agentId, name, cmd, args);
  }
```

Update the import line to: `import { runApply, runDetect, runPlanMcpInstall, runPlanMcpRemove } from "./commands";`

- [ ] **Step 7: Run full test suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/plan-mcp-remove.ts src/app/plan-mcp-remove.test.ts src/interfaces/cli
git commit -m "feat: add plan mcp-remove command"
```

---

### Task 13: `capabilities` command (app + CLI)

**Files:**
- Create: `src/app/capabilities.ts`
- Create: `src/app/capabilities.test.ts`
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/interfaces/cli/main.ts`

**Interfaces:**
- Consumes: `AgentRegistry` (Task 2).
- Produces: `capabilitiesFor(registry, agentId)`, `CapabilitiesReport`, CLI `capabilities`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/capabilities.test.ts
import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modules/agents/registry";
import { claudeCodeAdapter } from "../infrastructure/agents/claude-code";
import { capabilitiesFor } from "./capabilities";

describe("capabilitiesFor", () => {
  test("reports the adapter's declared capabilities", () => {
    const registry = new AgentRegistry();
    registry.register(claudeCodeAdapter);

    expect(capabilitiesFor(registry, "claude-code")).toEqual({
      id: "claude-code",
      label: "Claude Code",
      supportsMcp: true,
      supportsHooks: true,
      supportsHeadlessExec: true,
    });
  });

  test("throws for an unregistered agent", () => {
    const registry = new AgentRegistry();
    expect(() => capabilitiesFor(registry, "codex")).toThrow("Unknown agent: codex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/capabilities.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `capabilities.ts`**

```ts
// src/app/capabilities.ts
import type { AgentRegistry } from "../modules/agents/registry";
import type { AgentId } from "../modules/agents/types";

export interface CapabilitiesReport {
  id: AgentId;
  label: string;
  supportsMcp: boolean;
  supportsHooks: boolean;
  supportsHeadlessExec: boolean;
}

export function capabilitiesFor(registry: AgentRegistry, agentId: AgentId): CapabilitiesReport {
  const adapter = registry.get(agentId);
  if (!adapter) throw new Error(`Unknown agent: ${agentId}`);
  return {
    id: adapter.id,
    label: adapter.label,
    supportsMcp: adapter.capabilities.supportsMcp,
    supportsHooks: adapter.capabilities.supportsHooks,
    supportsHeadlessExec: adapter.capabilities.supportsHeadlessExec,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/app/capabilities.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Add the CLI command — modify `src/interfaces/cli/commands.ts`**

Add:

```ts
import { capabilitiesFor } from "../../app/capabilities";
```

```ts
export async function runCapabilities(agentId: AgentId): Promise<void> {
  const registry = buildDefaultRegistry();
  printJson({ ...capabilitiesFor(registry, agentId) });
}
```

- [ ] **Step 6: Wire the CLI — modify `src/interfaces/cli/main.ts`**

Add this branch:

```ts
  if (command === "capabilities") {
    return runCapabilities(flag(rest, "--agent") as AgentId);
  }
```

Update the import line to: `import { runApply, runCapabilities, runDetect, runPlanMcpInstall, runPlanMcpRemove } from "./commands";`

- [ ] **Step 7: Run full test suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/capabilities.ts src/app/capabilities.test.ts src/interfaces/cli
git commit -m "feat: add capabilities command"
```

---

### Task 14: Architecture layering test

**Files:**
- Create: `tests/architecture/import-rules.ts`
- Create: `tests/architecture/import-rules.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces: `findLayerViolations()`, `LayerViolation` — enforces the Global Constraints layering rule for every file this plan has created.

- [ ] **Step 1: Add the `typescript` compiler as an importable dependency (already a devDependency) and confirm `tests/` is included**

`tsconfig.json`'s `include` already lists `"tests"` from Task 1 — no change needed there. Just add `"typescript"` is already present as a devDependency.

- [ ] **Step 2: Write the failing test**

```ts
// tests/architecture/import-rules.test.ts
import { describe, expect, test } from "bun:test";
import { findLayerViolations } from "./import-rules";

describe("architecture layering", () => {
  test("modules/infrastructure/app never import from a higher layer", () => {
    expect(findLayerViolations()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/architecture/import-rules.test.ts`
Expected: FAIL (`./import-rules` doesn't exist).

- [ ] **Step 4: Implement `import-rules.ts`**

```ts
// tests/architecture/import-rules.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const SRC_ROOT = join(import.meta.dir, "..", "..", "src");
const LAYER_ORDER = ["modules", "infrastructure", "app", "interfaces"] as const;
type Layer = (typeof LAYER_ORDER)[number];

function layerOf(filePath: string): Layer | undefined {
  const rel = relative(SRC_ROOT, filePath);
  const [top] = rel.split("/");
  return (LAYER_ORDER as readonly string[]).includes(top) ? (top as Layer) : undefined;
}

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

export interface LayerViolation {
  file: string;
  importedPath: string;
  fromLayer: Layer;
  toLayer: Layer;
}

export function findLayerViolations(): LayerViolation[] {
  const violations: LayerViolation[] = [];

  for (const file of listTsFiles(SRC_ROOT)) {
    const fromLayer = layerOf(file);
    if (!fromLayer) continue;

    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    ts.forEachChild(source, (node) => {
      if (!ts.isImportDeclaration(node)) return;
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) return;

      const resolvedBase = join(dirname(file), specifier.text);
      const resolved = resolvedBase.endsWith(".ts") ? resolvedBase : `${resolvedBase}.ts`;
      const toLayer = layerOf(resolved);
      if (!toLayer) return;

      const fromIndex = LAYER_ORDER.indexOf(fromLayer);
      const toIndex = LAYER_ORDER.indexOf(toLayer);
      if (toIndex > fromIndex) {
        violations.push({ file, importedPath: specifier.text, fromLayer, toLayer });
      }
    });
  }

  return violations;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/architecture/import-rules.test.ts`
Expected: 1 pass (this confirms every task so far already respects the layering rule).

- [ ] **Step 6: Run full test suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add tests/architecture
git commit -m "test: enforce module/infrastructure/app/interfaces layering"
```

---

### Task 15: Codex adapter (proves the format abstraction with TOML)

**Files:**
- Create: `src/infrastructure/config-io/toml-format.ts`
- Create: `src/infrastructure/config-io/toml-format.test.ts`
- Create: `src/infrastructure/agents/codex.ts`
- Create: `src/infrastructure/agents/codex.test.ts`
- Modify: `src/modules/agents/types.ts`
- Modify: `src/infrastructure/config-io/formats.ts`
- Modify: `src/app/default-registry.ts`

**Interfaces:**
- Consumes: `ConfigFormatIO` (Task 6).
- Produces: `tomlConfigFormat`, `codexAdapter`. No changes to `detect`/`plan`/`apply` command implementations — only the registry gains one new line.

**Note:** this TOML writer re-serializes the whole document on every write. It does not preserve comments or key ordering the way a textual patch would (`forge614-engram` solves this with custom line-level editing for Codex's `config.toml`). That refinement is out of scope for this plan; flag it if Codex users report losing comments in their `config.toml`.

- [ ] **Step 1: Add the `smol-toml` dependency**

Run: `bun add smol-toml`

- [ ] **Step 2: Widen `ConfigFormat` — modify `src/modules/agents/types.ts`**

Change:

```ts
export type ConfigFormat = "json";
```

to:

```ts
export type ConfigFormat = "json" | "toml";
```

- [ ] **Step 3: Write the failing test for the TOML format**

```ts
// src/infrastructure/config-io/toml-format.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tomlConfigFormat } from "./toml-format";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engines-tomlfmt-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tomlConfigFormat", () => {
  test("readOrDefault returns exists:false and '' when the file is missing", async () => {
    const result = await tomlConfigFormat.readOrDefault(join(dir, "missing.toml"));
    expect(result).toEqual({ raw: "", exists: false });
  });

  test("withMcpEntry adds a table entry, preserving unrelated top-level keys", async () => {
    const updated = tomlConfigFormat.withMcpEntry('model = "gpt-5"', ["mcp_servers"], "forge614-engram", {
      command: "/bin/engram",
      args: ["mcp"],
    });
    const entry = tomlConfigFormat.getMcpEntry(updated, ["mcp_servers"], "forge614-engram");
    expect(entry).toEqual({ command: "/bin/engram", args: ["mcp"] });
    expect(updated).toContain('model = "gpt-5"');
  });

  test("withMcpEntry with undefined removes the entry", async () => {
    const withEntry = tomlConfigFormat.withMcpEntry("", ["mcp_servers"], "forge614-engram", { command: "/bin/engram" });
    const removed = tomlConfigFormat.withMcpEntry(withEntry, ["mcp_servers"], "forge614-engram", undefined);
    expect(tomlConfigFormat.getMcpEntry(removed, ["mcp_servers"], "forge614-engram")).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/infrastructure/config-io/toml-format.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `toml-format.ts`**

```ts
// src/infrastructure/config-io/toml-format.ts
import { readFile } from "node:fs/promises";
import { parse, stringify } from "smol-toml";
import type { ConfigFormatIO } from "./config-format";

async function readOrDefault(path: string): Promise<{ raw: string; exists: boolean }> {
  try {
    return { raw: await readFile(path, "utf8"), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "", exists: false };
    throw error;
  }
}

function parseDocument(raw: string): Record<string, unknown> {
  return raw.trim() === "" ? {} : (parse(raw) as Record<string, unknown>);
}

function getMcpEntry(raw: string, entryPath: string[], name: string): unknown {
  const document = parseDocument(raw);
  const fullPath = [...entryPath, name];
  return fullPath.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
    document,
  );
}

function withMcpEntry(raw: string, entryPath: string[], name: string, value: unknown): string {
  const document = parseDocument(raw);
  let cursor: Record<string, unknown> = document;
  for (const key of entryPath) {
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  if (value === undefined) delete cursor[name];
  else cursor[name] = value;
  return stringify(document);
}

export const tomlConfigFormat: ConfigFormatIO = { readOrDefault, getMcpEntry, withMcpEntry };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/infrastructure/config-io/toml-format.test.ts`
Expected: 3 pass.

- [ ] **Step 7: Register it — modify `src/infrastructure/config-io/formats.ts`**

```ts
import { tomlConfigFormat } from "./toml-format";

export const configFormats: Record<ConfigFormat, ConfigFormatIO> = {
  json: jsonConfigFormat,
  toml: tomlConfigFormat,
};
```

- [ ] **Step 8: Write the failing test for the Codex adapter**

```ts
// src/infrastructure/agents/codex.test.ts
import { describe, expect, test } from "bun:test";
import { codexAdapter } from "./codex";

describe("codexAdapter", () => {
  test("has the expected identity and capabilities", () => {
    expect(codexAdapter.id).toBe("codex");
    expect(codexAdapter.configFormat).toBe("toml");
    expect(codexAdapter.capabilities.supportsHeadlessExec).toBe(true);
  });

  test("points at ~/.codex/config.toml", () => {
    expect(codexAdapter.configFile("/home/u")).toBe("/home/u/.codex/config.toml");
  });

  test("builds a headless invocation with exec", () => {
    expect(codexAdapter.headlessCommand?.("/bin/codex", { prompt: "hello" })).toEqual({
      command: "/bin/codex",
      args: ["exec", "hello"],
    });
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `bun test src/infrastructure/agents/codex.test.ts`
Expected: FAIL.

- [ ] **Step 10: Implement `codex.ts`**

```ts
// src/infrastructure/agents/codex.ts
import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex",
  capabilities: { supportsMcp: true, supportsHooks: true, supportsHeadlessExec: true },
  configFormat: "toml",
  mcpEntryPath: ["mcp_servers"],
  candidateExecutableNames(platform) {
    return platform === "win32" ? ["codex.exe"] : ["codex"];
  },
  knownInstallPaths() {
    return [];
  },
  configDir(home) {
    return join(home, ".codex");
  },
  configFile(home) {
    return join(home, ".codex", "config.toml");
  },
  mcpEntryShape(server: McpServerDefinition) {
    return { command: server.command, args: server.args };
  },
  headlessCommand(executable, opts) {
    return { command: executable, args: ["exec", opts.prompt] };
  },
};
```

- [ ] **Step 11: Run test to verify it passes**

Run: `bun test src/infrastructure/agents/codex.test.ts`
Expected: 3 pass.

- [ ] **Step 12: Register the adapter — modify `src/app/default-registry.ts`**

```ts
import { codexAdapter } from "../infrastructure/agents/codex";
```

```ts
export function buildDefaultRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  return registry;
}
```

- [ ] **Step 13: Run the full suite, confirming detect/plan/apply now cover Codex with zero changes to their own files**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 14: Commit**

```bash
git add package.json bun.lock src/infrastructure/config-io src/infrastructure/agents/codex.ts src/infrastructure/agents/codex.test.ts src/modules/agents/types.ts src/app/default-registry.ts
git commit -m "feat: add Codex agent adapter and TOML config format"
```

---

### Task 16: Cursor adapter (desktop app, no PATH binary)

**Files:**
- Create: `src/infrastructure/agents/cursor.ts`
- Create: `src/infrastructure/agents/cursor.test.ts`
- Modify: `src/app/default-registry.ts`

**Interfaces:**
- Produces: `cursorAdapter`. Again, no changes to `detect`/`plan`/`apply` implementations.

- [ ] **Step 1: Write the failing test**

```ts
// src/infrastructure/agents/cursor.test.ts
import { describe, expect, test } from "bun:test";
import { cursorAdapter } from "./cursor";

describe("cursorAdapter", () => {
  test("has no headless support and a dedicated mcp.json", () => {
    expect(cursorAdapter.capabilities.supportsHeadlessExec).toBe(false);
    expect(cursorAdapter.headlessCommand).toBeUndefined();
    expect(cursorAdapter.configFile("/home/u")).toBe("/home/u/.cursor/mcp.json");
  });

  test("has no PATH-scannable binary, only known install paths on darwin", () => {
    expect(cursorAdapter.candidateExecutableNames("darwin")).toEqual([]);
    expect(cursorAdapter.knownInstallPaths("darwin", "/home/u")).toContain(
      "/Applications/Cursor.app/Contents/MacOS/Cursor",
    );
    expect(cursorAdapter.knownInstallPaths("linux", "/home/u")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/infrastructure/agents/cursor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `cursor.ts`**

```ts
// src/infrastructure/agents/cursor.ts
import { join } from "node:path";
import type { AgentAdapter, McpServerDefinition } from "../../modules/agents/types";

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  label: "Cursor",
  capabilities: { supportsMcp: true, supportsHooks: false, supportsHeadlessExec: false },
  configFormat: "json",
  mcpEntryPath: ["mcpServers"],
  candidateExecutableNames() {
    return [];
  },
  knownInstallPaths(platform) {
    if (platform !== "darwin") return [];
    return ["/Applications/Cursor.app/Contents/MacOS/Cursor"];
  },
  configDir(home) {
    return join(home, ".cursor");
  },
  configFile(home) {
    return join(home, ".cursor", "mcp.json");
  },
  mcpEntryShape(server: McpServerDefinition) {
    return { command: server.command, args: server.args };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/infrastructure/agents/cursor.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Register the adapter — modify `src/app/default-registry.ts`**

```ts
import { cursorAdapter } from "../infrastructure/agents/cursor";
```

```ts
export function buildDefaultRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(cursorAdapter);
  return registry;
}
```

- [ ] **Step 6: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/agents/cursor.ts src/infrastructure/agents/cursor.test.ts src/app/default-registry.ts
git commit -m "feat: add Cursor agent adapter"
```

---

### Task 17: Standalone binary build

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `bun run build` → `dist/forge614-engines`, a real standalone executable.

**Note:** wiring this into GitHub Releases + `install.sh`/checksum verification (matching `forge614-shell`/`forge614-engram`'s distribution) is a separate follow-up plan — this task only proves the binary itself works.

- [ ] **Step 1: Add the build script — modify `package.json`**

```json
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "build": "bun build ./src/interfaces/cli/main.ts --compile --outfile dist/forge614-engines"
  },
```

- [ ] **Step 2: Build it**

Run: `bun run build`
Expected: `dist/forge614-engines` is created.

- [ ] **Step 3: Verify the compiled binary actually works**

Run: `./dist/forge614-engines detect`
Expected: JSON output with `schemaVersion: 1` and an `agents` array, identical in shape to `bun src/interfaces/cli/main.ts detect`.

- [ ] **Step 4: Ensure the build output stays untracked — confirm `.gitignore` already has `dist/`**

(Already added in Task 1 — no change needed if so; otherwise append `dist/` to `.gitignore`.)

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "build: add standalone binary compile script"
```

---

### Task 18: Handoff documentation

**Files:**
- Create: `docs/superpowers/handoffs/2026-09-19-forge614-engines-mvp.md`
- Modify: `README.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Run the full suite one last time and capture the results**

Run: `bun test && bun run typecheck`
Expected: all pass — copy the actual pass count into the handoff doc.

- [ ] **Step 2: Write the handoff doc**

```markdown
# Handoff: forge614-engines MVP

**Date:** 2026-09-19
**Plan:** docs/superpowers/plans/2026-09-19-forge614-engines-mvp.md
**Spec:** docs/superpowers/specs/2026-09-19-forge614-engines-design.md

## What was built

A working `forge614-engines` CLI covering Claude Code, Codex and Cursor:

- `detect` — reports installed/configFound per agent via live PATH + known-path + config-dir checks.
- `capabilities --agent <id>` — reports supportsMcp/supportsHooks/supportsHeadlessExec per agent.
- `plan mcp-install` / `plan mcp-remove` — read-only, conflict-detecting, persisted to `~/.forge614/engines/plans/<planId>.json`.
- `apply --plan-id <id>` — preflights staleness, snapshots affected files to `~/.forge614/engines/snapshots/<planId>/`, then writes atomically with checksum verification.
- `bun run build` produces a standalone binary at `dist/forge614-engines`.

## Spec success criteria — verified

- [ ] detect correctly reports installed/not-installed agents (manually verified with Claude Code installed).
- [ ] installing into a config with unrelated existing content leaves that content untouched (Task 8 test).
- [ ] installing the same entry twice produces a noop (Task 8 test).
- [ ] apply refuses a stale plan instead of overwriting (Task 11 test).
- [ ] adding an agent (Codex, Task 15; Cursor, Task 16) required only a new adapter file + one registry line, no changes to detect/plan/apply.

## Known scope reductions vs. the spec

- Snapshots are plain file copies + a checksum manifest, not a compressed archive (Task 10 note).
- TOML writes re-serialize the whole document; comments/ordering are not preserved (Task 15 note).
- No GitHub Releases / install.sh / checksum-verified distribution yet — only the compiled binary (Task 17 note). Needed before other Forge614 products can auto-bootstrap this one per the ecosystem contract §5/§8.

## Follow-up plans needed

1. Release automation + install script + auto-bootstrap from forge614-shell/forge614-engram.
2. Hook installation (`hookEntryShape`) — this plan only covers MCP servers, not native hooks, even though the spec's adapter interface anticipates them.
3. Migrate `forge614-engram`'s own MCP self-installation to call this CLI instead of its own writer (ecosystem contract §11, item 4).
```

- [ ] **Step 3: Replace README.md**

```markdown
# forge614-engines

Detects which AI coding agents (Claude Code, Codex, Cursor, …) are installed on the user's machine, and safely previews and applies MCP server configuration changes for them.

Internal dependency of the Forge614 ecosystem — see `FORGE614_ECOSYSTEM_CONTRACT.md`. Not meant to be installed directly by a person.

- Spec: `docs/superpowers/specs/2026-09-19-forge614-engines-design.md`
- Plan: `docs/superpowers/plans/2026-09-19-forge614-engines-mvp.md`
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/handoffs README.md
git commit -m "docs: add MVP handoff and update README"
```
