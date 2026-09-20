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

- [x] detect correctly reports installed/not-installed agents (manually verified with Claude Code installed).
- [x] installing into a config with unrelated existing content leaves that content untouched (Task 8 test).
- [x] installing the same entry twice produces a noop (Task 8 test).
- [x] apply refuses a stale plan instead of overwriting (Task 11 test).
- [x] adding an agent (Codex, Task 15; Cursor, Task 16) required only a new adapter file + one registry line, no changes to detect/plan/apply.

## Test suite results

**Final run:** `bun test && bun run typecheck`
- Tests passing: 62
- Type checking: pass
- Total test files: 21
- Total expect() calls: 122

## Known scope reductions vs. the spec

- Snapshots are plain file copies + a checksum manifest, not a compressed archive (Task 10 note).
- TOML writes re-serialize the whole document; comments/ordering are not preserved (Task 15 note).
- `apply --plan-id <id> --revert` (restoring from a snapshot) is not wired up — `restoreSnapshot()` exists and is tested in isolation but is not reachable from any CLI command yet.
- `configFile(home, scope)` was reduced to `configFile(home)` — workspace-scoped config (as opposed to user-scoped) is not supported by any adapter yet.
- Snapshot and plan file retention/pruning was never implemented — `~/.forge614/engines/plans/` and `~/.forge614/engines/snapshots/` grow unbounded; nothing prunes old entries.

## v1.0.0 release (2026-09-20)

Published at https://github.com/jotredev/forge614-engines/releases/tag/v1.0.0 — standalone binaries
for macOS/Linux (arm64 + x64), each with a checksum, plus `install.sh` (`scripts/install.sh`, no
PATH/profile changes — installs to `~/.forge614/engines/<version>/` with a stable
`~/.forge614/engines/bin/forge614-engines` launcher). Cut with `bun run release:cut <version>`
(`scripts/release-cut.mjs`: bump, test, typecheck, bundle all 4 targets, commit, tag, push, publish
via `gh release create`). Verified end to end: installed the published `v1.0.0` from a clean
`$HOME` via `curl | bash` and ran the installed binary's `detect`/`capabilities` commands
successfully.

## Follow-up plans needed

1. `forge614-shell`, `forge614-engram`, and `forge614-atlas` bootstrapping this binary from their
   own installers and migrating their local detection/assistant-configuration logic to call it —
   out of scope for this repo; owned by each product's own agent per the ecosystem contract.
2. Hook installation (`hookEntryShape`) — this plan only covers MCP servers, not native hooks, even though the spec's adapter interface anticipates them.
3. Migrate `forge614-engram`'s own MCP self-installation to call this CLI instead of its own writer (ecosystem contract §11, item 4) — same ownership note as above.
