# 07. Architecture and code map

## The analogy: a reception office with separate areas

The interface receives a request; the coordination area decides the work; specialized tools speak with files and the system; and the basic rules describe what exists. Separating those areas keeps a terminal command from knowing private configuration-file details.

## Layers

| Folder | Responsibility | Examples |
| --- | --- | --- |
| `src/modules/` | stable concepts and rules | `agents/types.ts`, `config-writer/decide.ts` |
| `src/infrastructure/` | operating system, files, and formats | detection, JSON, TOML, plans, and backups |
| `src/app/` | use cases | detection, planning, application, capabilities, update |
| `src/interfaces/cli/` | visible contract | argument parsing and JSON response |

An architecture test checks relative imports. An inner layer cannot import an outer layer: `modules` does not know infrastructure, and infrastructure does not know the CLI interface. This direction keeps decisions reusable and testable.

## Main pieces

- `AgentRegistry` registers adapters and validates their capability promises.
- Adapters in `infrastructure/agents/` translate each agent into paths, formats, and safe orders.
- `detect-agent.ts` combines PATH scanning, known locations, and configuration-directory presence.
- `config-io/` reads and changes JSON/TOML; JSON preserves edits through `jsonc-parser`, while TOML serializes the document again through `smol-toml`.
- `memory-protocol/` defines and validates the Engram protocol shape, resolves the canonical `forge614-engram` executable from `FORGE614_HOME` or `~/.forge614/engram/bin/forge614-engram`, renders the protocol into instructions markdown, and combines the MCP and instructions component statuses into one overall result.
- `instructions-writer/` inserts, extracts, and removes the delimited managed block inside an agent's existing instructions file without disturbing the rest of it.
- `infrastructure/engram/` invokes the canonical absolute `forge614-engram memory-protocol --json` path without relying on `PATH`, validates the response, and returns it together with a content fingerprint; it never reads Engram internals.
- `plan-store.ts` persists proposals with private permissions; `snapshot.ts` backs up files; `atomic-write.ts` performs verified writes.
- `main.ts` accepts only public commands and translates errors into stable codes.

## Tests and maintenance

Tests live beside the unit they protect. `src/smoke.test.ts` checks the complete route; `tests/architecture/` protects the boundaries. Run:

```text
bun test
bun run typecheck
bun run verify:docs
```

When a public contract changes, update the matching ES/EN page, its Notion mirror, `notion-map.json`, and fingerprints. Do not change this documentation to describe future intent as if it were current behavior.
