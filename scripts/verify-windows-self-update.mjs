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
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const workDir = join(forgeHome, "..", "self-update-fixture");
mkdirSync(workDir, { recursive: true });
const releaseRoot = join(workDir, `forge614-engines-${fakeVersion}-windows-x64`);
mkdirSync(releaseRoot, { recursive: true });
writeFileSync(join(releaseRoot, "forge614-engines.exe"), `fake binary content for ${fakeVersion}\n`);
writeFileSync(join(releaseRoot, "package.json"), JSON.stringify({ version: fakeVersion }));

const archivePath = join(workDir, assetName);
execFileSync("tar", ["-czf", archivePath, "-C", workDir, `forge614-engines-${fakeVersion}-windows-x64`]);
const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/release") {
      return Response.json({
        tag_name: `v${fakeVersion}`,
        assets: [
          { name: assetName, browser_download_url: `http://127.0.0.1:${server.port}/${assetName}` },
          { name: `${assetName}.sha256`, browser_download_url: `http://127.0.0.1:${server.port}/${assetName}.sha256` },
        ],
      });
    }
    if (url.pathname === `/${assetName}`) return new Response(readFileSync(archivePath));
    if (url.pathname === `/${assetName}.sha256`) return new Response(`${checksum}  ${assetName}\n`);
    return new Response("not found", { status: 404 });
  },
});

console.log(`Fixture server on http://127.0.0.1:${server.port}, spawning the real launcher: ${launcherPath}`);

const child = spawn(launcherPath, ["update"], {
  env: { ...process.env, FORGE614_HOME: forgeHome, FORGE614_RELEASE_API_URL: `http://127.0.0.1:${server.port}/release` },
  stdio: ["ignore", "pipe", "inherit"],
});

let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});

const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
console.log(`Launcher process exited with code ${exitCode}`);
if (exitCode !== 0) {
  server.stop(true);
  process.exit(1);
}

let logPath;
try {
  const match = JSON.parse(stdout).result?.note?.match(/Helper log: (.+)$/);
  logPath = match?.[1]?.trim();
} catch {
  // Fall through — diagnostics below don't depend on this.
}

const deadline = Date.now() + 15_000;
let content = "";
while (Date.now() < deadline) {
  if (existsSync(launcherPath)) {
    content = readFileSync(launcherPath, "utf8");
    if (content === `fake binary content for ${fakeVersion}\n`) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

server.stop(true);

if (content !== `fake binary content for ${fakeVersion}\n`) {
  console.error(`Launcher was not swapped to the new version within the timeout. Current content: ${JSON.stringify(content)}`);
  if (logPath && existsSync(logPath)) {
    console.error(`--- swap helper log (${logPath}) ---`);
    console.error(readFileSync(logPath, "utf8"));
  } else {
    console.error(`No helper log found at ${logPath ?? "(unknown path)"}.`);
  }
  process.exit(1);
}

console.log("Self-update swap verified: the running launcher replaced itself with the new version.");
