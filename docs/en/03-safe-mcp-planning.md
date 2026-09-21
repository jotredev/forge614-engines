# 03. Safe MCP planning

## The analogy: a quote before a repair

Before a mechanic touches a wire, they provide a quote: which part would change, how it changes, and whether no work is needed. `plan mcp-install` and `plan mcp-remove` do exactly that. They read, compare, and store a proposal; they do not edit the agent file yet.

## Proposing an installation

```text
forge614-engines plan mcp-install --agent codex --name engram --command forge614-engram --args mcp
```

The plan describes `planId`, `agentId`, `action`, `noop`, and `writes`. `planId` is the unique receipt used for later application; `writes` contains the path, the earlier-content fingerprint, and the complete proposed content. The plan file can therefore contain secrets already present in configuration and is kept with restricted access.

Claude Code and Cursor use JSON (a brace-based text format); Codex uses TOML (a section-based text format). Engines places the entry under `mcpServers` for JSON or `mcp_servers` for TOML. An entry always has `command` and `args`.

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

`plan memory-install` and `plan memory-remove` bundle two decisions — the `forge614-engram` MCP entry and the agent's instructions file(s) — into one plan, with one `planId` that covers both. A per-component conflict does not abort that plan: a different `forge614-engram` MCP entry, or a non-empty `AGENTS.override.md` shadowing Codex's `AGENTS.md`, is reported as `blocked` for that one component while the other component still proceeds normally. Cursor's instructions component is always reported `unsupported`, because Cursor has no officially documented global, file-based mechanism for loading instructions automatically in every new session.

## Resolving Engram without PATH

Forge614 Shell installs the MCP with the canonical public binary path under `~/.forge614/engram/bin/forge614-engram`. Engines resolves that same path directly: it uses `FORGE614_HOME` when the environment variable is set, otherwise it uses the user's home directory plus `.forge614`; on Windows the executable ends in `.exe`. This resolution is used for the MCP entry and for `forge614-engram memory-protocol --json`, so a valid Shell installation is recognized as the same entry and `plan memory-install` can return `noop` instead of a false `CONFLICT`.

The resolver builds only the public executable path. It does not read Engram's `.env`, SQLite, memory, or source files, and it does not depend on `PATH`. An entry named `forge614-engram` with a different command is still a real conflict and remains blocked; Engines never overwrites it silently.

## Correct cycle

1. Shell requests the plan.
2. Shell shows the preview to a person.
3. The person confirms or cancels.
4. Only after confirmation does Shell request `apply` with the `planId`.

Do not treat a plan as automatic permission. It is a quote, not a work order.
