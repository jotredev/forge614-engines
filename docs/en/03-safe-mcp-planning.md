# 03. Safe MCP planning

## The analogy: a quote before a repair

Before a mechanic touches a wire, they provide a quote: which part would change, how it changes, and whether no work is needed. `plan mcp-install` and `plan mcp-remove` do exactly that. They read, compare, and store a proposal; they do not edit the agent file yet.

## Proposing an installation

```text
forge614-engines plan mcp-install --agent codex --name engram --command forge614-engram --args mcp
```

The plan describes `planId`, `agentId`, `action`, `noop`, and `writes`. `planId` is the unique receipt used for later application; `writes` contains the path, the earlier-content fingerprint, and the complete proposed content. The plan file can therefore contain secrets already present in configuration and is kept with restricted access.

Claude Code uses JSON (a brace-based text format); Codex uses TOML (a section-based text format). Engines places the entry under `mcpServers` for JSON or `mcp_servers` for TOML. An entry always has `command` and `args`.

## Three possible outcomes

1. **Write:** no entry exists with that name; the plan includes a change.
2. **No change (`noop`):** the exact same entry already exists; applying it touches no files.
3. **Conflict:** the name exists with different content. Engines returns `CONFLICT` and refuses to guess which version should survive.

## Removing carefully

```text
forge614-engines plan mcp-remove --agent codex --name engram --command forge614-engram --args mcp
```

When the entry does not exist, the plan is `noop`. When it exists but does not exactly match the expected command and arguments, it returns `UNRECOGNIZED_ENTRY`. That protects configuration created manually or by another application.

## Planning the memory integration

```text
forge614-engines plan memory-install --agent codex
forge614-engines plan memory-remove --agent codex
```

`plan memory-install` and `plan memory-remove` bundle the decisions — the `forge614-engram` MCP entry, the agent's instructions file(s), the session-start hook (chapter 05) and the approval of the Engram tools (next section) — into one plan, with one `planId` that covers all of them. A per-component conflict does not abort that plan: a different `forge614-engram` MCP entry, or a non-empty `AGENTS.override.md` shadowing Codex's `AGENTS.md`, is reported as `blocked` for that one component while the other component still proceeds normally. A component the agent has no way to receive is reported `unsupported` for that agent.

**The manual that gets installed.** Engines asks Engram for the manual with `forge614-engram memory-protocol --json --protocol-version 4` (the "v4 manual"). Only if Engram answers with the INVALID_INPUT error — the sign of an Engram older than 1.7.0, which does not know that option — does Engines repeat the call it has always made (protocol v1) and add a Spanish-and-English notice to the plan (`metadata.protocol.legacyNotice`) asking to upgrade Engram. Any other error is reported as before, with no retry. With v4, the `instructions` text Engram delivers is installed as-is, with no heading or anything else added by Engines.

**Where it lives.** The manual is embedded inside each agent's main file, between the markers Engines manages (Claude Code: `~/.claude/CLAUDE.md`; Codex: `~/.codex/AGENTS.md`). Inside the markers comes first Engines' own mark line (`<!-- Managed by Forge614 Engines. … -->`, which proves the block is theirs) and then `instructions`, identical to Engram's. Claude Code no longer uses a separate file.

