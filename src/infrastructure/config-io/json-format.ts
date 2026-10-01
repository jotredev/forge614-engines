import { readFile } from "node:fs/promises";
import { applyEdits, modify, parse } from "jsonc-parser";
import type { ConfigFormatIO } from "./config-format";

async function readOrDefault(path: string): Promise<{ raw: string; exists: boolean }> {
  try {
    return { raw: await readFile(path, "utf8"), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "{}", exists: false };
    throw error;
  }
}

function getMcpEntry(raw: string, entryPath: string[], name: string): unknown {
  const document = parse(raw) as Record<string, unknown>;
  const fullPath = [...entryPath, name];
  return fullPath.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
    document,
  );
}

function withMcpEntry(raw: string, entryPath: string[], name: string, value: unknown): string {
  const edits = modify(raw, [...entryPath, name], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  return applyEdits(raw, edits);
}

function isParsable(raw: string): boolean {
  if (raw.trim() === "") return true;
  const errors: import("jsonc-parser").ParseError[] = [];
  parse(raw, errors);
  return errors.length === 0;
}

function getValueAtPath(raw: string, path: string[]): unknown {
  const document = parse(raw) as Record<string, unknown>;
  return path.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
    document,
  );
}

function withValueAtPath(raw: string, path: string[], value: unknown): string {
  const edits = modify(raw, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  return applyEdits(raw, edits);
}

const FORMATTING = { insertSpaces: true, tabSize: 2 } as const;

/**
 * Appends `value` to the end of the array that lives at `path`, without rewriting the array:
 * jsonc-parser inserts only the new element (with `isArrayInsertion`), so the order, the
 * formatting and the comments of the other elements stay intact byte for byte. This is what
 * allows adding a rule to `permissions.allow` without touching the ones the person already
 * had. The array must exist; to create it, `withValueAtPath` is used.
 */
export function appendToArray(raw: string, path: string[], value: unknown): string {
  const edits = modify(raw, [...path, -1], value, { formattingOptions: FORMATTING, isArrayInsertion: true });
  return applyEdits(raw, edits);
}

/**
 * Removes from the array at `path` only the elements at the given indexes, one by one
 * (from highest to lowest, so deleting one does not shift the indexes of the next ones).
 * The other elements and the rest of the file are not touched; if the array ends up
 * empty it stays as an empty array.
 */
export function removeArrayItems(raw: string, path: string[], indexes: number[]): string {
  return [...indexes]
    .sort((a, b) => b - a)
    .reduce((current, index) => applyEdits(current, modify(current, [...path, index], undefined, { formattingOptions: FORMATTING })), raw);
}

export const jsonConfigFormat: ConfigFormatIO = {
  readOrDefault,
  getMcpEntry,
  withMcpEntry,
  getValueAtPath,
  withValueAtPath,
  isParsable,
};
