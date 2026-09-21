import { readFile } from "node:fs/promises";
import { parse, stringify } from "smol-toml";
import type { ConfigFormatIO } from "./config-format";

async function readOrDefault(path: string): Promise<{ raw: string; exists: boolean }> {
  try {
    return { raw: await readFile(path, "utf8"), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "", exists: false };
    throw error;
  }
}

function parseDocument(raw: string): Record<string, unknown> {
  return raw.trim() === "" ? {} : (parse(raw) as Record<string, unknown>);
}

function getMcpEntry(raw: string, entryPath: string[], name: string): unknown {
  const document = parseDocument(raw);
  const fullPath = [...entryPath, name];
  return fullPath.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
    document,
  );
}

function withMcpEntry(raw: string, entryPath: string[], name: string, value: unknown): string {
  const document = parseDocument(raw);
  let cursor: Record<string, unknown> = document;
  for (const key of entryPath) {
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  if (value === undefined) delete cursor[name];
  else cursor[name] = value;
  return stringify(document);
}

function isParsable(raw: string): boolean {
  try {
    parseDocument(raw);
    return true;
  } catch {
    return false;
  }
}

function getValueAtPath(raw: string, path: string[]): unknown {
  const document = parseDocument(raw);
  return path.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
    document,
  );
}

function withValueAtPath(raw: string, path: string[], value: unknown): string {
  const document = parseDocument(raw);
  if (path.length === 0) throw new Error("withValueAtPath requires a non-empty path");
  let cursor: Record<string, unknown> = document;
  for (const key of path.slice(0, -1)) {
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1]!;
  if (value === undefined) delete cursor[lastKey];
  else cursor[lastKey] = value;
  return stringify(document);
}

export const tomlConfigFormat: ConfigFormatIO = {
  readOrDefault,
  getMcpEntry,
  withMcpEntry,
  getValueAtPath,
  withValueAtPath,
  isParsable,
};
