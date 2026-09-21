# Forge614 Engram MCP conflict repair — design

**Status:** Approved scope, ready to plan.
**Requested by:** jorgeetrejoo, 2026-09-21.

## Problem

During `forge614-shell init --product engram`, Engines can already detect
that an MCP entry named exactly `forge614-engram` exists in a client config
(`~/.claude.json`, `~/.codex/config.toml`) with content that differs from
the canonical entry — `planMcpInstall` reports this as `CONFLICT` and
refuses to write. That refusal is correct and already shipped, but there is
no confirmed operation to *repair* the stale entry afterward. Shell has
nothing safe to call.

## Confirmed contract (source of truth for this task)

The requesting message specifies, verbatim:

- Engines owns detect / preview / apply / verify. Shell only shows the
  preview and collects confirmation — it must never edit
  `~/.claude.json` or `~/.codex/config.toml` itself.
- Only the MCP entry literally named `forge614-engram` is ever touched.
  Every other MCP entry, other files, memory storage, SQLite, `.env`, and
  other products' configuration are untouched.
- Canonical shape: `name: "forge614-engram"`, `command:` the path from
  `resolveEngramExecutable` (`FORGE614_HOME`-aware, `.exe` on Windows),
  `args: ["mcp"]`.
- Plan must classify into `not-installed`, `already-correct`,
  `repairable-conflict`, or `blocked`.
- Three public, non-interactive, JSON, no-TUI operations: repair plan,
  confirmed repair apply, final verify.
- Apply requires an explicit confirmation argument from Shell; without it,
  zero writes.
- Before writing: preserve foreign content, fail closed if the file
  changed since the plan, write atomically, never print secrets/env/
  credentials to stdout/stderr.
- Verify confirms: entry present, canonical command, canonical args,
  foreign config preserved.
- Covers Claude Code and Codex. Cursor is out of scope for this task (not
  actively blocked — it already goes through the same generic,
  agent-agnostic MCP machinery every other adapter uses — just not
  required or tested here).
- No TUI, no new agents, no touching Shell/Engram/Atlas/forge614-ai, no
  release/tag/push.

## Architecture decisions

1. **Reuse the existing Plan/apply primitives, don't fork them.**
   `Plan.writes` (`{path, beforeHash, afterContent}`), `applyPlan`'s
   stale-hash check + `createSnapshot` + `atomicWrite`, and
   `ConfigFormatIO.withMcpEntry`'s single-key targeted edit already give
   every safety property rules 8–9 ask for (fail-closed staleness,
   foreign-content preservation, atomic write). `Plan.action` gains one
   member (`"mcp-repair"`) and `Plan` gains an optional `repair` field
   (sibling to the existing `metadata`, not reusing its
   memory-integration-shaped type) carrying the classification and a
   redacted preview.

2. **Classification lives entirely in `planMcpRepair`, never throws for
   an expected state.** `not-installed`, `already-correct`,
   `repairable-conflict`, and `blocked` (with `blockedReason:
   "unparsable-config" | "not-writable"`) are all data on the returned
   plan, exactly like `memory-install`'s per-component `blocked` status.
   Only a genuinely unknown agent/id is an exception — matching every
   other `plan-*` function in this codebase.

3. **`ConfigFormatIO` gains `isParsable(raw): boolean`.** Verified live:
   `jsonc-parser`'s `parse()` does **not** throw on malformed JSON — it
   silently returns a best-effort object unless you pass an `errors[]`
   array and check its length. `smol-toml`'s `parse()` does throw. Both
   formats need an explicit, uniform parsability check so `blocked:
   unparsable-config` is a real classification rather than a crash or a
   silently-wrong "not-installed".

4. **Writability is checked only when a real conflict exists.**
   `isPathWritable` (new, `fs/promises access(W_OK)`, falling back to the
   parent directory when the file doesn't exist yet) runs only for the
   `repairable-conflict` vs. `blocked: not-writable` branch — not for
   `not-installed`/`already-correct`, where nothing would be written
   anyway.

5. **Preview redaction is a dedicated, narrow allowlist, not a
   blocklist.** `redactMcpEntry` keeps only `command` (string) and `args`
   (string[]) from the *existing* conflicting entry verbatim; every other
   key — including a hypothetical `env` block holding another tool's
   credentials — becomes `"<redacted>"`, and a non-object existing value
   (e.g. the key was repurposed for a plain string) becomes
   `{type, redacted: true}` rather than ever echoing the raw value. The
   canonical *desired* entry has no secrets and is never redacted.
   Shell is documented to render `plan.repair`, not
   `plan.writes[].afterContent` — the latter is the same
   whole-file-content plumbing `mcp-install`/`mcp-remove` plans already
   carry (and already store owner-only on disk for exactly this reason);
   this task does not change that pre-existing, already-documented
   trade-off for the rest of the plan surface.

6. **Apply is a dedicated, explicitly-confirmed operation — not a bare
   call into the generic `apply`.** `applyMcpRepair(home, planId,
   confirmed)` loads the plan, rejects (via `NotRepairableError`) a
   `planId` that isn't a `mcp-repair` plan, and — when `confirmed` is not
   `true` — returns `{applied: false, changedFiles: [], confirmed:
   false}` without reading, hashing, or touching anything. Only when
   `confirmed === true` does it delegate to the existing `applyPlan`,
   which performs the stale-hash check and atomic write already proven
   by `mcp-install`/`mcp-remove`.

7. **Verify is scoped to one specific repair transaction.** `verifyMcpRepair`
   takes the same `planId` apply used (mirroring "plan → confirmed apply →
   verify" as one transaction) and reports `present`, `commandCanonical`,
   `argsCanonical`, and `foreignPreserved`. `foreignPreserved` is computed
   by stripping the `forge614-engram` key from both the pre-write
   snapshot `createSnapshot` already saved and the current file (via the
   same `withMcpEntry(..., undefined)` primitive `mcp-remove` already
   uses) and comparing the two strings — a real, mechanical check, not an
   always-true claim. When the plan had no writes (nothing was ever
   touched), foreign content is trivially preserved.

## Non-goals (per the request)

- No changes to Forge614 Shell, Engram, Atlas, or `forge614-ai`.
- No new `AgentId`/adapter, no TUI anywhere in Engines.
- No writes to `~/.forge614/engram/`, `.env`, SQLite, or any Engram
  internal file.
- No release, tag, push, or publication of any kind.
- No behavior change to the existing `mcp-install`/`mcp-remove`/
  `memory-install`/`memory-remove` flows.

## Documentation

Per the existing convention (see the Engram memory-integration design),
this extends the existing `docs/{es,en}/03`, `04`, and `05` pages in place
and refreshes their fingerprints via
`bun scripts/verify-documentation.mjs --refresh-fingerprints` — it does
not create new Notion-mapped pages. `scripts/verify-documentation.mjs`'s
CLI-term regex is extended to recognize the three new `plan|apply|verify
mcp-repair` subcommands so `bun run verify:docs` (not part of CI today,
but part of repo hygiene) keeps passing.
