# 05. Public CLI reference

## The analogy: a counter with uniform receipts

The CLI (command-line interface) is the Engines counter. Every request returns a JSON receipt with `schemaVersion: 1`. Products must use that public contract, not import private files from this repository.

## Commands

| Command | Main result | Writes |
| --- | --- | --- |
| `forge614-engines detect` | detected `agents` | No |
| `forge614-engines capabilities --agent <id>` | one agent's capabilities | No |
| `forge614-engines plan mcp-install ...` | installation `plan` | Stores the plan only |
| `forge614-engines plan mcp-remove ...` | removal `plan` | Stores the plan only |
| `forge614-engines plan memory-install --agent <id>` | one coherent memory-integration `plan` | Stores the plan only |
| `forge614-engines plan memory-remove --agent <id>` | one coherent memory-integration removal `plan` | Stores the plan only |
| `forge614-engines apply --plan-id <id>` | application `result` | Yes, only for confirmed plan |
| `forge614-engines headless ...` | `headless` command and arguments | No |
| `forge614-engines update` | update `result` | Manages Engines only |
| `forge614-engines verify memory-integration --agent <id>` | current MCP/instructions `verification` | No |

`--args` consumes values until the next flag beginning with `--`. This keeps MCP-server arguments from accidentally swallowing another Engines option.

## Examples

```text
forge614-engines capabilities --agent cursor
forge614-engines headless --agent codex --executable codex --prompt "Summarize this repository"
forge614-engines plan mcp-install --agent claude-code --name engram --command forge614-engram --args mcp
```

`headless` output does not run Codex or Claude Code: it produces the safe order that Atlas may decide to start. For Codex the order is `codex exec <prompt>`; for Claude Code it is `claude -p <prompt>`.

`plan memory-install` reads the protocol fresh from `forge614-engram memory-protocol --json` every time, decides the MCP entry and the instructions file(s) for the given agent, and returns one plan that already contains every write `apply` needs — install and remove for the memory integration share the same `apply --plan-id <id>` command as any other plan. `verify memory-integration` never touches Engram; it only inspects the files Engines itself manages.

## Public errors

Every error is JSON with `error.code` and `error.message`.

| Code | Cause |
| --- | --- |
| `CONFLICT` | a different MCP entry already has the same name |
| `STALE_PLAN` | the file changed after plan creation |
| `UNRECOGNIZED_ENTRY` | removal would affect an unrecognized entry |
| `PLAN_NOT_FOUND` | the plan was not found |
| `UPDATE_ASSET_MISSING` | no download exists for the platform and architecture |
| `HEADLESS_UNSUPPORTED` | the agent cannot build a command without a screen |
| `UNKNOWN_COMMAND` | the word combination is not a public command |
| `UNKNOWN_AGENT` | the identifier is not registered |
| `INTERNAL_ERROR` | an unclassified problem occurred |
| `ENGRAM_PROTOCOL_UNAVAILABLE` | Engram is not installed, the command failed, or its JSON did not match the protocol shape |

Do not automate decisions from message prose; use the stable code.
