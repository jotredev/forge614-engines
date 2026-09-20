# Forge614 Engines Documentation Design

## Purpose

Create the first maintained product documentation for `forge614-engines`. It must explain the product to readers without assuming software expertise, while remaining accurate enough for the Forge614 products that consume its public command-line contract.

The documentation will exist in two coordinated locations:

1. This repository, as versioned Markdown documents.
2. Notion, under `AI Engineer / Librerías`, as the same navigable, bilingual structure.

The scope is exclusively `forge614-engines`. Existing documentation for Forge614 Shell, Engram, and Atlas is reference context only and will not be rewritten.

## Readers and writing standard

The material serves two audiences at once:

- A person learning what Forge614 Engines does and why it exists.
- A Forge614 maintainer or consumer that needs the exact supported commands, outputs, boundaries, and safety guarantees.

Every specialised term must be explained immediately in parentheses in plain language, or introduced with a familiar analogy before its technical name is used. For example, “MCP (a standard way for an AI tool to connect to another tool)” and “hash (a short digital fingerprint used to notice changes).” Each major document opens with an everyday analogy when one makes the concept clearer.

Examples must be executable commands or valid JSON from the current public CLI. They must never imply that people should manually install Engines or bypass Forge614 Shell's confirmation flow.

## Local structure

`docs/README.md` is the bilingual master index. It links to paired pages in `docs/es/` and `docs/en/`. A pair has the same two-digit number and covers exactly the same subject in each language.

| No. | Spanish | English | Purpose |
| --- | --- | --- | --- |
| 00 | `00-resumen-y-guia-rapida.md` | `00-summary-and-quickstart.md` | Product purpose, ecosystem position, analogy, reader route, and status. |
| 01 | `01-instalacion-interna-y-limites.md` | `01-internal-installation-and-boundaries.md` | Internal installation, ownership, and what Engines deliberately does not do. |
| 02 | `02-deteccion-de-agentes-y-capacidades.md` | `02-agent-detection-and-capabilities.md` | Detection of Claude Code, Codex, and Cursor, plus capability reports. |
| 03 | `03-plan-seguro-de-mcp.md` | `03-safe-mcp-planning.md` | Read-only MCP change plans, no-op results, and conflict handling. |
| 04 | `04-aplicacion-segura-y-recuperacion.md` | `04-safe-application-and-recovery.md` | Confirmed application, snapshots, atomic writes, and stale-plan protection. |
| 05 | `05-referencia-del-cli-publico.md` | `05-public-cli-reference.md` | All public commands, JSON output, schema version, and error codes. |
| 06 | `06-ejecucion-automatica-e-integraciones.md` | `06-headless-execution-and-integrations.md` | Non-interactive launch commands for Atlas and integration boundaries. |
| 07 | `07-arquitectura-y-mapa-del-codigo.md` | `07-architecture-and-code-map.md` | Layered code map, adapters, configuration formats, tests, and maintenance rules. |

The existing root `README.md` remains a short project entry point and will link to `docs/README.md`; detailed material will not be duplicated there.

## Notion structure

Under `AI Engineer / Librerías`, create one bilingual hub named `Forge614 Engines — Detección y Adaptadores Seguros de IA`. The hub contains the concise problem statement, master analogy, ecosystem boundary, and a bilingual index. It links to fourteen child pages: one Spanish and one English page for each local numbered pair.

The Notion hub is intentionally a navigation page, not a duplicate manual. Each child page holds the detailed explanation corresponding to its local Markdown counterpart. Titles remain clean, without coloured headings or coloured backgrounds. Colour, if used at all, is reserved for an isolated critical cost or warning.

## Synchronization and source of truth

The repository documents are the reviewable source of truth. Notion is a published mirror with the same sequence, topics, and examples.

`docs/notion-map.json` records each local document, its corresponding Notion URL, the product version it was verified against, and a content fingerprint. A small documentation verification script will check that:

- every index entry has both languages;
- every local pair has a mapped Notion destination;
- mapped document fingerprints match the local source at the time of publication;
- documented CLI commands and error codes are present in the current CLI source.

When code changes a public behavior, maintainers update the relevant local pair, update the matching Notion page, refresh the map, and run the verification script. This prevents “synchronized” from being merely a promise.

## Copied Codex skill

Create a personal Codex skill named `ai-engineer-docs` in `~/.codex/skills/ai-engineer-docs/`. It adapts Antigravity's official `ai-engineer-docs` protocol without copying tool names that are unavailable in Codex. It preserves the substantive rules: repository-first research, pre-edit Notion verification, hub-versus-detail separation, bilingual numeric indexing, plain-language definitions, master analogy, production-valid examples, print-safe formatting, and post-publication verification.

The skill will be specific to documenting AI libraries, tools, agents, and architectures in the user's `AI Engineer` Notion area. It will not impose the Forge614 document names on unrelated projects.

## Verification

Before handoff:

1. Run the documentation verifier and the project test suite.
2. Fetch the Notion hub and representative child pages after publishing to confirm hierarchy, links, and non-duplication.
3. Compare every documented command, agent, capability, configuration location, and error code against the code at the released product version.
4. Run the Codex skill validator after creating the personal skill.

## Non-goals

- No changes to runtime product behavior.
- No direct user installation flow for Engines.
- No user interface, interactive setup, or automatic configuration without an already-confirmed plan.
- No edits to the documentation of Shell, Engram, Atlas, or the ecosystem contract unless a product decision itself changes.
