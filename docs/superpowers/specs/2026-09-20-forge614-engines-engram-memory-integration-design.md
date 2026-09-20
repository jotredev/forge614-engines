# Forge614 Engram memory integration — design

**Status:** Approved scope, ready to plan.
**Requested by:** jorgeetrejoo, 2026-09-20.

## Problem

Forge614 Engram v1.3.0 publishes a universal memory protocol via
`forge614-engram memory-protocol --json`. Nothing yet installs that protocol
into the three AI clients Engines already supports (Claude Code, Codex,
Cursor). Engram must not configure clients itself (its own docs say so:
`docs/en/09-public-memory-protocol.md` in the Engram repo, section "Not yet
implemented"), and Forge614 Shell must not implement a second engine
detector or TUI of its own. Engines is the only product allowed to own the
adapters, so this design lives entirely in `forge614-engines`.

## Confirmed external contract (source of truth)

Read directly from `jotredev/forge614-engram` on GitHub (read-only, for
research; nothing from that repo is imported or copied into Engines):

- `src/modules/memory-protocol/protocol.ts` defines and freezes:
  ```ts
  interface MemoryProtocol {
    id: "forge614-engram-memory";
    version: 1;
    instructions: string;
    lifecycle: { start: string[]; save: string[]; compact: string[]; resume: string[]; end: string[] };
    scopes: { shared: string; project: string };
    security: { neverSave: string[] };
  }
  ```
- `src/interfaces/cli/commands.ts`: `command === "memory-protocol"` prints
  `JSON.stringify(memoryProtocol(), null, 2)` to stdout — **no envelope**,
  the object above is the entire payload.
- `docs/en/09-public-memory-protocol.md`: without `--json`, or with unknown
  flags, the command writes `{code,error}` to stderr and exits `1`. The
  command needs no TTY, does not touch `~/.forge614/engram/`, SQLite, or
  Postgres.

Engines defines its own `MemoryProtocol` TypeScript type and a runtime
validator (`isMemoryProtocol`) matching this exact shape. That is
structural typing against a public contract, not "a hand-written copy of
the protocol" — the actual `instructions`/`lifecycle`/... **content**
Engines ever writes to disk always comes from a real invocation of the
command, never from a literal string authored inside Engines.

Engines computes its own SHA-256 fingerprint over the raw stdout bytes for
verification purposes. It does not depend on Engram including a hash field.

## Confirmed per-agent instructions mechanism

Researched via each vendor's current public docs (WebSearch, 2026-09-20):

| Agent | Global, automatic, file-based mechanism | Verdict |
|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md`, loaded at the start of every session. Supports `@relative-file` imports resolved next to the importing file (empirically confirmed: this very session's own `~/.claude/CLAUDE.md` is a single `@RTK.md` line). | **Full support.** Engines manages a single-line import block in `CLAUDE.md` pointing at a dedicated, Forge614-owned satellite file. |
| Codex CLI | `~/.codex/AGENTS.md` (or `CODEX_HOME`), read at the start of every session. If `~/.codex/AGENTS.override.md` exists and is non-empty, Codex reads **only** that file and ignores `AGENTS.md` entirely (official docs, developers.openai.com/codex/guides/agents-md). | **Full support**, with one real shadowing conflict to detect: an existing non-empty `AGENTS.override.md`. |
| Cursor | "Project Rules" (`.cursor/rules/*.mdc`) are file-based but **project-scoped**, not global. "User Rules" are global but configured only through the Cursor Settings UI (cursor.com/docs/rules) — no officially documented external file. | **Instructions: unsupported** (no safe, stable, file-based global mechanism). MCP is unaffected: `~/.cursor/mcp.json` is Cursor's documented global MCP config and Engines already writes it correctly. |

Per the task's rule 6, Cursor's overall memory-integration status is
therefore **`partial`**: MCP installs fully; instructions are reported
`unsupported` with a clear explanation, never silently claimed as working.

Codex's `AGENTS.override.md` shadow is a real, detectable conflict: if
present and non-empty, Engines must **block** the instructions component
(propose no write for it) rather than write into `AGENTS.md`, where it
would silently never be read.

None of the three adapters need a `platform` parameter for these new paths
(same convention as the existing `configFile`/`configDir`, which are also
platform-generic — only executable *discovery* methods take `platform`).
`node:path.join` already produces correct Windows paths from a Windows
`home` string; no new Windows-specific branches are needed, and none of
Windows' existing support is touched or degraded.

## Architecture decisions

1. **Reuse, don't fork, the plan/apply mechanism.** `Plan.writes` is
   already a generic `{path, beforeHash, afterContent}` array; `applyPlan`
   already applies an arbitrary list of file writes under one hash-checked,
   snapshotted, atomic operation. A single memory-integration plan can
   already contain an MCP config write *and* one or two instructions-file
   writes in the same `writes` array — no format change needed there.
   `Plan.action` gains two new members (`"memory-install"`,
   `"memory-remove"`) and `Plan` gains an optional `metadata` field so the
   single coherent view the task requires (current MCP state, current
   instructions state, protocol id/version/fingerprint, per-component
   noop/write/blocked/unsupported status, overall status) travels with the
   same plan object Shell already knows how to request and apply.
2. **One new small write capability: delete.** Removing Claude Code's
   satellite content file cleanly (rather than leaving an empty husk)
   needs `PlanWrite.delete?: boolean` and a matching `atomicDelete` in
   `atomic-write.ts`, applied through the exact same hash-check/snapshot
   path as every other write. This is the only change to the core
   plan/apply primitives.
3. **Fatal protocol failure blocks the whole install, before any file is
   touched.** If Engram is not installed, the command fails, or the JSON
   is invalid/doesn't match the schema, `planMemoryInstall` throws
   `EngramProtocolUnavailableError` (one stable error code,
   `ENGRAM_PROTOCOL_UNAVAILABLE`) before computing *any* MCP or
   instructions decision — per-agent, zero writes, nothing persisted.
   This is deliberately different from a **per-component** conflict (an
   existing different `engram` MCP entry, or Codex's `AGENTS.override.md`
   shadow), which is represented as *data* inside one plan (`status:
   "blocked"`) so Shell can show a single coherent preview instead of
   juggling a thrown exception for one piece and a plan for the rest.
4. **Ownership marker, not content matching, drives safe removal.**
   Instructions blocks are delimited by an explicit, namespaced marker
   (`<!-- forge614-engines:begin engram-memory-protocol -->` /
   `...end...`). Removal only ever touches text between those markers (or
   deletes the dedicated satellite file), and never needs Engram to be
   reachable, installed, or to re-fetch the protocol — matching the
   requirement that retire must work independently of install state.
   Content *inside* Engines' own markers is by definition Forge614's own
   prior write, so updating it on a later `memory-install` (e.g. the
   protocol text changed upstream) is a `write`, never a `conflict` — a
   conflict only exists for the MCP entry (a shared key another tool could
   plausibly also use) and for Codex's shadow file.
5. **No new Notion-mapped docs.** `scripts/verify-documentation.mjs`
   requires every `docs/{es,en}/NN-*.md` file to carry a real
   `notionUrl` and enforces an exact total document count
   (`verify-documentation.test.ts` asserts `documents: 16` against the
   real repo). Creating new pages would mean publishing real pages to the
   user's Notion workspace, which nobody asked for and the delivery rules
   forbid ("no publication"). Instead this work extends the *existing*
   03/04/05/07 pages (es+en) and refreshes their fingerprints via the
   already-existing `--refresh-fingerprints` flag.

## Explicit non-goals (per the request)

- No `forge614-ai`, no new TUI anywhere in Engines.
- No new agents (OpenCode, Antigravity, ...).
- No writes to `~/.forge614/engram/`, `engram.db`, `.env`, or any Engram
  internal file — the only contact with Engram is spawning
  `forge614-engram memory-protocol --json` as a subprocess and reading its
  stdout.
- No release, tag, push, or publication of any kind.

## Known, deliberately out-of-scope limitation

`CODEX_HOME` (an env var that can relocate Codex's config directory away
from `~/.codex`) is not threaded through `AgentAdapter.configFile`/
`configDir` today for the *existing* MCP config path either — `codexAdapter`
already hardcodes `join(home, ".codex", ...)`. The new `AGENTS.md`/
`AGENTS.override.md` paths follow that same existing convention and carry
the same existing limitation. Fixing it would mean widening the
`AgentAdapter` interface to thread `env` through every path method, which
is a larger, unrelated refactor — flagged here rather than silently
worked around.
