# 00. Forge614 Engines: summary and quickstart

## The analogy: the workshop inspector

Imagine a workshop with several AI machines. Forge614 Engines is the inspector that checks which machines are actually available, where they keep their settings, and what work they can do. It does not make the owner's choices or alter a machine unexpectedly: it prepares a clear sheet for Forge614 Shell to show and for a person to approve.

## What it solves

AI coding agents are not installed or configured in the same way. Engines unifies three questions: “is it installed?”, “where is its configuration?”, and “can it connect to an MCP server or work without a screen?”. MCP (a protocol, or shared way, for connecting an AI to another tool) can add services such as memory, search, or data.

It currently recognizes Claude Code, Codex, and Cursor. It returns JSON (structured text that programs can read) with `schemaVersion: 1`, so Shell and Atlas can understand the result without reading another product's private folders.

## Quick route

Engines is an internal dependency. Shell installs it under `~/.forge614/engines/`; it is not added to PATH (the list of command names a terminal can find). Consumer products call its binary through the known path:

```text
~/.forge614/engines/bin/forge614-engines detect
```

The result describes each agent: its identifier, visible label, whether an executable was found, and whether its settings folder exists. The normal next step is Shell: it shows the choices, prepares a change, and asks for confirmation.

## What it does not do

- It does not offer a visual interface or chat.
- It is not directly installed by an end user.
- It does not choose an MCP server.
- It does not write configuration while calculating a plan.
- It does not replace the native credentials or profiles of Claude Code, Codex, or Cursor.

## Continue reading

Read [01](01-internal-installation-and-boundaries.md) for boundaries, [02](02-agent-detection-and-capabilities.md) for detection, and [05](05-public-cli-reference.md) for the complete command-line contracts.
