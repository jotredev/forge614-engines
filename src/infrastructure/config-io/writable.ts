import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";

export async function isPathWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    try {
      await access(dirname(path), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
