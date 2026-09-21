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
bun run release   # picks the version itself — see below
```

With no `<version>` argument (the recommended way to run it), it works out a reasonable one for
you instead of leaving you to pick a number: it looks at every commit since the latest tag and
suggests a version, minor for any `feat:` commit, patch otherwise, major for a `!` after the type
(`feat!:`) or a `BREAKING CHANGE:` footer — the same logic `bun run verify:release` uses to preview
this without publishing anything. You get a breakdown of every commit and its classification, then
a prompt with the suggested version as the default (press Enter to accept it, or type a different
one). Non-interactively (no TTY), it uses the suggestion straight away with no prompt — that's what
makes running it unattended work.

You can still pass a version explicitly to skip all of that: `bun run release 1.9.0` (`release:cut`
is the same script, kept as an alias).

Either way, before touching anything, it validates the version against the real release history —
`git tag`, not `package.json`'s current field, since a prior attempt can leave that file already
bumped without ever having tagged or pushed (exactly what happened cutting v1.9.0 the first time):

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
