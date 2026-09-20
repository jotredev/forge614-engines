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
- Tests passing: 54
- Type checking: pass
- Total test files: 20
- Total expect() calls: 83

## Known scope reductions vs. the spec

- Snapshots are plain file copies + a checksum manifest, not a compressed archive (Task 10 note).
- TOML writes re-serialize the whole document; comments/ordering are not preserved (Task 15 note).
- No GitHub Releases / install.sh / checksum-verified distribution yet — only the compiled binary (Task 17 note). Needed before other Forge614 products can auto-bootstrap this one per the ecosystem contract §5/§8.

## Follow-up plans needed

1. Release automation + install script + auto-bootstrap from forge614-shell/forge614-engram.
2. Hook installation (`hookEntryShape`) — this plan only covers MCP servers, not native hooks, even though the spec's adapter interface anticipates them.
3. Migrate `forge614-engram`'s own MCP self-installation to call this CLI instead of its own writer (ecosystem contract §11, item 4).
