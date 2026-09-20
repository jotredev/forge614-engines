// CI-only integration check (invoked from .github/workflows/verify.yml's
// Windows job): proves the self-update mechanism works when the *currently
// executing* launcher file has to replace itself — something a plain
// `bun test` run cannot exercise, because there the test process is calling
// performUpdate() in-process, not running *from* the file being replaced.
//
// This spawns the real, currently-installed forge614-engines.exe (the exact
// file `update` must overwrite) as a genuine child process, waits for it to
// exit, then confirms the detached Windows swap helper (see
// src/app/self-update.ts) finished the job afterwards.
//
// The fake release is served via `file://` URLs (Bun's `fetch()` resolves
// them), not a local HTTP server: an earlier version of this script used
// Bun.serve(), and on a real windows-latest run the spawned .exe hung for
// several minutes on its first network call before failing — almost
// certainly Defender/firewall scrutiny of a freshly-written, unsigned
// binary's first network access, even to loopback. Reading static files
// sidesteps networking (and that flakiness) entirely.
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// GH Actions killed a previous run of this script via its step-level
// timeout without ANY of its console.log output reaching the captured log —
// on Windows, a non-TTY stdout pipe can stay buffered until either the
// buffer fills or the process exits cleanly, so a hard-killed process can
// lose everything it "printed." Logging to a file (with a real write, not a
// buffered stream) survives that; a companion `if: always()` step in
// verify.yml prints this file's content even if this script is killed.
const diagLogPath = process.env.FORGE614_DIAG_LOG ?? join(process.env.RUNNER_TEMP ?? ".", "self-update-diag.log");
function diag(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    appendFileSync(diagLogPath, `${line}\n`);
  } catch {
    // Best-effort — never let logging itself break the check.
  }
}

diag(`verify-windows-self-update.mjs starting, diag log at ${diagLogPath}`);

const launcherPath = process.env.FORGE614_LAUNCHER_PATH;
const forgeHome = process.env.FORGE614_HOME;
if (!launcherPath || !forgeHome) {
  console.error("Set FORGE614_LAUNCHER_PATH and FORGE614_HOME before running this script.");
  process.exit(64);
}
if (!existsSync(launcherPath)) {
  console.error(`Launcher not found: ${launcherPath} — install it first (e.g. via install.ps1 -Archive).`);
  process.exit(64);
}

const fakeVersion = "9999.0.0";
const assetName = `forge614-engines-${fakeVersion}-windows-x64.tar.gz`;
const expectedContent = `fake binary content for ${fakeVersion}\n`;
// Before the swap, launcherPath is the REAL ~100MB+ bun-compiled binary, not
// the tiny fixture content — a prior run showed reading that whole file as
// "utf8" (and later JSON.stringify-ing the result for a diagnostic message)
// took ~1s per poll iteration and produced a 100MB+ diag log line, which is
// almost certainly what made the polling loop look "hung" until the step's
// 3-minute timeout. Only the first few bytes are ever needed to detect the
// swap, so read just a small prefix instead of the whole file.
const PREFIX_BYTES = Math.max(expectedContent.length, 64);

