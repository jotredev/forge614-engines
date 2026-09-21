export interface ConfigFormatIO {
  readOrDefault(path: string): Promise<{ raw: string; exists: boolean }>;
  getMcpEntry(raw: string, entryPath: string[], name: string): unknown;
  withMcpEntry(raw: string, entryPath: string[], name: string, value: unknown): string;
  getValueAtPath(raw: string, path: string[]): unknown;
  withValueAtPath(raw: string, path: string[], value: unknown): string;
  isParsable(raw: string): boolean;
}
