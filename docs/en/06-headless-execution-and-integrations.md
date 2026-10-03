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

An agent without headless execution answers `HEADLESS_UNSUPPORTED`.

`--timeout-ms` accepts a duration in milliseconds (one thousandths of a second) so the consumer can include it in its own control. The current adapter constructs the order and does not add that value to Claude Code or Codex arguments.

`--model <model-id>` and `--reasoning-level <low|medium|high|xhigh|max>` are optional and additive: omitting both keeps the exact command each adapter always built. Each adapter decides for itself how to honor them, the same way each adapter already owns its own headless command shape. Engines checks once, before any adapter runs, in this order: unknown agent (`UNKNOWN_AGENT`), agent without headless execution (`HEADLESS_UNSUPPORTED`), `--read-only` asked of an agent that cannot guarantee it (`READ_ONLY_UNSUPPORTED`; no real agent does that today), a level given to an agent that cannot choose one (`REASONING_LEVEL_UNSUPPORTED`; no real agent does that today) and, last, a value the agent does not list, which is any value outside the five (`INVALID_REASONING_LEVEL`):

| Agent | `--model` | `--reasoning-level` |
| --- | --- | --- |
| Claude Code | Appends `--model <model-id>` | Appends `--effort <level>` as the last argument: after `-p`, after the prompt (when it is not sent through stdin) and after `--model` (when given). Haiku 4.5 has no reasoning levels and Claude Code ignores the flag for it without an error. Claude Code does not reject an unknown value either (it warns and keeps its default effort), which is why Engines validates the level first. |
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

## Granting access to a real directory

The spawned process is normally confined to its own isolated working directory. `--readable-dir <path>` is an optional, additive flag that gives it access to one additional real project folder without otherwise loosening that isolation: omitting it keeps today's exact behavior. It grants access, not read-only access: what keeps the helper from writing there is `--read-only` (see "Locking the helper to read-only" below).

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
| Codex | Appends `--add-dir <path>` before the positional prompt. `codex exec --help` describes `--add-dir` as directories "that should be writable alongside the primary workspace", so it is not a read-only grant. In a live check, writing into that folder still failed with "operation not permitted" because the default sandbox of `codex exec` is read-only, but that default is not a promise this adapter makes: the real protection is `--read-only`. | `codex exec --help` and a live invocation against the real CLI |

**Accepted limitation (Codex only):** unlike Claude Code, Codex may read and be influenced by that folder's `AGENTS.md` if it decides to explore the directory on its own — Codex has no equivalent to Claude Code's `--allowedTools` to restrict this further. This is a low-risk, accepted limitation (with `--read-only` Codex runs in an explicit read-only sandbox and cannot write to or damage anything; without it that depends on the default sandbox of `codex exec`, which this adapter does not control) and is not something this integration attempts to solve.

## Locking the helper to read-only

`--read-only` is an optional, additive flag for helpers (the workers) that must only read, such as the ones Atlas launches: omitting it keeps today's exact behavior, argument for argument. With it, the helper cannot write files and cannot reach the user's MCP servers, so it cannot save anything to Engram either.

```text
forge614-engines headless --agent codex --executable codex --prompt "Explain the structure" --read-only
```

```json
{ "command": "codex", "args": ["exec", "--sandbox", "read-only", "--ignore-user-config", "Explain the structure"] }
```

| Agent | What `--read-only` adds | Where |
| --- | --- | --- |
| Claude Code | `--tools Read,Grep,Glob --permission-mode dontAsk --strict-mcp-config` | After `--add-dir` (when given) and before `-p`: `--tools` is a list option, so after `-p "<prompt>"` it could swallow text |
| Codex | `--sandbox read-only --ignore-user-config` | Right after `exec`, before `--add-dir`, `--model`, `-c` and the prompt |

What was measured live (Claude Code 2.1.288, Codex 0.159.3, empty working directory, `--add-dir` as Workers uses it):

- **Claude Code without the option** has every MCP server of the user, including `forge614-engram` with `memory_save` already approved. **With it**, in `-p` mode (prompt in the arguments or read from stdin) the helper reads the file, cannot write (`Write` is disabled) and its only tools are `Glob`, `Grep` and `Read`, with no MCP at all. `--tools` leaves only those three tools, `--permission-mode dontAsk` denies what is not allowed instead of asking, and `--strict-mcp-config` loads only the MCP servers given with `--mcp-config` (none).
- **Codex** `exec` with and without `--sandbox read-only` could not write into the `--add-dir` folder ("operation not permitted"): the default sandbox of `exec` is read-only, even though `codex exec --help` calls `--add-dir` writable. Asking for the sandbox explicitly means the protection no longer depends on that default. With `--sandbox read-only` but with its `config.toml` loaded, the helper called `memory_context` of `forge614-engram` successfully, so it could also save. `--ignore-user-config` does not load `$CODEX_HOME/config.toml` (authentication still uses `$CODEX_HOME`), and with it that tool does not exist.
- **The whole order, run for real** (2026-10-03): the command that `--read-only` builds could neither write nor call Engram, with Claude Code (`claude-haiku-4-5`) and with Codex (`gpt-5.6-terra`).

An agent that cannot guarantee this declares `supportsReadOnly: false` in `capabilities` (see 02), and `--read-only` answers `READ_ONLY_UNSUPPORTED` with the message `<agent> cannot guarantee read-only execution` instead of building an order without the lock. No real agent triggers it today: both `claude-code` and `codex` report `supportsReadOnly: true`. A caller that needs read-only helpers should read that field first, because an Engines older than this option does not reject unknown flags: it ignores `--read-only` without an error and builds the order without the lock.

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

Workers never write directly to Engram; `--read-only` lets the caller enforce that when the order is built. Atlas does not reimplement detection. This division prevents different answers to the same question: “which agent is available?”.

## Relationship with Shell

Shell consumes `detect`, `capabilities`, plans, and `apply` for its visual flow. It may show a proposal, but it must not read `src/` or the plan directory directly. Engines does not show progress or ask for confirmation; those jobs belong to Shell.

## Adding a future agent

A new adapter declares an identifier, executable names, known locations, configuration file and format, MCP shape, capabilities, and, optionally, its tool-approval target (`toolApproval`). If it marks `supportsHeadlessExec: true`, it must provide a function that builds the command. It also declares `supportsReasoningLevel` to indicate whether it accepts `HeadlessOptions.reasoningLevel` (the `--reasoning-level` flag) and, when it does, the levels it accepts in `reasoningLevels` (a non-empty subset of the five; required when `supportsReasoningLevel` is `true` and absent otherwise). `headlessCommandFor()` uses them to return `REASONING_LEVEL_UNSUPPORTED` when the agent cannot choose a level and `INVALID_REASONING_LEVEL` when the value is not on its list. It also declares `supportsReadOnly` to indicate whether it can guarantee `HeadlessOptions.readOnly` (the `--read-only` flag): an adapter that cannot must declare `false`, and `headlessCommandFor()` then returns `READ_ONLY_UNSUPPORTED` before calling it; one that declares `true` must build a command that cannot write or reach the user's MCP servers. Registry tests reject an incomplete capability promise, and also an adapter that declares `supportsReadOnly: true` without `supportsHeadlessExec: true`.
