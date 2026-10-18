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
  if (value === undefined) return removeTable(raw, [...entryPath, name]);
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

function quoteKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tableName(path: string[]): string {
  return path.map(quoteKey).join(".");
}

function linesOf(raw: string): { start: number; end: number; content: string }[] {
  const lines: { start: number; end: number; content: string }[] = [];
  let start = 0;
  while (start < raw.length) {
    const newline = raw.indexOf("\n", start);
    const end = newline < 0 ? raw.length : newline + 1;
    lines.push({ start, end, content: raw.slice(start, newline < 0 ? end : newline).replace(/\r$/, "") });
    start = end;
  }
  return lines;
}

function headerPath(line: string): string[] | undefined {
  const match = /^\s*\[\[?(.+?)\]\]?\s*(?:#.*)?$/.exec(line);
  if (!match) return undefined;
  return match[1]!.split(".").map((part) => part.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"));
}

function findTable(raw: string, path: string[]): { start: number; end: number; bodyStart: number } | undefined {
  const lines = linesOf(raw);
  const expected = tableName(path);
  const index = lines.findIndex((line) => line.content.trim() === `[${expected}]`);
  if (index < 0) return undefined;
  const start = lines[index]!.start;
  let end = raw.length;
  for (let i = index + 1; i < lines.length; i++) {
    const child = headerPath(lines[i]!.content);
    if (!child) continue;
    if (child.length <= path.length || !path.every((part, at) => child[at] === part)) {
      end = lines[i]!.start;
      break;
    }
  }
  return { start, end, bodyStart: lines[index]!.end };
}

function removeTable(raw: string, path: string[]): string {
  const section = findTable(raw, path);
  if (!section) return raw;
  return raw.slice(0, section.start) + raw.slice(section.end);
}

function keyValue(raw: string, path: string[]): { lineStart: number; valueStart: number; valueEnd: number; lineEnd: number } | undefined {
  const table = findTable(raw, path.slice(0, -1));
  const start = table?.bodyStart ?? (path.length === 1 ? 0 : -1);
  if (start < 0) return undefined;
  const end = table?.end ?? raw.length;
  const lines = linesOf(raw).filter((line) => line.start >= start && line.start < end);
  const key = quoteKey(path.at(-1)!);
  for (const line of lines) {
    const assignment = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`).exec(line.content);
    if (!assignment) continue;
    const lineStart = line.start;
    const valueStart = line.start + assignment[0].length;
    let cursor = valueStart;
    while (/\s/.test(raw[cursor] ?? "")) cursor++;
    const valueEnd = scanTomlValue(raw, cursor);
    if (valueEnd < 0) return undefined;
    let lineEnd = line.end;
    while (lineEnd < raw.length && /[ \t]/.test(raw[lineEnd]!)) lineEnd++;
    if (raw[lineEnd] === "#") while (lineEnd < raw.length && raw[lineEnd] !== "\n") lineEnd++;
    if (raw[lineEnd] === "\n") lineEnd++;
    return { lineStart, valueStart: cursor, valueEnd, lineEnd };
  }
  return undefined;
}

function scanTomlValue(raw: string, start: number): number {
  const opener = raw[start];
  if (opener !== "[" && opener !== "{") {
    let quoted = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const char = raw[i]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"' || char === "'") quoted = true;
      else if (char === "#" || char === "\n") return i;
    }
    return raw.length;
  }
  const stack: string[] = [];
  let quote = "";
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const char = raw[i]!;
    if (quote) {
      if (quote === '"' && escaped) escaped = false;
      else if (quote === '"' && char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[") stack.push("]");
    else if (char === "{") stack.push("}");
    else if (char === "]" || char === "}") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

function arrayItemSpans(raw: string, start: number, end: number): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let itemStart = start + 1;
  const stack: string[] = ["]"];
  let quote = "";
  let escaped = false;
  for (let i = start + 1; i < end - 1; i++) {
    const char = raw[i]!;
    if (quote) {
      if (quote === '"' && escaped) escaped = false;
      else if (quote === '"' && char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") stack.push(char === "[" ? "]" : "}");
    else if (char === "]" || char === "}") stack.pop();
    else if (char === "," && stack.length === 1) {
      const left = itemStart + (raw.slice(itemStart, i).match(/^\s*/)?.[0].length ?? 0);
      const right = i - (raw.slice(itemStart, i).match(/\s*$/)?.[0].length ?? 0);
      if (left < right) spans.push({ start: left, end: right });
      itemStart = i + 1;
    }
  }
  const lastEnd = end - 1;
  const left = itemStart + (raw.slice(itemStart, lastEnd).match(/^\s*/)?.[0].length ?? 0);
  const right = lastEnd - (raw.slice(itemStart, lastEnd).match(/\s*$/)?.[0].length ?? 0);
  if (left < right) spans.push({ start: left, end: right });
  return spans;
}

function removeArrayItems(raw: string, path: string[], indexes: number[]): string {
  let current = raw;
  for (const index of [...indexes].sort((a, b) => b - a)) {
    const value = keyValue(current, path);
    if (!value) {
      current = removeArrayTableItem(current, path, index);
      continue;
    }
    if (current[value.valueStart] !== "[") continue;
    const spans = arrayItemSpans(current, value.valueStart, value.valueEnd);
    const item = spans[index];
    if (!item) continue;
    const before = spans[index - 1];
    const after = spans[index + 1];
    const start = after ? item.start : before ? before.end : item.start;
    const end = after ? after.start : before ? item.end : item.end;
    current = current.slice(0, start) + current.slice(end);
  }
  return current;
}

function removeValueAtPath(raw: string, path: string[]): string {
  const value = keyValue(raw, path);
  if (value) return raw.slice(0, value.lineStart) + raw.slice(value.lineEnd);
  let current = raw;
  while (arrayTableSections(current, path).length > 0) {
    const section = arrayTableSections(current, path).at(-1)!;
    current = current.slice(0, section.start) + current.slice(section.end);
  }
  return current;
}

function arrayTableSections(raw: string, path: string[]): { start: number; end: number }[] {
  const lines = linesOf(raw);
  const sections: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*\[\[(.+)\]\]\s*(?:#.*)?$/.exec(lines[i]!.content);
    if (!header || header[1]!.split(".").map((part) => part.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")).join("\0") !== path.join("\0")) continue;
    let end = raw.length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = headerPath(lines[j]!.content);
      if (!next) continue;
      if (next.length <= path.length || !path.every((part, at) => next[at] === part)) {
        end = lines[j]!.start;
        break;
      }
    }
    sections.push({ start: lines[i]!.start, end });
  }
  return sections;
}

function removeArrayTableItem(raw: string, path: string[], index: number): string {
  const section = arrayTableSections(raw, path)[index];
  return section ? raw.slice(0, section.start) + raw.slice(section.end) : raw;
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
  if (value === undefined) return removeValueAtPath(raw, path);
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
  removeValueAtPath,
  removeArrayItems,
  isParsable,
};
