# 06. Headless execution and integrations

## The analogy: preparing a sealed order

Atlas sometimes needs to request an analysis without opening a visible conversation. Engines does not do that work for it: it prepares a sealed order with the correct program and arguments. Atlas decides when and where to start it.

## `headless` contract

“Headless” (without an interactive screen) means a program can receive an instruction and return a result without a person answering menus or prompts. Engines exposes how to construct that order:

```text
forge614-engines headless --agent claude-code --executable claude --prompt "Explain the structure"
forge614-engines headless --agent codex --executable codex --prompt "Explain the structure"
```

| Agent | Returned order | Support |
| --- | --- | --- |
| Claude Code | `claude -p <prompt>` | Yes |
| Codex | `codex exec <prompt>` | Yes |
| Cursor | — | No; returns `HEADLESS_UNSUPPORTED` |

`--timeout-ms` accepts a duration in milliseconds (one thousandths of a second) so the consumer can include it in its own control. The current adapter constructs the order and does not add that value to Claude Code or Codex arguments.

## Relationship with Atlas

The agreed flow is:

```text
Engines detects usable agents
        ↓
Atlas requests a screenless command
        ↓
Atlas starts and validates workers
        ↓
Atlas writes validated knowledge to Engram
```

Workers never write directly to Engram. Atlas does not reimplement detection. This division prevents different answers to the same question: “which agent is available?”.

## Relationship with Shell

Shell consumes `detect`, `capabilities`, plans, and `apply` for its visual flow. It may show a proposal, but it must not read `src/` or the plan directory directly. Engines does not show progress or ask for confirmation; those jobs belong to Shell.

## Adding a future agent

A new adapter declares an identifier, executable names, known locations, configuration file and format, MCP shape, and capabilities. If it marks `supportsHeadlessExec: true`, it must provide a function that builds the command. Registry tests reject an incomplete capability promise.
