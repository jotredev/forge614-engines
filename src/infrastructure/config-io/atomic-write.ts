import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AtomicWriteResult {
  changed: boolean;
}

export async function atomicWrite(targetPath: string, content: string): Promise<AtomicWriteResult> {
  let existing: string | undefined;
  try {
    existing = await readFile(targetPath, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing === content) return { changed: false };

  await mkdir(dirname(targetPath), { recursive: true });

  const tempPath = join(dirname(targetPath), `.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    const handle = await open(tempPath, "w", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }

  const verifyContent = await readFile(targetPath, "utf8");
  const expectedHash = createHash("sha256").update(content).digest("hex");
  const actualHash = createHash("sha256").update(verifyContent).digest("hex");
  if (expectedHash !== actualHash) {
    throw new Error(`Atomic write verification failed for ${targetPath}`);
  }

  if (process.platform !== "win32") {
    const dirHandle = await open(dirname(targetPath), "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  }

  return { changed: true };
}

export async function atomicDelete(targetPath: string): Promise<AtomicWriteResult> {
  try {
    await unlink(targetPath);
    return { changed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { changed: false };
    throw error;
  }
}
