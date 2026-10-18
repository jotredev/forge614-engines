import { readFile } from "node:fs/promises";
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, type Node } from "jsonc-parser";
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
  if (value === undefined) return removeValueAtPath(raw, [...entryPath, name]);
  const edits = modify(raw, [...entryPath, name], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  return applyEdits(raw, edits);
}

function removeNode(raw: string, node: Node): string {
  const parent = node.parent;
  if (!parent?.children?.length) return raw;
  const siblings = parent.children;
  const index = siblings.indexOf(node);
  if (index < 0) return raw;
  let start = node.offset;
  let end = node.offset + node.length;
  if (parent.type === "object") {
    const property = node;
    const siblingProperties = siblings;
    if (index < siblingProperties.length - 1) {
      end = siblingProperties[index + 1]!.offset;
    } else if (index > 0) {
      start = siblingProperties[index - 1]!.offset + siblingProperties[index - 1]!.length;
    }
  } else if (parent.type === "array") {
    if (index < siblings.length - 1) end = siblings[index + 1]!.offset;
    else if (index > 0) start = siblings[index - 1]!.offset + siblings[index - 1]!.length;
  }
  return raw.slice(0, start) + raw.slice(end);
}

function removeValueAtPath(raw: string, path: string[]): string {
  const tree = parseTree(raw);
  if (!tree || path.length === 0) return raw;
  const node = findNodeAtLocation(tree, path);
  if (!node) return raw;
  const target = node.parent?.parent?.type === "object" ? node.parent : node;
  return removeNode(raw, target);
}

function removeArrayItemsRaw(raw: string, path: string[], indexes: number[]): string {
  let current = raw;
  for (const index of [...indexes].sort((a, b) => b - a)) {
    const tree = parseTree(current);
    if (!tree) continue;
    const array = findNodeAtLocation(tree, path);
    const item = array?.children?.[index];
    if (array?.type === "array" && item) current = removeNode(current, item);
  }
  return current;
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
  return removeArrayItemsRaw(raw, path, indexes);
}

export const jsonConfigFormat: ConfigFormatIO = {
  readOrDefault,
  getMcpEntry,
  withMcpEntry,
  getValueAtPath,
  withValueAtPath,
  removeValueAtPath,
  removeArrayItems: removeArrayItemsRaw,
  isParsable,
};
