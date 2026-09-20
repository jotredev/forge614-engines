# forge614-engines

Detects which AI coding agents (Claude Code, Codex, Cursor, …) are installed on the user's machine, and safely previews and applies MCP server configuration changes for them.

Internal dependency of the Forge614 ecosystem — see `FORGE614_ECOSYSTEM_CONTRACT.md`. Not meant to be installed directly by a person; other Forge614 products bootstrap it automatically.

## For other Forge614 products

Install (no PATH/profile changes — places a binary at a known path):

```bash
curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | bash
```

Then call it directly at `~/.forge614/engines/bin/forge614-engines` (macOS/Linux, arm64 or x64).

## Docs

- Spec: `docs/superpowers/specs/2026-09-19-forge614-engines-design.md`
- Plan: `docs/superpowers/plans/2026-09-19-forge614-engines-mvp.md`
- Handoff: `docs/superpowers/handoffs/2026-09-19-forge614-engines-mvp.md`

## Releasing

```bash
bun run release:cut <version>   # e.g. bun run release:cut 1.1.0
```

Bumps `package.json`, runs tests/typecheck, builds standalone binaries for macOS/Linux (arm64 + x64), commits, tags, pushes, and publishes the GitHub release with all assets.
