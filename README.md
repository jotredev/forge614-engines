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
bun run release:cut <version>   # e.g. bun run release:cut 1.2.0
```

Bumps `package.json`, runs tests/typecheck, commits, tags, and pushes. The tag push triggers
`.github/workflows/release.yml`, which builds and smoke-tests each platform's binary on its own
native GitHub Actions runner (including a real Windows machine) and publishes the GitHub release
with all assets. `bun run release:bundle` (`scripts/release-bundle.mjs`) is also available for
building all targets locally, e.g. to test `install.sh`/`install.ps1` against a local archive before
cutting a real release.
