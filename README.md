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
one single prompt:

```
Release 1.10.0? [Y/n, or type a different version]:
```

Enter or `y` accepts it and goes straight to publishing — that one answer already is the release
confirmation, so it never asks "continue?" a second time right after. `n` aborts. Typing a
different version instead treats it as a deliberate override, which does get its own explicit
confirmation afterward (see below) — overriding what was suggested is a different, more deliberate
decision than accepting it, and deserves its own gate; accepting it doesn't need two. Non-interactively (no TTY), it uses the suggestion straight away with no prompt at all — what makes running it
unattended work.

You can still pass a version explicitly to skip all of that: `bun run release 1.9.0` (`release:cut`
is the same script, kept as an alias) — but typing a number doesn't mean it's accepted blindly.
Either way, before touching anything, it validates the version against the real release history —
`git tag`, not `package.json`'s current field, since a prior attempt can leave that file already
bumped without ever having tagged or pushed (exactly what happened cutting v1.9.0 the first time):

- rejects anything that isn't `X.Y.Z`
- rejects a version that isn't newer than the highest version any existing tag claims
- rejects a version whose tag (`vX.Y.Z`) already exists — no duplicate releases
- if what you typed (as an argument, or overriding the prompt's suggested default) doesn't match
  what the commits actually suggest — e.g. asking for `5.0.0` when nothing warrants more than a
  minor bump — it shows the mismatch and asks you to confirm that specific number is intentional,
  instead of silently accepting whatever number was typed; otherwise (an explicit version that
  already matches what's expected) it shows the usual bump/tag/push summary and asks to confirm that

Once confirmed: bumps `package.json`, syncs `docs/notion-map.json`'s `productVersion` to match
(checked by `verify:docs`, so these two can't silently drift apart again), runs
tests/typecheck, commits, tags, and pushes.

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