**Migrating from the previous version.** If the block already installed is not the manual but an `@file` reference (Claude Code's old form, which pointed at a separate file), `plan memory-install` replaces it with the embedded manual. That separate file is deleted only if it starts with Engines' mark; if it does not (for example, someone else wrote or edited it), it is left where it is and the plan says so in `metadata.instructions.status.notice`. `plan memory-remove` applies the same rule when it removes the block.

## Approving the Engram tools

**Why it exists.** Some permission modes cannot ask the person anything: Claude Code in `dontAsk` mode denies every tool that is not in `permissions.allow`, and Codex with `approval_policy = "never"` denies an MCP tool that asks for approval. Without an approval, Engram's memory fails exactly in those modes (`memory_session_start` comes back as "Failed"). So `plan memory-install` also approves the tools of the `forge614-engram` server for good, in every permission mode.

**What gets written.**

| Agent | File | What |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` (the same file as the hook) | the rule `mcp__forge614-engram` appended at the **end** of `permissions.allow` |
| Codex | `~/.codex/config.toml` (the same file as the MCP entry and the hook) | `default_tools_approval_mode = "approve"` inside `[mcp_servers.forge614-engram]` |

In Claude Code the rule is inserted without rewriting the array: the other rules keep their order, their text and the comments around them, and no other key is touched. If `permissions` or `allow` do not exist they are created. It is a `noop` when `mcp__forge614-engram` or `mcp__forge614-engram__*` is already in `allow` and no `deny` or `ask` rule of that file covers Engram; if one does, the plan still writes, to remove it. If `allow` exists but is not an array, only the approval component is `blocked` (`allow-not-array`) and the rest of the plan proceeds. When the file also receives the hook (or, in Codex, the MCP entry and the hook), everything goes into one single write to that file. An existing `forge614-engram` MCP entry with different content is never approved (`mcp-conflict`).

For Codex, the MCP entry that carries `default_tools_approval_mode` is still recognized as Engines' own: that key is ignored when the entry is compared, so it is neither a `CONFLICT` nor unrecognized and `verify` still finds the MCP present. Any other difference is still a conflict.

**What it changes from what the person had.** Claude Code evaluates deny rules first, then ask, then allow, and the first match wins, so an allow rule cannot open an exception inside a deny. For that reason, if `permissions.deny` or `permissions.ask` **of that same file** contain rules that cover Engram (`mcp__forge614-engram`, `mcp__forge614-engram__*` or `mcp__forge614-engram__<tool>`), the plan removes exactly those rules (by position, leaving the others) and says so. In Codex, if `default_tools_approval_mode` already held another value (`prompt`, `writes` or `auto`), the plan changes it to `approve` and says so. Both are reported in `metadata.approval.status.notice`, naming what was changed and how to turn it off. Adding the rule when there was nothing to change carries no notice.

**How to turn it off.** The approval is part of Engram's memory: it is removed by uninstalling the memory with `plan memory-remove --agent <id>` and then `apply`. That removes every `permissions.allow` rule that is `mcp__forge614-engram`, `mcp__forge614-engram__*` or `mcp__forge614-engram__<tool>` (only those; if `allow` ends up empty it stays empty), and in Codex the key leaves together with the MCP entry. If `permissions.allow` exists but is not an array, removing the approval is `blocked` (`allow-not-array`) and the rest of the removal proceeds. Deny and ask rules removed at install time are not put back.

**Limitation.** Engines only reads and writes the user-level file (`~/.claude/settings.json`, `~/.codex/config.toml`). Claude Code settings at project level or managed by an administrator are not touched and can still win over this approval.

## Repairing an existing MCP conflict

```text
forge614-engines plan mcp-repair --agent codex
```

`plan mcp-repair` classifies the `forge614-engram` entry into one of four
states: `not-installed` (no entry exists), `already-correct` (it already
matches the canonical entry, nothing to do), `repairable-conflict` (it
exists with different content and the file can be written), or `blocked`
(the file is broken — `blockedReason: "unparsable-config"` — or cannot be
written — `blockedReason: "not-writable"`). The plan carries
`repair.existing`: a preview of the conflicting entry where only `command`
and `args` are echoed verbatim; every other key (for example an `env`
block holding another tool's credentials) appears as `"<redacted>"`. Shell
should display `plan.repair`, not `plan.writes[].afterContent` (that field
is internal plumbing with the complete file, same as in any other plan,
and is kept with restricted access).

## Resolving Engram without PATH

Forge614 Shell installs the MCP with the canonical public binary path under `~/.forge614/engram/bin/forge614-engram`. Engines resolves that same path directly: it uses `FORGE614_HOME` when the environment variable is set, otherwise it uses the user's home directory plus `.forge614`; on Windows the executable ends in `.exe`. This resolution is used for the MCP entry and for `forge614-engram memory-protocol --json`, so a valid Shell installation is recognized as the same entry and `plan memory-install` can return `noop` instead of a false `CONFLICT`.

The resolver builds only the public executable path. It does not read Engram's `.env`, SQLite, memory, or source files, and it does not depend on `PATH`. An entry named `forge614-engram` with a different command is still a real conflict and remains blocked; Engines never overwrites it silently.

## Correct cycle

1. Shell requests the plan.
2. Shell shows the preview to a person.
3. The person confirms or cancels.
4. Only after confirmation does Shell request `apply` with the `planId`.

Do not treat a plan as automatic permission. It is a quote, not a work order.
