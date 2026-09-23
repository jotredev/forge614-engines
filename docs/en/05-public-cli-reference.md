# 05. Public CLI reference

## The analogy: a counter with uniform receipts

The CLI (command-line interface) is the Engines counter. Every request returns a JSON receipt with `schemaVersion: 1`. Products must use that public contract, not import private files from this repository.

## Commands

| Command | Main result | Writes |
| --- | --- | --- |
| `forge614-engines detect` | detected `agents` | No |
| `forge614-engines agents list` | every agent the code supports, installed or not | No |
| `forge614-engines capabilities --agent <id>` | one agent's capabilities | No |
| `forge614-engines plan mcp-install ...` | installation `plan` | Stores the plan only |
| `forge614-engines plan mcp-remove ...` | removal `plan` | Stores the plan only |
| `forge614-engines plan memory-install --agent <id>` | one coherent memory-integration `plan` | Stores the plan only |
| `forge614-engines plan memory-remove --agent <id>` | one coherent memory-integration removal `plan` | Stores the plan only |
| `forge614-engines apply --plan-id <id>` | application `result` | Yes, only for confirmed plan |
| `forge614-engines headless ...` | `headless` command and arguments | No |
| `forge614-engines update` | update `result` | Manages Engines only |
| `forge614-engines verify memory-integration --agent <id>` | current MCP/instructions/hook `verification` | No |
| `forge614-engines memory-hook-run --agent <id>` | plain text (Claude Code) or `hookSpecificOutput.additionalContext` JSON (Codex) on stdout | No |
| `forge614-engines plan mcp-repair --agent <id>` | repair `plan` with status (`not-installed`/`already-correct`/`repairable-conflict`/`blocked`) | Stores the plan only |
| `forge614-engines apply mcp-repair --plan-id <id> [--confirm]` | confirmed application `result` | Yes, and only with `--confirm` |
| `forge614-engines verify mcp-repair --agent <id> --plan-id <id>` | `verification` for that one repair | No |

`--args` consumes values until the next flag beginning with `--`. This keeps MCP-server arguments from accidentally swallowing another Engines option.

## Examples

```text
forge614-engines agents list
forge614-engines capabilities --agent cursor
forge614-engines headless --agent codex --executable codex --prompt "Summarize this repository"
forge614-engines plan mcp-install --agent claude-code --name engram --command forge614-engram --args mcp
```

`agents list` reports the static, built-in agent registry — every agent the code supports, whatever is or is not installed on this machine. `detect` answers a different question: which of those agents are actually present right now.

`headless` output does not run Codex or Claude Code: it produces the safe order that Atlas may decide to start. For Codex the order is `codex exec <prompt>`; for Claude Code it is `claude -p <prompt>`. Optional `--model <model-id>` and `--reasoning-level <low|medium|high>` are additive: each adapter decides how to fold them into its own order, and Claude Code rejects `--reasoning-level` with `REASONING_LEVEL_UNSUPPORTED` (see 06). Optional `--stdin-prompt` moves the prompt out of `args` and into `stdin: true` on the returned command, so it never becomes visible to `ps` on the machine running it (see 06). Optional `--readable-dir <path>` is additive and maps to `--add-dir <path>` on both adapters, granting read access to one real project folder without loosening isolation otherwise (see 06).

`plan memory-install` reads the protocol fresh from `forge614-engram memory-protocol --json` every time, decides the MCP entry and the instructions file(s) for the given agent, and returns one plan that already contains every write `apply` needs — install and remove for the memory integration share the same `apply --plan-id <id>` command as any other plan. `verify memory-integration` does not modify Engram; it inspects the files Engines itself manages and, structurally (never by version), probes `startup-context` from `~` to report in `verification.engram.ecosystemBlock` whether the installed Engram publishes the `ecosystem` block: `published`, `not-published` or `unavailable`. It is informational and never changes `overallStatus`.

For memory commands, Engines resolves `forge614-engram` at the canonical `~/.forge614/engram/bin/forge614-engram` path, or under `FORGE614_HOME` when that variable is set; it does not search `PATH` or read Engram internals. A different command for the same `forge614-engram` MCP name remains a real `CONFLICT`.

## The `SessionStart` hook

As of this version, `plan memory-install` also installs a `SessionStart` hook for Claude Code and Codex, alongside the MCP server and the static instructions — without depending on the model choosing to call `memory_context` on its own. The hook, for both agents, always points at the same fixed command: `forge614-engines memory-hook-run --agent <id>`. That command reads the real session `cwd` from the hook's own stdin, passes it to `forge614-engram startup-context --directory <cwd> --json` (the only Engram command the hook may invoke — never SQLite or private files), and returns the result already sanitized, framed as retrieved memory, and size-bounded. Claude Code gets plain text on stdout; Codex gets `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`, never `systemMessage`. If Engram fails or is not installed, the hook still returns a clear "memory not available" response and the session continues — it never pretends memory loaded.

