import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../../package.json";

export interface UpdateResult {
  updated: boolean;
  currentVersion: string;
  latestVersion: string;
  note?: string;
}

export class UpdateAssetMissingError extends Error {
  constructor(platform: string, arch: string) {
    super(`The latest release has no Forge614 Engines asset for ${platform}-${arch}`);
  }
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

export function enginesRoot(home: string): string {
  // install.sh/install.ps1 both let FORGE614_HOME override where Engines'
  // own storage lives (used to sandbox tests without touching a real user's
  // home directory), pointing it directly at the ".forge614"-equivalent
  // root. This must resolve the same way, or `update` silently manages a
  // different directory than the one actually installed to.
  const forgeHome = process.env.FORGE614_HOME ?? join(home, ".forge614");
  return join(forgeHome, "engines");
}

export function platformArch(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { platform: string; arch: string; exeSuffix: string } {
  const mappedPlatform = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  const mappedArch = arch === "arm64" ? "arm64" : "x64";
  return { platform: mappedPlatform, arch: mappedArch, exeSuffix: mappedPlatform === "windows" ? ".exe" : "" };
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const apiUrl =
    process.env.FORGE614_RELEASE_API_URL ?? "https://api.github.com/repos/jotredev/forge614-engines/releases/latest";
  const response = await fetch(apiUrl, { headers: { "User-Agent": "forge614-engines-updater" } });
  if (!response.ok) throw new Error(`Could not fetch latest release metadata (HTTP ${response.status})`);
  return (await response.json()) as GithubRelease;
}

async function downloadToFile(url: string, path: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  await writeFile(path, new Uint8Array(await response.arrayBuffer()));
}

// Windows locks the file backing a running process's executable image, so the
// currently-running launcher (bin/forge614-engines.exe) cannot be overwritten
// by the very process running from it. This spawns a short-lived, detached
// helper that retries the copy after this process has fully exited and
// Windows has released the lock — the same pattern self-updating CLIs and
// desktop apps use on Windows. On macOS/Linux the launcher is a symlink
// instead, which can be atomically repointed while running (no helper needed).
const WINDOWS_SWAP_HELPER_SCRIPT = `
param(
  [string]$NewBinary,
  [string]$ActiveLauncher,
  [string]$ActiveVersionFile,
  [string]$Version,
  [string]$LogFile
)
"$(Get-Date -Format o) starting swap helper" | Out-File -FilePath $LogFile -Append
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    Copy-Item -Path $NewBinary -Destination $ActiveLauncher -Force
  } catch {
    "$(Get-Date -Format o) attempt $i copy failed: $_" | Out-File -FilePath $LogFile -Append
    continue
  }
  $newHash = (Get-FileHash -Path $NewBinary -Algorithm SHA256).Hash
  $activeHash = (Get-FileHash -Path $ActiveLauncher -Algorithm SHA256).Hash
  if ($newHash -eq $activeHash) {
    Set-Content -Path $ActiveVersionFile -Value $Version -NoNewline
    "$(Get-Date -Format o) swap succeeded on attempt $i" | Out-File -FilePath $LogFile -Append
    Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue
    exit 0
  }
}
"$(Get-Date -Format o) swap did not succeed after all retries" | Out-File -FilePath $LogFile -Append
`;

// A real Windows CI run showed `spawn("powershell.exe", ...)` silently never
// launch anything at all (no log file, no process, no error surfaced) — this
// GH-hosted Windows runner's default shell is PowerShell 7 (`pwsh`); classic
// Windows PowerShell (`powershell.exe`) may not be reliably on PATH for a
// spawned child the way it is for a shell-interpreted step. Try `pwsh` first
// (guaranteed present — it's what runs this project's own CI steps), then
// `powershell.exe` as a fallback for machines without PowerShell 7. Either
// way, wait for a real "spawn" or "error" event before returning: a spawn
// failure is otherwise silent (Node only reports it via an event, not a
// thrown exception), which is exactly how the earlier failure went
// undiagnosed for several CI runs.
const WINDOWS_SHELL_CANDIDATES = ["pwsh", "powershell.exe"];

async function spawnDetached(command: string, args: string[], outputLogPath: string): Promise<ReturnType<typeof spawn>> {
  // Redirect the child's own stdout/stderr to a file at the OS level, not
  // just relying on the PowerShell script's internal Out-File logging: a
  // parameter-binding error, execution-policy block, or any other failure
  // pwsh hits before reaching the script body would otherwise be completely
  // invisible — Node only sees "a process was created," never what it
  // actually printed. This is cheap enough to keep permanently, not just for
  // this diagnostic round: a real user hitting a self-update failure on
  // Windows deserves the same visibility.
  const fd = openSync(outputLogPath, "a");
  try {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (error) => reject(error));
    });
    return child;
  } finally {
    closeSync(fd);
  }
}

