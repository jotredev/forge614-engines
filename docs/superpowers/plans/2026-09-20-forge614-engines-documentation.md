# Forge614 Engines Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish code-verified bilingual documentation for Forge614 Engines locally and under `AI Engineer / Librerías` in Notion, and add a reusable Codex documentation skill.

**Architecture:** Local Markdown is the source of truth. A JSON map records every ES/EN file, its Notion URL, the reviewed product version, and its SHA-256 fingerprint. A Bun verifier checks index parity, map coverage, fingerprints, and public CLI vocabulary.

**Tech Stack:** Markdown, JSON, TypeScript, Bun, Node.js `crypto`, Notion MCP, Codex personal skills.

**Spec:** `docs/superpowers/specs/2026-09-20-forge614-engines-documentation-design.md`

## Global Constraints

- Document only `forge614-engines`.
- Every ES/EN pair uses the same stable number from `00` through `07`.
- Explain each specialised term immediately in parentheses or with an everyday analogy.
- Engines remains an internal, nonvisual dependency that does not write configuration before a caller confirms a plan.
- Notion mirrors the local documents; its hub is an index, not a duplicate manual.
- Commands and error codes must match current CLI source.
- No coloured headings or backgrounds in Notion.

## Review Focus

- Reject a local page that lacks its numbered translation.
- Reject a local page without a mapped Notion URL.
- Reject a page when its recorded fingerprint is stale.
- Reject a reference to an unknown CLI command or error code.
- Fetch the published hub to confirm it links to, rather than repeats, detailed pages.

---

### Task 1: Add documentation map and verifier

