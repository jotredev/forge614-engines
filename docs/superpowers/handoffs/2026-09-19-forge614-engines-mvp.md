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
for macOS/Linux (arm64 + x64), each with a checksum, plus `install.sh`. Cut by running
`release-bundle.mjs`/`gh release create` locally on one developer machine. Verified end to end
(installed the published release via `curl | bash`, ran `detect`/`capabilities`), but a stale-build
bug (old 0.1.0 assets leaked into the release alongside the 1.0.0 ones, from a prior local test run
that `release-bundle.mjs` didn't clear) was caught and fixed after the fact — see the v1.1.0 entry
below for why the release process changed.

## v1.1.0 release (2026-09-20): Windows support + CI-driven releases

Published at https://github.com/jotredev/forge614-engines/releases/tag/v1.1.0. Two things changed:

**Windows (x64) is now a supported platform**, alongside macOS and Linux (arm64 + x64 each; Bun has
no `windows-arm64` `--compile` target yet, confirmed by trying it):
- `scripts/install.ps1` mirrors `install.sh`'s contract (download-latest or `-Archive` for local
  testing, SHA256 verification, install to `%USERPROFILE%\.forge614\engines\<version>\`, no PATH
  changes) but copies the binary to its stable launcher path instead of symlinking it, since Windows
  file symlinks often need elevated privileges.
- Cursor's Windows install path (`%LOCALAPPDATA%\Programs\cursor\Cursor.exe`) was added; Claude
  Code's and Codex's config paths needed no changes at all — both already resolve to
  `%USERPROFILE%\.claude`/`.codex` on Windows via the same `home`-relative logic used on macOS/Linux
  (confirmed against each project's own docs, not assumed).
- A real Windows CI run caught bugs no amount of local macOS/Linux testing could: several tests
  hardcoded POSIX-separator path strings against `path.join()`'s host-native output, and two more
  hardcoded a `"darwin"` platform argument while creating real host-native temp paths, corrupting
  PATH-list splitting once those paths were real Windows paths containing `C:` and backslashes. All
  fixed; see the commit history around 2026-09-20 for details. One test's premise doesn't hold on
  Windows at all (`fs.access`'s `X_OK` is a no-op there) and is skipped on `win32` with an
  explanation rather than "fixed."

**Releases are now built and published entirely by GitHub Actions** (`.github/workflows/release.yml`,
copied from `forge614-engram`'s structure and adapted for 5 platform targets instead of 4), triggered
by pushing a `v*` tag. Each platform's binary is compiled and smoke-tested on its own native runner —
including a real `windows-latest` machine — instead of cross-compiled and trusted from one developer's
machine. This closes the exact bug class that leaked stale assets into v1.0.0: CI always starts from a
clean checkout. `scripts/release-cut.mjs` now only bumps the version, tests, commits, tags, and
pushes; a `.github/workflows/verify.yml` (also copied from Engram, with an added Windows job) runs
the same checks on every push/PR across Linux, macOS, and Windows.

Verified end to end on the real v1.1.0 release: watched the full Actions run build and smoke-test all
5 targets natively, downloaded and ran the published `install.sh` on a clean `$HOME`, and confirmed
`detect` reports all three agents correctly.

## Follow-up plans needed

1. `forge614-shell`, `forge614-engram`, and `forge614-atlas` bootstrapping this binary from their
   own installers and migrating their local detection/assistant-configuration logic to call it —
   out of scope for this repo; owned by each product's own agent per the ecosystem contract.
2. Hook installation (`hookEntryShape`) — this plan only covers MCP servers, not native hooks, even though the spec's adapter interface anticipates them.
3. Migrate `forge614-engram`'s own MCP self-installation to call this CLI instead of its own writer (ecosystem contract §11, item 4) — same ownership note as above.

## Documentation maintenance (2026-09-20)

The current product guide lives in `docs/README.md`, with synchronized Spanish and English pairs `00` through `07`. Local Markdown is the reviewed source of truth; `docs/notion-map.json` maps every page to the matching Notion mirror and records its content fingerprint.

Whenever a public command, error code, adapter, capability, configuration location, or safety rule changes:

1. Update the matching ES/EN local pair and the Notion mirror together.
2. Refresh the map fingerprints with `bun scripts/verify-documentation.mjs --refresh-fingerprints`.
3. Run `bun run verify:docs`, `bun test`, and `bun run typecheck` before declaring the documentation synchronized.