**The three scopes.** The hook injects, in this order, `shared` memory, the `ecosystem` memory (only when the project belongs to an Engram group, Engram 1.6.0 or later) and the `project` memory. Each block goes through the same sanitization, always framed as retrieved data. Everything the hook injects counts inside the 3,000-token startup budget (act 0020): the total cap is 10,500 characters (≈ 3,000 tokens at characters / 3.5) and includes the preamble, the labels and the notices. A row is painted only once: if Engram also sends a shared memory inside `project.context`, it stays in the section of its own scope (key: its `id`, or the title when it has none). Space is granted by precedence (project, then ecosystem, then shared); each section sheds whole rows from the end and, if it lost any, ends with "[+N recuerdos omitidos; búscalos con la herramienta de búsqueda de memoria]". A row is never cut in half; the paint order does not change (shared, ecosystem, project, notices). An unbound project (`project.status: "unbound"`, as in `~`) is a success: `shared` is injected and the text says the directory is not bound. `project.notices` (for example DATABASE_MIGRATED with the backup path, or PROJECT_REBOUND_FROM_FILE) are shown as informational data, never as instructions. The hook reads Engram's output tolerantly toward unknown fields (strict only about the fields it uses): an `ecosystem` block it does not understand is treated as absent without losing `shared` or `project`, and an Engram older than 1.6.0 behaves as before. If the repository's `.forge614/project.json` is invalid, Engram makes `startup-context` fail (PROJECT_FILE_INVALID) and the hook answers "memory not available" instead of pretending to have context. Group memories are not replicated to PostgreSQL yet (coming with Engram 1.7.0).

**`needs-user-trust`.** Codex requires reviewing and trusting each non-managed hook once, interactively, through its own `/hooks` command, before running it — Engines has no stable, documented way to grant or verify that trust, and never uses `--dangerously-bypass-hook-trust` to skip it. Engines does not open Codex or ask anything: it only reports that state so Shell can decide how to launch it.

**Runtime-observed evidence, not proof the client consumed it.** `plan memory-install`/`apply` install the hook, but neither they nor `verify memory-integration` can observe a real Claude Code or Codex session — Engines has no cryptographic way to confirm who invoked `forge614-engines memory-hook-run`, and no way at all to know whether the host read or used the text that process returned. So the `hook` component is never marked ok just because it is correctly installed, and `overallStatus` never reaches `"complete"` on that basis alone.

Every time `memory-hook-run` receives a payload shaped like a genuine `SessionStart` trigger (`hook_event_name` exactly `"SessionStart"` and a real `cwd` — a bare `cwd` is not enough), it writes minimal evidence to `~/.forge614/engines/hook-evidence/<agent>.json`: the agent, a timestamp, whether Engram returned context, and a non-reversible hash of the hook's own configuration — never memory, `cwd`, secrets, or Engram's output. Both `plan memory-install` and `verify memory-integration` read that same evidence with the same logic; if it is recent (under 7 days — long enough to cover several sessions without demanding constant restarts, short enough that a broken integration stops being reported as ok within days), matches the hook's current configuration, and confirms Engram returned context, the `hook` component becomes `runtime-observed`. Without recent, valid evidence, both return `pending-runtime-verification` with a concrete reason (`no-evidence`, `evidence-expired`, `evidence-corrupt`, `evidence-wrong-agent`, `evidence-fingerprint-mismatch`, or `evidence-context-not-received`), and `overallStatus` stays `"partial"` — never `"complete"` — for either Claude Code or Codex, **including the very first `plan memory-install` of a fresh installation**, before any real session exists yet: a freshly-written, never-executed hook never counts as complete just because it is correctly configured. `verify` additionally runs the hook's own code as a diagnostic (`hook.dryRunOk`), but that never decides whether the component counts as ok: it only proves the code itself works, not that a real client ran it.

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
| `REASONING_LEVEL_UNSUPPORTED` | the agent's headless adapter has no way to select a reasoning level |
| `UNKNOWN_COMMAND` | the word combination is not a public command |
| `UNKNOWN_AGENT` | the identifier is not registered |
| `INTERNAL_ERROR` | an unclassified problem occurred |
| `ENGRAM_PROTOCOL_UNAVAILABLE` | Engram is not installed, the command failed, or its JSON did not match the protocol shape |
| `NOT_REPAIRABLE` | the given `planId` is not a `forge614-engram` repair plan |
| `CONFIRMATION_REQUIRED` | attempted to apply an mcp-repair plan via the generic `apply` command instead of `apply mcp-repair --confirm` |

Do not automate decisions from message prose; use the stable code.