**Files:**
- Create: `docs/notion-map.json`
- Create: `scripts/verify-documentation.mjs`
- Create: `scripts/verify-documentation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `verifyDocumentation(root)` and `bun run verify:docs`.
- Verifies documents `00`–`07`, local/Notion mapping, SHA-256 fingerprints, agents, CLI commands, and error codes.

- [ ] **Step 1: Write failing tests**

Create `scripts/verify-documentation.test.ts` with temporary fixture roots. It must assert that `verifyDocumentation(root)` throws `Missing English pair: 00`, `Fingerprint mismatch`, `Unknown CLI term: invented-command`, `Missing required error code: HEADLESS_UNSUPPORTED`, and `Missing documented agent: cursor` for the corresponding broken fixtures.

- [ ] **Step 2: Run the tests to verify RED**

Run: `bun test scripts/verify-documentation.test.ts`

Expected: FAIL because the verifier is absent.

- [ ] **Step 3: Implement the verifier**

Create `scripts/verify-documentation.mjs`. Export `verifyDocumentation(root)`. Define the permitted public CLI terms as `detect`, `plan mcp-install`, `plan mcp-remove`, `apply`, `capabilities`, `update`, and `headless`. Define permitted error codes as `CONFLICT`, `STALE_PLAN`, `UNRECOGNIZED_ENTRY`, `PLAN_NOT_FOUND`, `UPDATE_ASSET_MISSING`, `HEADLESS_UNSUPPORTED`, `UNKNOWN_COMMAND`, `UNKNOWN_AGENT`, and `INTERNAL_ERROR`. Require Claude Code, Codex, and Cursor in the documents. Add `--refresh-fingerprints` and `verify:docs` in `package.json`.

- [ ] **Step 4: Run GREEN checks**

Run: `bun test scripts/verify-documentation.test.ts && bun run typecheck`

Expected: PASS, then PASS.

- [ ] **Step 5: Commit**

Run: `git add package.json scripts/verify-documentation.mjs scripts/verify-documentation.test.ts docs/notion-map.json && git commit -m "docs: add documentation verification contract"`

### Task 2: Author the local bilingual guide

**Files:**
- Create: `docs/README.md`
- Create: eight `docs/es/` pages numbered `00`–`07`.
- Create: eight matching `docs/en/` pages numbered `00`–`07`.
- Modify: `README.md`, `docs/notion-map.json`, and verifier tests.

**Interfaces:**
- Consumes the ecosystem contract, `src/interfaces/cli/main.ts`, adapter files, app services, configuration I/O, snapshots, and architecture tests.
- Produces a complete, verifiable local guide.

- [ ] **Step 1: Extend failing tests**

Require the numbered local sequence and the three registered agents in the appropriate pages. Assert that missing `headless`, `HEADLESS_UNSUPPORTED`, or `cursor` causes verifier failure.

- [ ] **Step 2: Run RED**

Run: `bun test scripts/verify-documentation.test.ts`

Expected: FAIL because the local guide is absent.

- [ ] **Step 3: Write every ES/EN pair from code**

Create: `00` overview; `01` internal installation and boundaries; `02` agent detection and capabilities; `03` safe MCP planning; `04` confirmed application and recovery; `05` public CLI reference; `06` headless execution and integrations; `07` architecture and code map. Open each page with an everyday analogy, immediately define technical terms, and use only validated commands and JSON. Link root `README.md` to `docs/README.md` without duplicating detailed content.

- [ ] **Step 4: Refresh and verify**

Run: `bun scripts/verify-documentation.mjs --refresh-fingerprints && bun run verify:docs`

Expected: PASS, then PASS.

- [ ] **Step 5: Commit**

Run: `git add README.md docs scripts/verify-documentation.mjs scripts/verify-documentation.test.ts && git commit -m "docs: add bilingual Forge614 Engines guide"`

### Task 3: Publish the Notion mirror

**Files:**
- Modify: `docs/notion-map.json`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes the Task 2 guide and the Notion parent `Librerías` (`3dc21943-d129-814b-80f8-e5ffbb0940a6`).
- Produces one bilingual hub and fourteen numbered child pages, whose URLs are stored in the map.

- [ ] **Step 1: Check Notion before mutation**

Search `Forge614 Engines` and fetch `Librerías`. Confirm the target does not already exist and preserve every existing sibling.

- [ ] **Step 2: Create the hub and children**

Create `Forge614 Engines — Detección y Adaptadores Seguros de IA` as a concise bilingual index. Add the executive summary, workshop-inspector analogy, boundaries, and 00–07 index only. Create 14 children, two per number, and copy their matching local page content without title colours or backgrounds.

- [ ] **Step 3: Verify published shape**

Fetch the hub and pages `00`, `03`, `05`, and `07` in both languages. Confirm the hub contains fourteen native child links and no detailed duplicated manuals.

- [ ] **Step 4: Store URLs and re-run verifier**

Update all `notionUrl` values with exact returned URLs. Run: `bun scripts/verify-documentation.mjs --refresh-fingerprints && bun run verify:docs`

Expected: PASS, then PASS.

- [ ] **Step 5: Commit**

Run: `git add docs/notion-map.json docs/README.md && git commit -m "docs: publish Engines guide to Notion"`

### Task 4: Create personal Codex skill and verify the deliverable

**Files:**
- Create: `~/.codex/skills/ai-engineer-docs/SKILL.md`
- Create: `~/.codex/skills/ai-engineer-docs/agents/openai.yaml`
- Modify: `docs/superpowers/handoffs/2026-09-19-forge614-engines-mvp.md`

**Interfaces:**
- Consumes the Antigravity source skill, Codex skill conventions, and the published guide.
- Produces an automatically discoverable Codex skill with the same substantive documentation standards.

- [ ] **Step 1: Verify RED for the absent skill**

Run: `python3 /Users/jorgeetrejoo/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/jorgeetrejoo/.codex/skills/ai-engineer-docs`

Expected: FAIL because the target skill does not exist.

- [ ] **Step 2: Write the skill**

Create `ai-engineer-docs` with a discriminating trigger for AI libraries, tools, agents, and architectures documented locally and in `AI Engineer` Notion. Adapt all relevant Antigravity rules using Codex's available Notion tools: research code first; search and fetch before edits; numeric bilingual indexing; hub/detail separation; master analogy; plain-language terms; valid examples; print-safe formatting; and post-publication verification.

- [ ] **Step 3: Validate skill and project**

Run: `python3 /Users/jorgeetrejoo/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/jorgeetrejoo/.codex/skills/ai-engineer-docs && bun run verify:docs && bun test && bun run typecheck`

Expected: all commands exit 0.

- [ ] **Step 4: Record maintenance rule**

Append to the Engines handoff: any changed public behavior requires the matching ES/EN update, the matching Notion update, fingerprint refresh, `bun run verify:docs`, and the project suite.

- [ ] **Step 5: Commit**

Run: `git add docs/superpowers/handoffs/2026-09-19-forge614-engines-mvp.md && git commit -m "docs: add Engines documentation maintenance handoff"`
