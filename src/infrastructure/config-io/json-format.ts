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

export const jsonConfigFormat: ConfigFormatIO = { readOrDefault, getMcpEntry, withMcpEntry };
