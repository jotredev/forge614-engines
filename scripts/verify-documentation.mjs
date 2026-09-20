import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_AGENTS = ["claude code", "codex", "cursor"];
const NON_ERROR_CODES = new Set(["CLI", "JSON", "MCP", "PATH", "SHA", "TOML", "FORGE614_HOME"]);

function fingerprint(text) {
  return createHash("sha256").update(text).digest("hex");
}

function numberFor(path) {
  return /^docs\/(?:es|en)\/(\d{2})-/.exec(path)?.[1];
}

function commandTerms(text) {
  return [...text.matchAll(/forge614-engines\s+(?:(plan)\s+([a-z][\w-]*)|(detect|apply|capabilities|update|headless|[a-z][\w-]*))/g)].map(
    (match) => (match[1] ? `plan ${match[2]}` : match[3]),
  );
}

async function localDocumentationPaths(root) {
  const paths = [];
  for (const language of ["es", "en"]) {
    const directory = join(root, "docs", language);
    for (const entry of await readdir(directory)) {
      if (entry.endsWith(".md")) paths.push(`docs/${language}/${entry}`);
    }
  }
  return paths.sort();
}

async function publicCliContract(root) {
  const source = await readFile(join(root, "src", "interfaces", "cli", "main.ts"), "utf8");
  const commands = new Set([...source.matchAll(/command === "([a-z]+)"/g)].map((match) => match[1]));
  for (const subcommand of source.matchAll(/command === "plan" && subcommand === "(mcp-(?:install|remove))"/g)) {
    commands.add(`plan ${subcommand[1]}`);
  }
  const errorCodes = new Set([...source.matchAll(/return "([A-Z][A-Z_]+)"/g)].map((match) => match[1]));
  return { commands, errorCodes };
}

function documentedErrorCodes(text) {
  return new Set(
    [...text.matchAll(/`([A-Z][A-Z_]{2,})`/g)]
      .map((match) => match[1])
      .filter((code) => !NON_ERROR_CODES.has(code)),
  );
}

export async function verifyDocumentation(root) {
  if (!existsSync(join(root, "docs", "README.md"))) throw new Error("Missing documentation index");
  const mapPath = join(root, "docs", "notion-map.json");
  const map = JSON.parse(await readFile(mapPath, "utf8"));
  const documents = map.documents ?? [];
  const localPaths = await localDocumentationPaths(root);
  const mappedPaths = new Set(documents.map((document) => document.localPath));
  for (const localPath of localPaths) {
    if (!mappedPaths.has(localPath)) throw new Error(`Unmapped local documentation file: ${localPath}`);
  }
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
  for (const number of map.requiredNumbers ?? []) {
    if (!seenByNumber.has(number)) throw new Error(`Missing documentation pair: ${number}`);
  }

  const allText = texts.join("\n");
  const lowerText = allText.toLowerCase();
  for (const agent of REQUIRED_AGENTS) {
    if (!lowerText.includes(agent)) throw new Error(`Missing documented agent: ${agent === "claude code" ? "claude-code" : agent}`);
  }
  const { commands, errorCodes } = await publicCliContract(root);
  for (const code of errorCodes) {
    if (!allText.includes(code)) throw new Error(`Missing required error code: ${code}`);
  }
  for (const code of documentedErrorCodes(allText)) {
    if (!errorCodes.has(code)) throw new Error(`Unknown error code: ${code}`);
  }
  for (const term of commandTerms(allText)) {
    if (!commands.has(term)) throw new Error(`Unknown CLI term: ${term}`);
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
