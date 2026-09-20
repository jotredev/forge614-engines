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

## Correct cycle

1. Shell requests the plan.
2. Shell shows the preview to a person.
3. The person confirms or cancels.
4. Only after confirmation does Shell request `apply` with the `planId`.

Do not treat a plan as automatic permission. It is a quote, not a work order.
