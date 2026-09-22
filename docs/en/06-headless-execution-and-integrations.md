# 06. Headless execution and integrations

## The analogy: preparing a sealed order

Atlas sometimes needs to request an analysis without opening a visible conversation. Engines does not do that work for it: it prepares a sealed order with the correct program and arguments. Atlas decides when and where to start it.

## `headless` contract

“Headless” (without an interactive screen) means a program can receive an instruction and return a result without a person answering menus or prompts. Engines exposes how to construct that order:

```text
forge614-engines headless --agent claude-code --executable claude --prompt "Explain the structure"
forge614-engines headless --agent codex --executable codex --prompt "Explain the structure"
forge614-engines headless --agent codex --executable codex --prompt "Explain the structure" --model gpt-5-codex --reasoning-level medium
```

| Agent | Returned order | Support |
| --- | --- | --- |
| Claude Code | `claude -p <prompt>` | Yes |
| Codex | `codex exec <prompt>` | Yes |
| Cursor | — | No; returns `HEADLESS_UNSUPPORTED` |

`--timeout-ms` accepts a duration in milliseconds (one thousandths of a second) so the consumer can include it in its own control. The current adapter constructs the order and does not add that value to Claude Code or Codex arguments.

`--model <model-id>` and `--reasoning-level <low|medium|high>` are optional and additive: omitting both keeps the exact command each adapter always built. Each adapter decides for itself how (or whether) to honor them, the same way each adapter already owns its own headless command shape:

| Agent | `--model` | `--reasoning-level` |
| --- | --- | --- |
| Claude Code | Appends `--model <model-id>` | Not supported — throws `REASONING_LEVEL_UNSUPPORTED`. Claude Code's CLI has no public, stable flag to select a reasoning/thinking level, so the adapter rejects it explicitly instead of silently building a command that would ignore it. |
| Codex | Appends `--model <model-id>` | Appends `-c model_reasoning_effort=<level>` |

## Keeping the prompt out of `ps`

By default the prompt is embedded directly in `args` (e.g. `["-p", "<prompt>"]`), which makes it visible to any other process or user on the same machine that can run `ps` — a real risk when the prompt carries sensitive repository content. `--stdin-prompt` is an optional, additive flag: omitting it keeps today's exact behavior (nothing here changes for a caller that never passes it).

When `--stdin-prompt` is passed, the adapter removes the prompt from `args` entirely and the returned command carries `"stdin": true`. The caller (Atlas) already has the prompt it originally sent — it must write that exact text to the spawned process's stdin and close it (send EOF) instead of finding it in `args`:

```text
forge614-engines headless --agent claude-code --executable claude --prompt "Explain the structure" --stdin-prompt
```

```json
{ "command": "claude", "args": ["-p"], "stdin": true }
```

| Agent | Stdin delivery | Confirmed by |
| --- | --- | --- |
| Claude Code | Supported: `claude -p` with no positional prompt reads it from stdin | Live invocation against the real CLI |
| Codex | Supported: `codex exec` with no positional prompt argument reads it from stdin | `codex exec --help`: "If not provided as an argument (or if `-` is used), instructions are read from stdin" |

Both currently-supported headless agents honor `--stdin-prompt`, so there is no exception to document today. If a future adapter cannot deliver the prompt via stdin, it must throw an explicit error from its own `headlessCommand()` (the same pattern as `REASONING_LEVEL_UNSUPPORTED`) rather than silently leaving the prompt in `args` — silently ignoring the flag would defeat the security goal this flag exists for.

## Granting read access to a real directory

The spawned process is normally confined to its own isolated working directory. `--readable-dir <path>` is an optional, additive flag that grants it read access to one additional real project folder without otherwise loosening that isolation: omitting it keeps today's exact behavior.

```text
forge614-engines headless --agent claude-code --executable claude --prompt "Explain the structure" --readable-dir /path/to/project
```

```json
{ "command": "claude", "args": ["--add-dir", "/path/to/project", "-p", "Explain the structure"] }
```

Both currently-supported headless agents map it to `--add-dir <path>`, always placed before the prompt (`--add-dir` is variadic — it accepts several paths in a row — so placing it after the prompt would swallow the prompt text as another path):

| Agent | Behavior | Confirmed by |
| --- | --- | --- |
| Claude Code | Appends `--add-dir <path>` before `-p`. Confirmed not to load that folder's `CLAUDE.md` — only the real user's global `CLAUDE.md` loads, which is the expected behavior. | Live invocation against the real CLI |
| Codex | Appends `--add-dir <path>` before the positional prompt. `--add-dir` can technically grant write access on Codex, but `codex exec`'s default sandbox stays read-only as long as neither `--sandbox workspace-write` nor `--sandbox danger-full-access` is also passed (this adapter never passes either). | Live invocation against the real CLI |

**Accepted limitation (Codex only):** unlike Claude Code, Codex may read and be influenced by that folder's `AGENTS.md` if it decides to explore the directory on its own — Codex has no equivalent to Claude Code's `--allowedTools` to restrict this further. This is a low-risk, accepted limitation (Codex still cannot write to or damage anything under the default read-only sandbox) and is not something this integration attempts to solve.

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

A new adapter declares an identifier, executable names, known locations, configuration file and format, MCP shape, and capabilities. If it marks `supportsHeadlessExec: true`, it must provide a function that builds the command. It also declares `supportsReasoningLevel` to indicate whether it accepts `HeadlessOptions.reasoningLevel` (the `--reasoning-level` flag); `headlessCommandFor()` uses that capability to return `REASONING_LEVEL_UNSUPPORTED` when appropriate. Registry tests reject an incomplete capability promise.
