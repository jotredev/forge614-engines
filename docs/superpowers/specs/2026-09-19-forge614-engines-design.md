# forge614-engines — Design Spec

**Date:** 2026-09-19
**Status:** Approved by product owner (chat-based brainstorming), pending self-review + final read-through.
**Governs:** `/Users/jorgeetrejoo/Desktop/forge614-engines`
**Constrained by:** [`FORGE614_ECOSYSTEM_CONTRACT.md`](../../../FORGE614_ECOSYSTEM_CONTRACT.md) (root of this repo). This spec is the technical design that satisfies the contract's Section 5 ("Forge614 Engines") and Section 10 (public contracts Engines↔Shell, Engines↔Atlas). Where the two disagree, the contract wins and this spec must be updated.

## 1. Purpose

`forge614-engines` is the single source of truth for:

1. Which AI coding agents (Claude Code, Codex, Cursor, Antigravity, OpenCode, and future ones) are installed on the user's machine.
2. Where each agent's configuration lives and in what format.
3. Safely previewing and applying configuration changes to those agents (installing/removing MCP servers and hooks) without corrupting user-owned config.
4. Reporting whether a given agent can be invoked non-interactively, for `forge614-atlas`'s headless workers.

It replaces three divergent, duplicated implementations found in the existing ecosystem at design time:
- `forge614-shell`'s `src/engines/discovery.ts` (PATH-only detection of `claude`/`codex`/`agy`, no config awareness).
- `forge614-engram`'s `src/infrastructure/assistants/*` (the most complete implementation today: detection + full plan→preflight→apply MCP installer for 5 clients — this is the logic being generalized and absorbed here).
- `forge614-atlas`'s Plan 2 (not yet built, was blocked on Engram exposing its SDK — this blocker disappears because Atlas will depend on `forge614-engines` instead).

## 2. Non-goals (explicitly out of scope)

- **No TUI, no interactive prompts.** Per the ecosystem contract, `forge614-shell` is the only human-facing surface. Engines never asks the user anything directly.
- **No autonomous writes.** Engines never modifies a config file without an explicit, separately-confirmed `apply` call referencing a previously-computed plan.
- **No subscription/auth/quota status.** That capability already lives in `forge614-shell` (`src/engines/claude/auth.ts`, `catalog.ts`, etc.) and stays there. Engines only answers "is X installed and where does its config live," not "is the user logged in / what's their plan."
- **No cross-node update orchestration.** A future `forge614 update` that updates every installed Forge614 product is `forge614-ai`'s job once it exists. Engines does not enumerate or update sibling products.
- **No direct end-user installation.** Per the contract, nobody installs `forge614-engines` on purpose; it is bootstrapped automatically by whichever product needs it.

## 3. Agent adapter model