async function scheduleWindowsSwap(
  newBinary: string,
  activeLauncher: string,
  activeVersionFile: string,
  version: string,
  helperDir: string,
): Promise<string> {
  const stamp = Date.now();
  const helperPath = join(helperDir, `swap-helper-${stamp}.ps1`);
  const logPath = join(helperDir, `swap-helper-${stamp}.log`);
  const spawnLogPath = join(helperDir, `swap-helper-${stamp}.spawn.log`);
  await writeFile(helperPath, WINDOWS_SWAP_HELPER_SCRIPT, "utf8");
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath,
    "-NewBinary",
    newBinary,
    "-ActiveLauncher",
    activeLauncher,
    "-ActiveVersionFile",
    activeVersionFile,
    "-Version",
    version,
    "-LogFile",
    logPath,
  ];

  let lastError: unknown;
  for (const command of WINDOWS_SHELL_CANDIDATES) {
    try {
      const child = await spawnDetached(command, args, spawnLogPath);
      child.unref();
      return logPath;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not launch a PowerShell to finish the update (tried ${WINDOWS_SHELL_CANDIDATES.join(", ")}): ${lastError}`,
  );
}

export async function performUpdate(home: string): Promise<UpdateResult> {
  const currentVersion = pkg.version;
  const release = await fetchLatestRelease();
  const latestVersion = release.tag_name.replace(/^v/, "");

  if (latestVersion === currentVersion) {
    return { updated: false, currentVersion, latestVersion };
  }

  const { platform, arch, exeSuffix } = platformArch();
  const assetName = `forge614-engines-${latestVersion}-${platform}-${arch}.tar.gz`;
  const asset = release.assets.find((a) => a.name === assetName);
  const checksumAsset = release.assets.find((a) => a.name === `${assetName}.sha256`);
  if (!asset || !checksumAsset) throw new UpdateAssetMissingError(platform, arch);

  const root = enginesRoot(home);
  const scratchDir = join(root, `.update-${Date.now()}`);
  await mkdir(scratchDir, { recursive: true });

  try {
    const archivePath = join(scratchDir, assetName);
    const checksumPath = `${archivePath}.sha256`;
    await downloadToFile(asset.browser_download_url, archivePath);
    await downloadToFile(checksumAsset.browser_download_url, checksumPath);

    const expected = (await readFile(checksumPath, "utf8")).split(" ")[0].trim();
    const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
    if (expected.toLowerCase() !== actual.toLowerCase()) throw new Error("Update download checksum failed");

    const extracted = join(scratchDir, "extracted");
    await mkdir(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archivePath, "-C", extracted]);

    const releaseName = `forge614-engines-${latestVersion}-${platform}-${arch}`;
    const releaseRoot = join(extracted, releaseName);
    if (!existsSync(join(releaseRoot, `forge614-engines${exeSuffix}`)) || !existsSync(join(releaseRoot, "package.json"))) {
      throw new Error("Invalid update archive");
    }

    const target = join(root, latestVersion);
    await rm(target, { recursive: true, force: true });
    await rename(releaseRoot, target); // same filesystem (both under `root`) — safe rename, no EXDEV risk

    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const activeLauncher = join(binDir, `forge614-engines${exeSuffix}`);
    const newBinary = join(target, `forge614-engines${exeSuffix}`);
    const activeVersionFile = join(root, ".active-version");

    if (platform === "windows") {
      // Write the helper script directly under `root` (not `scratchDir`,
      // which this function's `finally` block deletes almost immediately
      // after spawning it) — the script deletes itself once it finishes.
      const logPath = await scheduleWindowsSwap(newBinary, activeLauncher, activeVersionFile, latestVersion, root);
      return {
        updated: true,
        currentVersion,
        latestVersion,
        note: `Finishing the active binary swap in the background; the next invocation will use the new version. Helper log: ${logPath}`,
      };
    }

    const tempLink = `${activeLauncher}.new`;
    await unlink(tempLink).catch(() => {});
    await symlink(newBinary, tempLink);
    await rename(tempLink, activeLauncher); // atomic on POSIX — safe to repoint while the old target is still running
    await writeFile(activeVersionFile, latestVersion, "utf8");

    return { updated: true, currentVersion, latestVersion };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}
