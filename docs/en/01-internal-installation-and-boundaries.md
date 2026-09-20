# 01. Internal installation and boundaries

## The analogy: a tool inside a toolbox

Engines is a specialized wrench inside the Forge614 toolbox. It works for other products, but it is not the whole toolbox or the workbench where a person works. That separation prevents two products from trying to control the same configuration.

## Ownership and location

Each Forge614 product owns only its own subdirectory:

```text
~/.forge614/
├─ shell/
├─ engines/
├─ engram/
└─ atlas/
```

Shell automatically installs and validates Engines when required. On macOS and Linux the expected binary is `~/.forge614/engines/bin/forge614-engines`; on Windows it ends in `.exe`. The installer does not change terminal profiles or add Engines to PATH.

`FORGE614_HOME` can change the shared home for controlled tests. It is not a way to share or delete the folders owned by other products.

## Exact responsibility

Engines detects agents, knows their configuration-file locations, reports capabilities, prepares MCP change previews, and applies only a named plan already confirmed by its consumer. Atlas also uses the headless-execution contract to decide which agents can start without a visible conversation.

Shell is the sole Forge614 product that presents questions, progress, warnings, and confirmations. Engram stores memory; Atlas analyzes repositories. Engines does not duplicate any of those jobs.

## Safety boundaries

A plan stores a SHA-256 fingerprint (a digital signature of the earlier content) before proposing a change. If the file changes afterward, Engines rejects application. Its plans and backups live under `~/.forge614/engines/` with owner-only permissions where the system supports them.

It does not delete the shared `~/.forge614/` directory, touch Shell, Engram, or Atlas-owned files, or remove an MCP entry unless it exactly matches what Engines would have installed.

## Practical decision

If a screen must ask “do you want to apply this change?”, that belongs to Shell. If a product needs to know “which agents exist and how can their connection change?”, that belongs to Engines.