Each supported agent is one self-contained module implementing a shared `AgentAdapter` interface. Adding a new agent means adding one new module and registering it — no other code changes. This mirrors the most mature precedent found during research (`gentle-ai`'s Go adapter interface + self-validating capability manifest), adapted to TypeScript.

```ts
interface AgentAdapter {
  id: AgentId; // "claude-code" | "codex" | "cursor" | "antigravity" | "opencode" | ...
  label: string;

  // Detection
  candidateExecutableNames(platform: NodeJS.Platform): string[];
  knownInstallPaths(platform: NodeJS.Platform, home: string): string[];
  configDir(home: string): string;

  // Configuration format & write strategy
  configFile(home: string, scope: "user" | "workspace"): string;
  configFormat: "json" | "jsonc" | "toml" | "yaml";
  mcpEntryShape(executable: string, args: string[]): unknown; // e.g. {command, args} vs {type:'local', command:[...]}
  hookEntryShape(executable: string): unknown | null; // null if agent has no native hook mechanism

  // Capabilities (self-declared, validated against the methods actually implemented — see 3.1)
  capabilities: {
    supportsMcp: boolean;
    supportsHooks: boolean;
    supportsHeadlessExec: boolean;
  };

  // Headless invocation, only required if supportsHeadlessExec is true
  headlessCommand?(executable: string, prompt: string, opts: HeadlessOptions): { command: string; args: string[] };
}
```

### 3.1 Capability manifest validation

At registry build time, each adapter's declared `capabilities` are cross-checked against which optional methods it actually implements (e.g. `supportsHeadlessExec: true` requires `headlessCommand` to be present). A mismatch fails registration at startup (fail-closed), not silently at call time. This directly copies `gentle-ai`'s `ResolveCapabilityManifest` pattern, which caught a real class of bugs there.

### 3.2 Headless execution capability (new — does not exist yet anywhere in the ecosystem)

Neither `forge614-engram` nor `gentle-ai` model this; `forge614-shell` comes closest with its per-engine `session.ts` files (SDK call for Claude, JSON-RPC for Codex, `stream-json` for Antigravity, ACP for Gemini), but that logic is chat-session-shaped, not a one-shot headless invocation. For `forge614-atlas`'s non-interactive workers, `headlessCommand()` only needs to answer "what process do I spawn, with what args, to get one non-interactive completion from this agent" — not manage a full session. Initial adapters: `claude-code` (`claude -p <prompt>` equivalent) and `codex` (`codex exec`). Adapters without a viable headless mode set `supportsHeadlessExec: false`.

## 4. Detection

Pure filesystem inspection, no subprocess spawning:

1. Enumerate `PATH` directories (deduped, absolute only), check each candidate executable name for existence + execute permission (`stat` + `access(X_OK)`), matching the safeguards already proven in `forge614-shell/src/engines/discovery.ts` and `forge614-engram/src/infrastructure/assistants/catalog.ts` (reject directories, reject non-executable files).
2. Fall back to `knownInstallPaths()` for agents that are desktop apps rather than PATH binaries (e.g. Cursor on macOS: `/Applications/Cursor.app/...`).
3. Independently check `configDir()`/`configFile()` existence — an agent can be `installed: true, configFound: false` (fresh install, never configured) or theoretically the reverse (leftover config, binary removed).
4. No caching requirement for v1: detection re-runs on every `detect` call. This matches current behavior everywhere in the ecosystem and avoids stale-data bugs; revisit only if profiling shows it's too slow for Shell's interactive use.

## 5. Configuration writes: plan → snapshot → apply

Three strictly separated steps, never collapsed:

1. **`plan`** (read-only): parses the agent's current config (format-aware: `jsonc-parse` for JSON/JSONC, a TOML library for Codex, preserving comments/order where the format supports it — same requirement `forge614-engram` already solved), computes the exact diff needed, detects conflicts (an existing entry with the same key but different content → fails closed with a `CONFLICT` result, never silently overwritten) and policy blocks (e.g. an agent-level setting that disables MCP). Returns a `Plan` object with a `planId` and the literal bytes/patch that would be written. Touches no disk.
2. **snapshot**: immediately before `apply`, back up every file the plan touches (compressed archive + manifest with checksums, under `~/.forge614/engines/snapshots/<planId>/`), following `gentle-ai`'s backup/restore pattern — this is a stronger guarantee than `forge614-engram`'s current per-file temp+rename backup, since it gives a restorable snapshot, not just a `.bak` file.
3. **`apply`** (given a `planId`): re-validates the plan is still accurate (preflight — reject if the file changed since `plan` was computed, same TOCTOU guard `forge614-engram` already implements), then writes atomically: temp file in the same directory → `chmod` → `fsync` → `rename` → re-read and verify checksum → `fsync` parent directory. If new content equals existing content, no write occurs. This combines `forge614-engram`'s `guardedWrite` with `gentle-ai`'s stronger read-back verification.

Removal (`plan mcp-remove` / `apply`) is the symmetric inverse, only ever touching entries this system itself owns (matched by exact name/signature, never a heuristic that could catch user-authored entries).

Engines never calls `apply` on its own initiative. The confirmation gate (showing the plan to the user, obtaining explicit approval) is `forge614-shell`'s responsibility per the ecosystem contract; Engines only executes `apply` when invoked with a `planId` that some caller already got approved.

## 6. Public contract (CLI, versioned)

Consumption mode: **subprocess/CLI**, not a linked TypeScript library. Decision rationale (confirmed with product owner): a library import gets compiled into each consumer's binary at build time, so shipping a new agent adapter would require recompiling and re-releasing every downstream product before users could see it. A standalone installed binary means every consumer always calls the one binary currently installed under `~/.forge614/engines/bin/`, so adding agent support to Engines alone is immediately visible everywhere, and a future `forge614 update` only needs to update this one binary independently of the others.

All commands emit JSON with a `schemaVersion` field so callers can detect breaking changes:

```
forge614-engines detect --json
forge614-engines capabilities --agent <id> --json
forge614-engines plan mcp-install --agent <id> --name <mcp-name> --command <exe> --args <...> --json
forge614-engines plan mcp-remove  --agent <id> --name <mcp-name> --command <exe> --args <...> --json
forge614-engines apply --plan-id <id> --json
forge614-engines apply --plan-id <id> --revert --json   # restores from the snapshot taken for that plan
```

`plan mcp-remove` takes the full `--command`/`--args` of the entry, not just its name, because removal must reprove ownership of the exact entry (§5: only entries matching what `mcpEntryShape` would have produced are ever removed, so a user-authored entry that merely shares a name is never deleted).

This satisfies the contract's required contracts table (Section 10): Engines→Shell gets detection + capabilities + plan preview + apply; Engines→Atlas gets `detect`/`capabilities` (specifically `supportsHeadlessExec` + `headlessCommand`).

## 7. Storage layout

```
~/.forge614/engines/
├── bin/forge614-engines(.exe)
└── snapshots/<planId>/            # created only when apply runs; pruned by retention policy (TBD in implementation plan)
```

No `state.json`/cache in v1, per Section 4 (detection is always live). Owns only this subtree; never reads or writes into `~/.forge614/shell/`, `~/.forge614/engram/`, or `~/.forge614/atlas/`.

## 8. Distribution & bootstrap

- Distributed the same way as `forge614-shell` and `forge614-engram`: a compiled standalone binary via GitHub Releases, `install.sh`/`install.ps1`, SHA-256 checksum verification, symlink into `~/.forge614/bin/`. Not published as an npm package (no `bin` field reliance), since it must be installable with zero Node/Bun runtime assumptions on the end-user machine, matching the other two products.
- **Bootstrap:** any product that depends on Engines (Shell, Engram, Atlas — see contract Section 8 table) checks for `~/.forge614/engines/bin/forge614-engines` during its own install/init. If missing, it downloads and installs the matching compatible release of Engines first (checksum-verified), then proceeds. This mirrors the existing pattern where `forge614-engram` already shells out to `forge614-atlas`'s own binary for coordinated uninstall — delegation to the sibling's own installer/binary, never reimplementing its install logic.

## 9. Tech stack

TypeScript on Bun (per project instruction), following the layered structure precedent set by `forge614-engram` (`modules/` pure types and rules, `infrastructure/` real adapters — filesystem/process/config-format parsers, `app/` coordination, `interfaces/cli/` for the CLI surface), enforced by an architecture test (AST-based import rule checker) like Engram's `tests/architecture/import-rules.ts`. Tests colocated with source (`file.ts` + `file.test.ts`), `bun test`.

## 10. Open items for other repos (not decided here, noted for follow-up)

- `forge614-engram`'s public command reference in the ecosystem contract says `forge614-engram init --json`; the current implemented command is `setup`. Renaming/aliasing is Engram's decision, not Engines'.
- Once Engines ships its `plan`/`apply` contract, `forge614-engram` should migrate its own MCP self-installation (`src/infrastructure/assistants/configuration.ts`) to call Engines instead of maintaining its own writer, per the ecosystem contract's Section 11 implementation order (item 4: "remove its TUI and assistant ownership"). That migration is out of scope for this repo's implementation plan but is the reason Engines' `plan mcp-install` must be generic enough to install *any* MCP server definition, not just its own.

## 11. Success criteria

- Running `forge614-engines detect --json` on a machine with Claude Code and Codex installed (and Cursor not installed) correctly reports both installed agents with correct executable + config paths, and correctly reports Cursor as not installed.
- `plan mcp-install` for an agent whose config file already contains an unrelated MCP entry produces a plan that only adds the new entry, verified by `apply` leaving the unrelated entry untouched.
- `plan mcp-install` run twice against an agent that already has the target entry installed with identical content produces a no-op plan (or a plan whose `apply` performs zero writes).
- Attempting `apply` with a stale `planId` (file changed since plan was computed) fails closed with a clear error instead of overwriting the newer content.
- A new agent adapter can be added by creating one new module + one registry entry, with no changes to `detect`, `plan`, or `apply` command implementations.