function readLauncherPrefix() {
  const fd = openSync(launcherPath, "r");
  try {
    const buffer = Buffer.alloc(PREFIX_BYTES);
    const bytesRead = readSync(fd, buffer, 0, PREFIX_BYTES, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

const workDir = join(forgeHome, "..", "self-update-fixture");
mkdirSync(workDir, { recursive: true });
const releaseRoot = join(workDir, `forge614-engines-${fakeVersion}-windows-x64`);
mkdirSync(releaseRoot, { recursive: true });
writeFileSync(join(releaseRoot, "forge614-engines.exe"), `fake binary content for ${fakeVersion}\n`);
writeFileSync(join(releaseRoot, "package.json"), JSON.stringify({ version: fakeVersion }));
diag("fixture release directory staged");

const archivePath = join(workDir, assetName);
diag(`about to build archive via execFileSync("tar", ...): ${archivePath}`);
execFileSync("tar", ["-czf", archivePath, "-C", workDir, `forge614-engines-${fakeVersion}-windows-x64`]);
diag("archive built");
const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
const checksumPath = `${archivePath}.sha256`;
writeFileSync(checksumPath, `${checksum}  ${assetName}\n`);

const releaseJsonPath = join(workDir, "release.json");
writeFileSync(
  releaseJsonPath,
  JSON.stringify({
    tag_name: `v${fakeVersion}`,
    assets: [
      { name: assetName, browser_download_url: pathToFileURL(archivePath).href },
      { name: `${assetName}.sha256`, browser_download_url: pathToFileURL(checksumPath).href },
    ],
  }),
);
const releaseApiUrl = pathToFileURL(releaseJsonPath).href;

diag(`fixture release ready at ${releaseApiUrl}, about to spawn launcher: ${launcherPath}`);

const child = spawn(launcherPath, ["update"], {
  env: { ...process.env, FORGE614_HOME: forgeHome, FORGE614_RELEASE_API_URL: releaseApiUrl },
  stdio: ["ignore", "pipe", "inherit"],
});
diag(`spawn() returned, launcher pid=${child.pid}`);

let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  diag(`launcher stdout chunk: ${chunk.toString().trim()}`);
});

const exitCode = await Promise.race([
  new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1))),
  new Promise((resolve) =>
    setTimeout(() => {
      diag("Launcher process did not exit within 60s — killing it and failing fast.");
      child.kill();
      resolve(1);
    }, 60_000),
  ),
]);
diag(`Launcher process settled with code ${exitCode}`);
if (exitCode !== 0) {
  process.exit(1);
}

let logPath;
try {
  const match = JSON.parse(stdout).result?.note?.match(/Helper log: (.+)$/);
  logPath = match?.[1]?.trim();
  diag(`parsed helper log path from launcher output: ${logPath}`);
} catch (error) {
  diag(`could not parse launcher stdout for a helper log path: ${error}`);
}

diag("starting to poll for the launcher file to be swapped (up to 15s)");
const deadline = Date.now() + 15_000;
let content = "";
let iteration = 0;
// Per-iteration logging kept intentionally verbose: an earlier version of
// this loop read the launcher's FULL content as utf8 every iteration, which
// before the swap is the real 100MB+ bun-compiled binary, not the tiny
// fixture text — decoding that repeatedly, then JSON.stringify-ing the
// result for a diagnostic message, made the loop look "hung" until the
// step's 3-minute timeout. Reading only a small prefix (readLauncherPrefix)
// fixed that; this logging stays to catch any regression quickly.
while (Date.now() < deadline) {
  iteration++;
  diag(`poll iteration ${iteration}: about to call existsSync`);
  const exists = existsSync(launcherPath);
  diag(`poll iteration ${iteration}: existsSync returned ${exists}`);
  if (exists) {
    diag(`poll iteration ${iteration}: about to read launcher prefix`);
    try {
      content = readLauncherPrefix();
      diag(`poll iteration ${iteration}: read prefix ${JSON.stringify(content)}`);
    } catch (error) {
      diag(`poll iteration ${iteration}: reading prefix threw: ${error}`);
    }
    if (content === expectedContent) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
diag(`polling finished after ${iteration} iterations, launcher prefix is now: ${JSON.stringify(content)}`);

if (content !== expectedContent) {
  diag(`Launcher was not swapped to the new version within the timeout. Current prefix: ${JSON.stringify(content)}`);
  if (logPath && existsSync(logPath)) {
    diag(`--- swap helper log (${logPath}) ---`);
    diag(readFileSync(logPath, "utf8"));
  } else {
    diag(`No helper log found at ${logPath ?? "(unknown path)"}.`);
  }
  process.exit(1);
}

diag("Self-update swap verified: the running launcher replaced itself with the new version.");
process.exit(0);
