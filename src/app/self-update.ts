import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

// Try `pwsh` (PowerShell 7 — guaranteed present, it's what runs this
// project's own CI steps) first, then classic `powershell.exe` as a
// fallback for machines without it.
const WINDOWS_SHELL_CANDIDATES = ["pwsh", "powershell.exe"];

function quoteWindowsArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// A `spawn(..., { detached: true })` child on Windows is NOT actually freed
// from its ancestors' Job Object — Windows only lets a child escape a Job
// Object when it's created with the CREATE_BREAKAWAY_FROM_JOB flag (and the
// job permits breakaway), a flag neither Node's nor Bun's child_process API
// exposes. GitHub Actions' Windows runners wrap every step's process tree in
// exactly such a Job Object. Across several real CI runs, every variation of
// `spawn(..., { detached: true, ... })` here reported a clean "spawn" event
// (a real process was created) yet produced ZERO output anywhere — no
// script-internal log, no captured stdout/stderr, regardless of shell
// (pwsh/powershell.exe) or stdio strategy (raw fd, cmd.exe redirection) —
// consistent with the child being killed the instant the job tore down,
// before it could do anything at all.
//
// Win32_Process.Create (via WMI/CIM) sidesteps this entirely: it spawns the
// target process from the WMI provider host (a Windows system service), not
// from our own process tree, so the result is never a member of our Job
// Object in the first place. This wrapper script only has to live long
// enough to make that one WMI call, so it runs as an ordinary (non-detached,
// awaited) child — the real, long-lived work happens in the process WMI
// creates, independently of this one's lifetime.
const WINDOWS_WMI_LAUNCH_SCRIPT = `
param(
  [string]$CommandLine,
  [string]$SpawnLogPath
)
try {
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $CommandLine }
  if ($result.ReturnValue -ne 0) {
    "$(Get-Date -Format o) Win32_Process.Create failed with ReturnValue=$($result.ReturnValue) for: $CommandLine" | Out-File -FilePath $SpawnLogPath -Append
    exit 1
  }
  "$(Get-Date -Format o) Win32_Process.Create succeeded, ProcessId=$($result.ProcessId) for: $CommandLine" | Out-File -FilePath $SpawnLogPath -Append
} catch {
  "$(Get-Date -Format o) Win32_Process.Create threw: $_" | Out-File -FilePath $SpawnLogPath -Append
  exit 1
}
`;

async function launchViaWmi(shell: string, wmiLaunchPath: string, targetCommandLine: string, spawnLogPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const wrapper = spawn(
      shell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        wmiLaunchPath,
        "-CommandLine",
        targetCommandLine,
        "-SpawnLogPath",
        spawnLogPath,
      ],
      { windowsHide: true },
    );
    let settled = false;
    wrapper.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    wrapper.once("exit", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`WMI launch wrapper (${shell}) exited with code ${code}`));
    });
  });
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
  const wmiLaunchPath = join(helperDir, `swap-helper-${stamp}.wmi-launch.ps1`);
  await writeFile(helperPath, WINDOWS_SWAP_HELPER_SCRIPT, "utf8");
  await writeFile(wmiLaunchPath, WINDOWS_WMI_LAUNCH_SCRIPT, "utf8");

  let lastError: unknown;
  for (const command of WINDOWS_SHELL_CANDIDATES) {
    const helperArgs = [
      command,
      "-NoProfile",
      "-NonInteractive",
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
    const targetCommandLine = helperArgs.map(quoteWindowsArg).join(" ");
    try {
      await launchViaWmi(command, wmiLaunchPath, targetCommandLine, spawnLogPath);
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
