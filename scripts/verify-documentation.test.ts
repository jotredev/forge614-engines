import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyDocumentation } from "./verify-documentation.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
  options: { omitEnglish?: boolean; staleHash?: boolean; cliTerm?: string; omitError?: string; omitAgent?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "forge614-engines-docs-"));
  roots.push(root);
  await mkdir(join(root, "docs", "es"), { recursive: true });
  await mkdir(join(root, "docs", "en"), { recursive: true });
  await writeFile(join(root, "docs", "README.md"), "# Documentation index\n");

  const esPath = "docs/es/00-resumen.md";
  const enPath = "docs/en/00-summary.md";
  const text = [
    ["Claude Code", "Codex", "Cursor"].filter((agent) => agent.toLowerCase() !== options.omitAgent).join(", "),
    "detect plan mcp-install plan mcp-remove apply capabilities update headless.",
    "CONFLICT STALE_PLAN UNRECOGNIZED_ENTRY PLAN_NOT_FOUND UPDATE_ASSET_MISSING HEADLESS_UNSUPPORTED UNKNOWN_COMMAND UNKNOWN_AGENT INTERNAL_ERROR.",
    options.cliTerm ?? "",
  ]
    .join("\n")
    .replace(options.omitError ?? "__no_error_to_remove__", "");

  await writeFile(join(root, esPath), text);
  if (!options.omitEnglish) await writeFile(join(root, enPath), text);
  const sha256 = createHash("sha256").update(text).digest("hex");
  await writeFile(
    join(root, "docs", "notion-map.json"),
    JSON.stringify({
      productVersion: "1.3.0",
      documents: [
        { localPath: esPath, language: "es", notionUrl: "https://notion.so/es", sha256: options.staleHash ? "0".repeat(64) : sha256 },
        ...(options.omitEnglish ? [] : [{ localPath: enPath, language: "en", notionUrl: "https://notion.so/en", sha256 }]),
      ],
    }),
  );
  return root;
}

test("rejects a Spanish document without its English pair", async () => {
  await expect(verifyDocumentation(await fixture({ omitEnglish: true }))).rejects.toThrow("Missing English pair: 00");
});

test("rejects a mapped file whose fingerprint is stale", async () => {
  await expect(verifyDocumentation(await fixture({ staleHash: true }))).rejects.toThrow("Fingerprint mismatch");
});

test("rejects a documented unknown public command", async () => {
  await expect(verifyDocumentation(await fixture({ cliTerm: "forge614-engines invented-command" }))).rejects.toThrow("Unknown CLI term: invented-command");
});

test("rejects a missing required error code", async () => {
  await expect(verifyDocumentation(await fixture({ omitError: "HEADLESS_UNSUPPORTED" }))).rejects.toThrow("Missing required error code: HEADLESS_UNSUPPORTED");
});

test("rejects a missing documented agent", async () => {
  await expect(verifyDocumentation(await fixture({ omitAgent: "cursor" }))).rejects.toThrow("Missing documented agent: cursor");
});

test("accepts the complete local documentation index", async () => {
  await expect(verifyDocumentation(process.cwd())).resolves.toMatchObject({ documents: 16, productVersion: "1.3.0" });
});
