import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface SnapshotManifestEntry {
  originalPath: string;
  backupFileName: string;
  sha256: string;
}

export interface SnapshotManifest {
  planId: string;
  createdAt: string;
  files: SnapshotManifestEntry[];
}

export function snapshotDirectory(home: string, planId: string): string {
  return join(home, ".forge614", "engines", "snapshots", planId);
}

export async function createSnapshot(home: string, planId: string, filePaths: string[]): Promise<SnapshotManifest> {
  const dir = snapshotDirectory(home, planId);
  await mkdir(dir, { recursive: true });

  const files: SnapshotManifestEntry[] = [];
  for (const filePath of filePaths) {
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const backupFileName = `${basename(filePath)}.bak`;
    await copyFile(filePath, join(dir, backupFileName));
    files.push({
      originalPath: filePath,
      backupFileName,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  const manifest: SnapshotManifest = { planId, createdAt: new Date().toISOString(), files };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function restoreSnapshot(home: string, planId: string): Promise<void> {
  const dir = snapshotDirectory(home, planId);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
  for (const file of manifest.files) {
    await copyFile(join(dir, file.backupFileName), file.originalPath);
  }
}
