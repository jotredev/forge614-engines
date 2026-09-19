import { access, stat, constants } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export async function findExecutableInPath(
  candidateNames: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const separator = platform === "win32" ? ";" : ":";
  const directories = [...new Set(pathValue.split(separator).filter((dir) => isAbsolute(dir)))];

  for (const directory of directories) {
    for (const name of candidateNames) {
      const candidate = join(directory, name);
      try {
        const info = await stat(candidate);
        if (!info.isFile()) continue;
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}
