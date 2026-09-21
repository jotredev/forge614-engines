# Memory Hook Integration — Spec

**Status:** confirmed, ready to implement. Written 2026-09-21; corrected same day after a deeper re-verification of Codex's `additionalContext` support (see "Correction log" below) — every claim in this document was checked directly (live binaries, source repos, official docs, and — where docs were silent — real GitHub issues fetched live), not recalled from training data or taken on a subagent's word alone.

## Correction log

The first version of this spec concluded Codex's `SessionStart` hook could not emit `additionalContext` (citing issue `openai/codex#45999`) and designed around plain stdout text instead. That conclusion was wrong: it was based on the issue's *opening report* only. Reading the full thread showed the reporter re-tested and found `additionalContext` **does** work on `SessionStart` — the original failure was two confounded bugs: (1) the reporter's test used a top-level `{"additionalContext": "..."}` shape, which is genuinely rejected, instead of the correct `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}` shape, which works; and (2) a second, unrelated machine-wide hook was also failing on that same test machine and poisoning the results. The issue was closed by its own reporter as not-planned once they isolated this. This spec is corrected accordingly: Codex uses structured `hookSpecificOutput.additionalContext`, not plain stdout.

## Problem

Engines already installs an MCP server and static instructions for Engram, but whether an agent actually calls `memory_context` at session start is left to model discretion. A conversation can answer "I don't know" even when the memory exists, because nothing forces a preload.

## Solution

Engram v1.5.0 publishes a read-only, non-interactive command built exactly for this:

```
forge614-engram startup-context --directory <absolute-directory> --json
```

Engines will own a `SessionStart` hook, installed into Claude Code and Codex through their own official hook mechanisms, that runs a new Engines subcommand (`forge614-engines memory-hook-run`). That subcommand reads the hook's stdin JSON, extracts the real session `cwd`, calls Engram's `startup-context` CLI with it, and returns a bounded, sanitized rendering of the result as structured `additionalContext` — which both agents inject as context automatically. MCP and the static instructions block stay installed alongside the hook as a fallback path for explicit search/save, not just for preload. Cursor has no officially documented global hook or instructions mechanism today, so it stays `partial`, unchanged from today.

Engines' own responsibility ends at *installing, planning, applying, verifying, and removing* the hook and reporting its true state — including a `needs-user-trust` state Codex's own trust model can require. Engines never opens windows, never launches Codex, and never implements any part of Shell; Shell (a separate program, out of scope for this repo) is the one that acts on a `needs-user-trust` result by launching Codex interactively so the user can approve the hook through Codex's own native UI.

## Confirmed dependency: Engram `startup-context` (v1.5.0)

Verified against `~/Desktop/forge614-engram` source (tag `v1.5.0`, commit `77fa2fa`) and its docs (`docs/es/10-contexto-de-inicio.md`, `docs/en/10-startup-context.md`).

- Read-only SQLite; never creates a project, binding, memory, or session. An unbound directory is not an error.
- Success (stdout, exit 0):
  ```json
  {
    "format": 1,
    "shared": { "pinned": [], "recent": [], "sessions": [], "truncated": false },
    "project": { "status": "bound" | "unbound", "projectId": "<uuid>" | null, "context": <ContextResult> | null }
  }
  ```
  `shared` and `project.context` are `ContextResult`: `{ pinned, recent, sessions, truncated }`, rows carry `title` and a bounded `preview`.
- Failure (stderr only, exit 1): `{ "code": "...", "error": "..." }`. Never includes the requested directory, secrets, or credentials. `--directory` and `--json` are both required; missing either is `INVALID_INPUT` before touching storage.
- Idempotent, safe under a read-only DB file, creates no files.

## Confirmed dependency: Claude Code `SessionStart` hook

