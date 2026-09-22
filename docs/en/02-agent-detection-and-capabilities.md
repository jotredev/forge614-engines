# 02. Agent detection and capabilities

## The analogy: roll call before opening the workshop

Before assigning work, the inspector takes roll: it looks for each tool, confirms it can be started, and records the functions it brings. Finding a folder is not the same as finding a usable tool, so Engines checks both separately.

## Registered agents

| Identifier | Searched executable | MCP file | MCP | Hooks | Headless execution |
| --- | --- | --- | ---: | ---: | ---: |
| `claude-code` | `claude` / `claude.exe` | `~/.claude.json` | Yes | Yes | Yes |
| `codex` | `codex` / `codex.exe` | `~/.codex/config.toml` | Yes | Yes | Yes |
| `cursor` | Cursor application | `~/.cursor/mcp.json` | Yes | No | No |

A hook (an action a program calls at a specific moment) is reported as information. It does not mean Engines configures it.

## How it searches

`detect` checks PATH first. It accepts only absolute paths and executable files, so it does not mistake a text file named `codex` for the real program. If it cannot find one there, it tries known locations: Claude Code may live at `~/.local/bin/claude`; Cursor has known application locations on macOS and Windows. Codex has no fixed fallback location.

It also checks whether the configuration directory exists even when the executable is missing. That lets Shell explain “settings are present, but the program is unavailable” without guessing why.

```text
forge614-engines detect
```

The response has an `agents` list. Each item includes `id`, `label`, `installed`, `executable`, `configDir`, and `configFound`.

## Querying capabilities

```text
forge614-engines capabilities --agent codex
```

The response reports `supportsMcp`, `supportsHooks`, `supportsHeadlessExec`, and `supportsReasoningLevel`. The latter indicates whether the engine's headless mode accepts a configurable reasoning level through `--reasoning-level` (`claude-code`: `false`, `codex`: `true`, `cursor`: `false`). It is an explicit adapter promise, not an inference from an agent's name. If an adapter claims headless support but cannot build its command, registration is rejected at startup.

## Limits and diagnosis

Detection does not start an agent, sign in, modify PATH, or test credentials. “Not installed” only means Engines did not find an executable file in the locations it checks; it does not prove that an account is signed out.
