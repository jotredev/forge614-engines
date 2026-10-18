# forge614-engines

Forge614 tools to detect coding agents, inspect capabilities, and apply MCP configuration changes through safe plans. The shared installer is defined by `forge614.node.json` and decision 0031.

## Install

Supported platforms: macOS (arm64/x64), Linux (arm64/x64), and Windows (x64). Node.js 22.19.0 or newer is required. Installation does not change PATH or shell profiles.

```sh
curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | sh
```

```powershell
irm https://github.com/jotredev/forge614-engines/releases/latest/download/install.ps1 -OutFile install.ps1
./install.ps1
```

The executable is at `~/.forge614/engines/bin/forge614-engines`, or under `%USERPROFILE%\.forge614\engines\bin\forge614-engines.exe` on Windows. Use `--version --json` for a JSON version object.

## Update and uninstall

`forge614-engines update [--version X.Y.Z] [--json]` updates through the verified gatekeeper and returns the JSON consumed by Shell 1.17.0 even without `--json`. This exception to decision 0031 will be removed when Shell passes that flag. From 1.17.x, two updates are required: the first leaves 1.18.0 in the earlier layout; the second migrates through the shared installer.

`forge614-engines uninstall [--force] [--json]` stops if Shell, Workers, Atlas, or Engram is installed. `--force` also removes the integrations Engines manages in Claude Code and Codex. `uninstall --self` removes only those integrations and preserves unrelated content.

## Development

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
```

Bilingual product documentation is in [docs](docs/README.md). To compile a CI binary, set `FORGE614_TARGET` (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, or `windows-x64`) and run `bun run build:target`.