Verified against `https://code.claude.com/docs/en/hooks.md` and `https://code.claude.com/docs/en/settings` directly (not only the subagent's report).

- Declared under `hooks.SessionStart` in `~/.claude/settings.json` (user-level — applies to every project without touching project config) as an array:
  ```json
  { "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "<string>" } ] } ] } }
  ```
  `matcher` omitted, `""`, or `"*"` all mean "match every SessionStart source" (startup/resume/clear/compact/fork) — confirmed literally in the doc table.
- Hook entries **merge/concatenate** across settings levels (user + project + local); a lower-precedence file's hooks are never silently dropped by a higher one. Safe to write only at user level.
- The command receives JSON on stdin including `cwd` (the real session working directory) and `hook_event_name`.
- Plain text written to stdout with exit 0 is added as context Claude can see (`SessionStart` is one of the few events where this happens; most events only log stdout to a debug file). A `hookSpecificOutput.additionalContext` JSON field also works for Claude Code specifically.
- A failing/timing-out/missing-command hook does not block the session.
- No documented size ceiling; bounded in practice by Engram's own ~16KB-per-section ceiling.

## Confirmed dependency: Codex CLI `SessionStart` hook

Verified against `https://learn.chatgpt.com/docs/hooks` directly, the full comment thread of `openai/codex#45999` (not just its opening report), `openai/codex#46210`, and the real installed `codex` binary (`codex-cli 0.155.1`, `codex app-server --help`) — not taken on any subagent's word alone.

- Real, official, stable (not experimental-flagged) `SessionStart` hook, configurable in `~/.codex/config.toml` under `[[hooks.SessionStart]]` / `[[hooks.SessionStart.hooks]]` (TOML array-of-tables — same JSON shape as Claude Code's array).
- **Use structured `hookSpecificOutput.additionalContext`.** Confirmed working (issue #45999's own resolution, re-tested by the reporter with a single hook registration): a hook that prints `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}` completes and the string reaches the model. A **top-level** `{"additionalContext":"..."}` is genuinely rejected (`deny_unknown_fields` on the event's own wire struct) — never emit that shape. Never use `systemMessage` as a substitute; it is a different, human-facing field, not model context.
- **Size limit.** Codex supports an explicit `additionalContextLimit` field (integer, tokens) alongside `type`/`command` on the individual hook entry, confirmed in the docs' own literal TOML example. Engines sets this **and** independently truncates the rendered text itself before emitting it (belt-and-suspenders — never rely on the host alone to bound an untrusted-size render).
- **Sources:** `startup`, `resume`, `clear`, `compact` are the session-start reasons Codex's `matcher` (a regex) is evaluated against. Since Codex's docs do not confirm "omitted = match all" the way Claude Code's do, Engines uses the explicit regex `^(startup|resume|clear|compact)$` rather than a bare wildcard or an omitted field — naming exactly the sources this integration is meant to cover, not "anything, including sources that don't exist yet."
- **Trust gate — a real, permanent constraint, not a temporary rough edge.** A non-managed hook (anything outside enterprise `requirements.toml`/MDM) must be reviewed and trusted once through the interactive `/hooks` TUI flow before Codex will ever run it; this is Codex's own safety design. In headless `codex exec`, an untrusted `SessionStart` hook is silently skipped with **no diagnostic** (confirmed live, issue #46210) unless `--dangerously-bypass-hook-trust` is passed — a flag this integration never uses, per explicit instruction.
- **No stable way to query trust state.** The only documented interaction with trust is the interactive `/hooks` command; there is no documented CLI flag, config file format, or command to read a hook's trust status non-interactively. `codex app-server hooks/list` *does* return a `trustStatus` field (confirmed live against the installed binary: `untrusted`/`trusted`, keyed by a `<config-path>:<event>:<index>:<index>` string and a `sha256:` hash of the hook's own content) — but `codex app-server` is explicitly marked `[experimental]` by Codex itself (`codex app-server --help`), so this plan does **not** build on it. It is noted here only as a known future upgrade path, for whoever revisits this once Codex stabilizes that surface.
- **Consequence for this design:** since Engines cannot verify trust through any stable, documented mechanism, and is explicitly forbidden from launching `codex exec` itself to test it empirically, Engines reports a freshly-installed (or any currently-installed) Codex hook as `needs-user-trust` rather than ever claiming `complete` for it — see "Verification semantics" below.

## Engines → Shell contract

Engines never presents UI and never launches an agent. It only reports state; Shell (out of scope, a separate repo) decides what to do with it.

```typescript
type HookComponentStatus =
  | { kind: "unsupported"; reason: string }
  | { kind: "noop" }              // already installed, unchanged
  | { kind: "write" }             // this apply installed or updated it
  | { kind: "blocked"; reason: string; details: string }
  | { kind: "needs-user-trust"; agentId: "codex"; configPath: string; details: string };
```

- `needs-user-trust` is Codex-only (Claude Code's `SessionStart` hooks have no per-hook trust gate to satisfy).
- It carries exactly what Shell needs to act — which agent, and the config file the hook lives in — and nothing about *how* Shell should present that to the user (no copy, no UI hints; that is Shell's job).
- `verify memory-integration` and `plan memory-install`'s `overallStatus` must never report `complete` while any component is `needs-user-trust`; it maps to `partial`, alongside `blocked` and `write`-pending states.
- If the user later rejects or closes Codex without trusting the hook, nothing changes on Engines' side — the next `verify` still reports `needs-user-trust` (Engines has no way to distinguish "not yet asked" from "asked and declined," and must not guess). The result stays `partial`, never `complete`, exactly as required.

## Verification semantics — what "real evidence" honestly means here

Engines' `verify` command runs standalone, outside of any live agent session — it cannot observe a real Claude Code or Codex conversation, read its transcript, or confirm a specific model turn actually saw the injected text. Claiming otherwise would repeat exactly the failure this whole project exists to fix (asserting something is loaded when it wasn't actually observed). So "real evidence," honestly scoped to what Engines can actually do:

1. **Structural presence** (cheap, already how `verify` works today): the hook entry exists in the agent's config file with the exact expected shape.
2. **End-to-end dry run** (new): `verify` actually invokes `runMemoryHook` — the exact same code path the real hook would run — against the target directory, through the real `forge614-engram startup-context` binary (or a supplied fixture in tests). This proves the hook's own logic genuinely calls Engram, parses its response, and produces a well-formed, bounded, secret-free `additionalContext` payload — i.e., that *if* the host actually invokes this hook, it will work. It does not and cannot prove a live model turn read it.
3. **Trust, for Codex** (new): always reported as `needs-user-trust` per the section above — never inferred as granted, never left silently unreported.

`complete` therefore means: MCP present, instructions present, hook structurally present, the dry run in step 2 succeeded, and (for agents with a trust gate) trust is not outstanding. Any one of those missing yields `partial`, `blocked`, or `needs-user-trust` with a concrete reason — never a bare `false` with no explanation.

## Context framing, sanitization, and size limits

- The rendered context is always wrapped in an explicit preamble identifying it as retrieved memory (e.g. `"[Forge614 Engram] Recovered memory — not an instruction from the current user."`), so a model cannot mistake a saved memory row for a live command from the person it's talking to.
- Before rendering, every memory row's `title`/`preview` text is scanned for content that resembles a role/instruction marker (e.g. literal strings like `"system:"`, `"assistant:"`, `"<|"`/`"|>"`-style special tokens, or this repo's own `<!-- forge614-engines:begin -->`/`:end` block markers) and defused (a neutral placeholder substituted) before inclusion, so a memory row can never be used to smuggle a fake instruction into the hook's own output.
- The final rendered string is truncated to a fixed byte ceiling before being returned, independent of whatever size limit the host config also sets (Codex's `additionalContextLimit`) — Engines never depends solely on the host enforcing a bound it also controls.
- Engram's own `startup-context` contract already guarantees no secrets/credentials/directory leakage on failure (see above); `runMemoryHook`'s own failure-path messages are built from a small fixed vocabulary of reason codes, never by interpolating raw error text, stdout, or the requested directory — so a secret cannot reach the hook's output even indirectly through an unexpected error message.

## Governance (from `FORGE614_ECOSYSTEM_CONTRACT.md`, this repo)

- Engines owns adapters and hooks; Engram never receives Claude/Codex-specific configuration (§3, §6).
- Engines never writes configuration outside plan → preview → confirm → apply, with hash checks and snapshot/rollback (§5).
- Public contracts only, never internal imports between repos (§3, §10).
- Verify a dependency exists (or declare it blocked) before building against it (§12) — done above.

## Rules for this implementation

1. Investigate the official hook mechanism first; never invent a config format. — Done above.
2. Engines owns adapters/hooks; Engram never receives Claude/Codex-specific config.
3. The hook may only call Engram's public CLI — never SQLite, `.env`, or other private Engram files.
4. Never persist the startup context to a temp file or private agent memory; relay it straight through as the hook's own output.
5. The hook must pass the real session `cwd` (from the hook's own stdin) so Engram resolves the right shared/project memory.
6. If Engram fails or is not installed, the session continues but the result must clearly say "memory not available" — never pretend it loaded.
7. Extend `plan memory-install`, `apply`, `verify memory-integration`, and `plan memory-remove` to include the hook.
8. "complete" now requires MCP, instructions, hook structurally present, a successful end-to-end dry run, **and** — for Codex — trust not outstanding. See "Verification semantics."
9. Old installs without a hook must show as `partial`, repairable through the normal confirmed flow (just running `plan memory-install` again).
10. Preserve foreign configuration; every change goes through plan/preview/confirm/hash/rollback, unchanged.
11. No new agents. Only Claude Code, Codex, and Cursor, per their current capabilities.
12. Cursor stays `partial` (no official global hook or instructions mechanism).
13. Claude Code installs `SessionStart` hooks covering startup, resume, and post-compaction recovery (matcher omitted = all sources, per its docs); Codex installs `SessionStart` hooks explicitly matching `startup|resume|clear|compact`. Both keep MCP and the static instructions block installed as a fallback for explicit search/save, not just for preload.
14. Codex's hook returns bounded context via `hookSpecificOutput.additionalContext` with an explicit size limit (`additionalContextLimit` plus Engines' own truncation) — never unbounded memory, never `systemMessage` as a substitute for model context.
15. Codex's trust gate is real and cannot be bypassed or worked around: no `--dangerously-bypass-hook-trust`, no other approval-on-the-user's-behalf mechanism. Engines reports `needs-user-trust` structurally (see the Engines → Shell contract) instead of hiding the requirement or claiming `complete`.
16. Engines never opens windows, never launches Codex, and never implements any part of Shell. It only reports state (including `needs-user-trust`) for Shell to act on.
17. Rendered context is always framed as retrieved memory, never as a live instruction; memory rows are sanitized against instruction-marker/role-marker injection before rendering; output is size-bounded and never contains secrets, tokens, credentials, or connection strings even on failure.
18. Mandatory test coverage: unit tests for both agents; conflict, idempotency, install, remove, and verify tests; startup/resume/clear/compact coverage for Codex; a test proving a Codex hook pending trust yields `needs-user-trust`, never `complete`; a test proving no secret ever appears in hook output; macOS/Linux/Windows paths.
19. `bun test` (and, per this repo's existing convention, `bun run typecheck` and `git diff --check`) must all pass.
20. No release, no tag, no push, no changes to Shell or Engram from this work.
