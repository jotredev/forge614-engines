import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_AGENTS = ["claude code", "codex", "cursor"];
const REQUIRED_ERROR_CODES = [
  "CONFLICT",
  "STALE_PLAN",
  "UNRECOGNIZED_ENTRY",
  "PLAN_NOT_FOUND",
  "UPDATE_ASSET_MISSING",
  "HEADLESS_UNSUPPORTED",
  "UNKNOWN_COMMAND",
  "UNKNOWN_AGENT",
  "INTERNAL_ERROR",
];
const PUBLIC_COMMANDS = new Set(["detect", "plan mcp-install", "plan mcp-remove", "apply", "capabilities", "update", "headless"]);

function fingerprint(text) {
  return createHash("sha256").update(text).digest("hex");
}

function numberFor(path) {
  return /^docs\/(?:es|en)\/(\d{2})-/.exec(path)?.[1];
}

function commandTerms(text) {
  return [...text.matchAll(/forge614-engines\s+(detect|apply|capabilities|update|headless|plan\s+mcp-(?:install|remove)|[a-z][\w-]*)/g)].map(
    (match) => match[1].replace(/\s+/g, " "),
  );
}

export async function verifyDocumentation(root) {
  const mapPath = join(root, "docs", "notion-map.json");
  const map = JSON.parse(await readFile(mapPath, "utf8"));
  const documents = map.documents ?? [];
  const seenByNumber = new Map();
  const texts = [];

  for (const document of documents) {
    if (!document.localPath || !document.language || !document.notionUrl || !document.sha256) {
      throw new Error("Incomplete documentation map entry");
    }
    const number = numberFor(document.localPath);
    if (!number) throw new Error(`Unnumbered documentation path: ${document.localPath}`);
    const absolutePath = join(root, document.localPath);
    if (!existsSync(absolutePath)) throw new Error(`Mapped documentation file is missing: ${document.localPath}`);
    const text = await readFile(absolutePath, "utf8");
    if (fingerprint(text) !== document.sha256) throw new Error(`Fingerprint mismatch: ${document.localPath}`);
    const languages = seenByNumber.get(number) ?? new Set();
    languages.add(document.language);
    seenByNumber.set(number, languages);
    texts.push(text);
  }

  for (const [number, languages] of seenByNumber) {
    if (!languages.has("es")) throw new Error(`Missing Spanish pair: ${number}`);
    if (!languages.has("en")) throw new Error(`Missing English pair: ${number}`);
  }

  const allText = texts.join("\n");
  const lowerText = allText.toLowerCase();
  for (const agent of REQUIRED_AGENTS) {
    if (!lowerText.includes(agent)) throw new Error(`Missing documented agent: ${agent === "claude code" ? "claude-code" : agent}`);
  }
  for (const code of REQUIRED_ERROR_CODES) {
    if (!allText.includes(code)) throw new Error(`Missing required error code: ${code}`);
  }
  for (const term of commandTerms(allText)) {
    if (!PUBLIC_COMMANDS.has(term)) throw new Error(`Unknown CLI term: ${term}`);
  }

  return { documents: documents.length, productVersion: map.productVersion };
}

export async function refreshFingerprints(root) {
  const mapPath = join(root, "docs", "notion-map.json");
  const map = JSON.parse(await readFile(mapPath, "utf8"));
  for (const document of map.documents ?? []) {
    const absolutePath = join(root, document.localPath);
    if (existsSync(absolutePath)) document.sha256 = fingerprint(await readFile(absolutePath, "utf8"));
  }
  await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && relative(scriptPath, process.argv[1]) === "") {
  const root = dirname(dirname(scriptPath));
  if (process.argv.includes("--refresh-fingerprints")) await refreshFingerprints(root);
  const result = await verifyDocumentation(root);
  console.log(`Verified ${result.documents} documentation files for Forge614 Engines ${result.productVersion}.`);
}
