# forge614-engines

Detects which AI coding agents (Claude Code, Codex, Cursor, …) are installed on the user's machine, and safely previews and applies MCP server configuration changes for them.

Internal dependency of the Forge614 ecosystem — see `FORGE614_ECOSYSTEM_CONTRACT.md`. Not meant to be installed directly by a person; other Forge614 products bootstrap it automatically.

## For other Forge614 products

Supported platforms: macOS (arm64/x64), Linux (arm64/x64), Windows (x64).

Install (no PATH/profile changes — places a binary at a known path):

```bash
# macOS / Linux
curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | bash
```

```powershell
# Windows
irm https://github.com/jotredev/forge614-engines/releases/latest/download/install.ps1 -OutFile install.ps1
./install.ps1
```

Then call it directly — `~/.forge614/engines/bin/forge614-engines` on macOS/Linux, or
`%USERPROFILE%\.forge614\engines\bin\forge614-engines.exe` on Windows.

## Docs

- [Bilingual product documentation / Documentación bilingüe del producto](docs/README.md)
- Spec: `docs/superpowers/specs/2026-09-19-forge614-engines-design.md`
- Plan: `docs/superpowers/plans/2026-09-19-forge614-engines-mvp.md`
- Handoff: `docs/superpowers/handoffs/2026-09-19-forge614-engines-mvp.md`

## Releasing

```bash
bun run release <version>   # e.g. bun run release 1.9.0 — "release:cut" also works, same script
```

Leave off `<version>` and it prompts for one interactively (shows the current `package.json`
version as a hint; refuses cleanly instead of hanging if stdin isn't a terminal).

Before touching anything, it validates the version against the real release history — `git tag`,
not `package.json`'s current field, since a prior attempt can leave that file already bumped
without ever having tagged or pushed (exactly what happened cutting v1.9.0 the first time):

- rejects anything that isn't `X.Y.Z`
- rejects a version that isn't newer than the highest version any existing tag claims
- rejects a version whose tag (`vX.Y.Z`) already exists — no duplicate releases

It then shows exactly what it's about to do — bump `package.json` (or say so explicitly if it's
already at the target version, from an earlier attempt) and tag + push — and asks for a `[y/N]`
confirmation before touching anything. Once confirmed: bumps `package.json`, syncs
`docs/notion-map.json`'s `productVersion` to match (checked by `verify:docs`, so these two can't
silently drift apart again), runs tests/typecheck, commits, tags, and pushes.

The tag push triggers `.github/workflows/release.yml`, which builds and smoke-tests each
platform's binary on its own native GitHub Actions runner (including a real Windows machine) and
publishes the GitHub release with all assets. The script then finds that run and streams its live,
job-by-job progress into the same terminal (`gh run watch`) instead of leaving you to check
manually — reporting the real release URL only once the run actually succeeds, or the failed run's
URL if it didn't. If `gh` isn't installed or authenticated, it falls back to printing the Actions
page link instead — the tag is already pushed by that point either way, so this can't fail the
release itself.

`bun run release:bundle` (`scripts/release-bundle.mjs`) is also available for building all targets
locally, e.g. to test `install.sh`/`install.ps1` against a local archive before cutting a real
release.
