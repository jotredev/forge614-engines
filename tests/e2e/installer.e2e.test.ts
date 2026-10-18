import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json";

const root = mkdtempSync(join(tmpdir(), "engines-installer-e2e-"));
const release = join(root, "release");
const assetVersion = pkg.version;
const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
let server: ReturnType<typeof Bun.serve>;
let published = new Map<string, Uint8Array>();
let legacySourceRoot: string;

/** Returns a GNU SHA-256 line for a local release asset. */
function manifestLine(name: string, bytes: Uint8Array): string {
  return `${createHash("sha256").update(bytes).digest("hex")}  ${name}`;
}

/** Compiles a real target executable and stages a checksummed local release. */
function stageRelease(version: string, sourceRoot = process.cwd()): void {
  const packageDir = `forge614-engines-${version}-${platform}-${arch}`;
  const stageRoot = join(root, `stage-${version}`);
  const packagePath = join(stageRoot, packageDir);
  mkdirSync(packagePath, { recursive: true });
  const executable = join(packagePath, `forge614-engines${platform === "windows" ? ".exe" : ""}`);
  const target = `bun-${platform}-${arch}`;
  const build = Bun.spawnSync(["bun", "build", "./src/interfaces/cli/main.ts", "--compile", `--target=${target}`, `--outfile=${executable}`], { cwd: sourceRoot });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  copyFileSync(join(sourceRoot, "package.json"), join(packagePath, "package.json"));
  mkdirSync(release, { recursive: true });
  const archiveName = `forge614-engines-${version}-${platform}-${arch}.tar.gz`;
  const archivePath = join(release, archiveName);
  const packed = Bun.spawnSync(["tar", "-czf", archivePath, "-C", stageRoot, packageDir]);
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  const archiveBytes = readFileSync(archivePath);
  const sidecar = `${manifestLine(archiveName, archiveBytes)}\n`;
  writeFileSync(`${archivePath}.sha256`, sidecar);
  const prefix = `v${version}/`;
  const assets = new Map<string, Uint8Array>([
    [`${prefix}install.sh`, new Uint8Array(readFileSync("install.sh"))],
    [`${prefix}install.ps1`, new Uint8Array(readFileSync("install.ps1"))],
    [`${prefix}install.mjs`, new Uint8Array(readFileSync("install.mjs"))],
    [`${prefix}forge614.node.json`, new Uint8Array(readFileSync("forge614.node.json"))],
    [`${prefix}${archiveName}`, new Uint8Array(archiveBytes)],
    [`${prefix}${archiveName}.sha256`, new Uint8Array(readFileSync(`${archivePath}.sha256`))],
  ]);
  const sums = [...assets].map(([name, bytes]) => manifestLine(name.slice(prefix.length), bytes)).sort().join("\n") + "\n";
  assets.set(`${prefix}SHA256SUMS`, new Uint8Array(Buffer.from(sums)));
  for (const [name, bytes] of assets) published.set(name, bytes);
}

/** Builds a second real target from a temporary source copy with its own version. */
function stageNextVersion(): void {
  const sourceRoot = join(root, "source-1.18.1");
  mkdirSync(sourceRoot, { recursive: true });
  cpSync("src", join(sourceRoot, "src"), { recursive: true });
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
  manifest.version = "1.18.1";
  writeFileSync(join(sourceRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  symlinkSync(join(process.cwd(), "node_modules"), join(sourceRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  stageRelease("1.18.1", sourceRoot);
}

/** Compiles the actual 1.17.1 source tag into a temporary legacy release archive. */
function stageLegacy1171(): string {
  const sourceRoot = join(root, "source-1.17.1");
  const archive = join(root, "source-1.17.1.tar");
  mkdirSync(sourceRoot, { recursive: true });
  const packedSource = Bun.spawnSync(["git", "archive", "--format=tar", "251e32a"], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  if (packedSource.exitCode !== 0) throw new Error(packedSource.stderr.toString());
  writeFileSync(archive, packedSource.stdout);
  const unpacked = Bun.spawnSync(["tar", "-xf", archive, "-C", sourceRoot], { stdout: "pipe", stderr: "pipe" });
  if (unpacked.exitCode !== 0) throw new Error(unpacked.stderr.toString());
  symlinkSync(join(process.cwd(), "node_modules"), join(sourceRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const packageDir = `forge614-engines-1.17.1-${platform}-${arch}`;
  const stageRoot = join(root, "stage-1.17.1");
  const packagePath = join(stageRoot, packageDir);
  mkdirSync(packagePath, { recursive: true });
  const executable = join(packagePath, `forge614-engines${platform === "windows" ? ".exe" : ""}`);
  const built = Bun.spawnSync(["bun", "build", "./src/interfaces/cli/main.ts", "--compile", `--target=bun-${platform}-${arch}`, `--outfile=${executable}`], { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" });
  if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  copyFileSync(join(sourceRoot, "package.json"), join(packagePath, "package.json"));
  mkdirSync(release, { recursive: true });
  const name = `${packageDir}.tar.gz`;
  const path = join(release, name);
  const packed = Bun.spawnSync(["tar", "-czf", path, "-C", stageRoot, packageDir], { stdout: "pipe", stderr: "pipe" });
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  const bytes = readFileSync(path);
  writeFileSync(`${path}.sha256`, `${manifestLine(name, bytes)}\n`);
  published.set(`v1.17.1/${name}`, new Uint8Array(bytes));
  published.set(`v1.17.1/${name}.sha256`, new Uint8Array(readFileSync(`${path}.sha256`)));
  return sourceRoot;
}

/** Serves legacy release metadata with asset links that stay on the loopback server. */
function legacyMetadata(origin: string, version: string): Response {
  const name = `forge614-engines-${version}-${platform}-${arch}.tar.gz`;
  return Response.json({
    tag_name: `v${version}`,
    assets: [name, `${name}.sha256`].map((file) => ({ name: file, browser_download_url: `${origin}/assets/v${version}/${file}` })),
  });
}

/** Invokes the platform gatekeeper with temporary user and Forge614 homes. */
async function runInstaller(home: string, baseUrl: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const merged = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614"), FORGE614_INSTALL_TEST_BASE_URL: baseUrl, FORGE614_LOCALE: "en" };
  const env = process.platform === "win32"
    ? Object.fromEntries(Object.entries(merged).filter(([key]) => key.toLocaleLowerCase("en-US") !== "path").concat(
        Object.entries(merged).filter(([key]) => key.toLocaleLowerCase("en-US") === "path").slice(0, 1).map(([, value]) => ["Path", value]),
      ))
    : merged;
  const command = process.platform === "win32"
    ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "install.ps1"]
    : ["sh", "install.sh"];
  const result = Bun.spawn(command, { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
  const [stdout, stderr, status] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  return { status, stdout, stderr };
}

/** Installs the 1.17.1 fixture with its original installer and a local release API. */
async function runLegacyInstaller(home: string, origin: string): Promise<{ status: number; stdout: string; stderr: string }> {
  const env = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614"), FORGE614_RELEASE_API_URL: `${origin}/api/legacy-install` };
  const args = process.platform === "win32"
    ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(legacySourceRoot, "scripts", "install.ps1"), "-Latest"]
    : ["bash", join(legacySourceRoot, "scripts", "install.sh"), "--latest"];
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
}

/** Runs an installed legacy launcher until its active binary reports the requested version. */
async function waitForLegacyUpdate(launcher: string, version: string, home: string): Promise<boolean> {
  const env = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614") };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = Bun.spawnSync([launcher, "--version"], { env, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0 && result.stdout.toString().trim() === `forge614-engines ${version}`) return true;
    await Bun.sleep(250);
  }
  return false;
}

/** Runs the installed CLI from a selected directory with isolated user homes. */
async function runInstalledCli(launcher: string, args: string[], home: string, cwd: string, extra: Record<string, string> = {}): Promise<{ status: number; stdout: string; stderr: string }> {
  const merged = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614"), ...extra };
  const env = process.platform === "win32"
    ? Object.fromEntries(Object.entries(merged).filter(([key]) => key.toLocaleLowerCase("en-US") !== "path").concat(
        Object.entries(merged).filter(([key]) => key.toLocaleLowerCase("en-US") === "path").slice(0, 1).map(([, value]) => ["Path", value]),
      ))
    : merged;
  const child = Bun.spawn([launcher, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(120_000),
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
}

beforeAll(() => {
  stageRelease(assetVersion);
  stageNextVersion();
  legacySourceRoot = stageLegacy1171();
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/releases/latest")) return Response.json({ tag_name: `v${assetVersion}` });
      if (path === "/api/legacy-install") return legacyMetadata(new URL(request.url).origin, "1.17.1");
      if (path === "/api/legacy-update") return legacyMetadata(new URL(request.url).origin, assetVersion);
      const marker = "/releases/download/";
      const assetMarker = "/assets/";
      const key = path.includes(marker)
        ? decodeURIComponent(path.slice(path.indexOf(marker) + marker.length))
        : path.includes(assetMarker) ? decodeURIComponent(path.slice(path.indexOf(assetMarker) + assetMarker.length)) : "";
      const bytes = published.get(key);
      return bytes ? new Response(Buffer.from(bytes)) : new Response("not found", { status: 404 });
    },
  });
}, { timeout: 120_000 });

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("shared installer end to end", () => {
  test("installs locally and updates to a real binary compiled with the next version", async () => {
    const home = mkdtempSync(join(root, "user-home-"));
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const result = await runInstaller(home, baseUrl);
    const launcher = join(home, ".forge614", "engines", "bin", `forge614-engines${platform === "windows" ? ".exe" : ""}`);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(launcher)).toBe(true);
    const version = Bun.spawnSync([launcher, "--version"], { env: { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614") }, stdout: "pipe", stderr: "pipe" });
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString().trim()).toBe(`forge614-engines ${assetVersion}`);
    const update = Bun.spawn([launcher, "update", "--version", "1.18.1"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614"), FORGE614_INSTALL_TEST_BASE_URL: baseUrl },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(120_000),
    });
    const [updateOut, updateErr, updateCode] = await Promise.all([
      new Response(update.stdout).text(),
      new Response(update.stderr).text(),
      update.exited,
    ]);
    expect(updateCode).toBe(0);
    expect(updateErr).toBe("");
    expect(JSON.parse(updateOut).result).toMatchObject({ currentVersion: assetVersion, latestVersion: "1.18.1", installedVersion: "1.18.1" });
    const upgraded = Bun.spawnSync([launcher, "--version"], { env: { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614") }, stdout: "pipe", stderr: "pipe" });
    expect(upgraded.exitCode).toBe(0);
    expect(upgraded.stdout.toString().trim()).toBe("forge614-engines 1.18.1");
    rmSync(home, { recursive: true, force: true });
  }, 120_000);

  test("migrates the real 1.17.1 installer layout through 1.18.0 and into 1.18.1", async () => {
    const home = mkdtempSync(join(root, "legacy-user-home-"));
    const origin = `http://127.0.0.1:${server.port}`;
    const legacyInstall = await runLegacyInstaller(home, origin);
    const forgeHome = join(home, ".forge614");
    const launcher = join(forgeHome, "engines", "bin", `forge614-engines${platform === "windows" ? ".exe" : ""}`);
    expect(legacyInstall.status).toBe(0);
    expect(legacyInstall.stderr).toBe("");
    const oldVersion = Bun.spawnSync([launcher, "--version"], { env: { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: forgeHome }, stdout: "pipe", stderr: "pipe" });
    expect(oldVersion.stdout.toString().trim()).toBe("forge614-engines 1.17.1");

    const oldUpdate = Bun.spawn([launcher, "update"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: forgeHome, FORGE614_RELEASE_API_URL: `${origin}/api/legacy-update` },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(120_000),
    });
    const [oldUpdateOut, oldUpdateErr, oldUpdateCode] = await Promise.all([
      new Response(oldUpdate.stdout).text(),
      new Response(oldUpdate.stderr).text(),
      oldUpdate.exited,
    ]);
    expect(oldUpdateCode).toBe(0);
    expect(oldUpdateErr).toBe("");
    expect(JSON.parse(oldUpdateOut).result).toMatchObject({ updated: true, currentVersion: "1.17.1", latestVersion: assetVersion });
    expect(await waitForLegacyUpdate(launcher, assetVersion, home)).toBe(true);
    const activeVersion = join(forgeHome, "engines", ".active-version");
    // The actual 1.17.1 updater writes .active-version on every platform; the
    // shared installer therefore replaces the same version directory in place.
    expect(readFileSync(activeVersion, "utf8").trim()).toBe(assetVersion);

    const secondUpdate = Bun.spawn([launcher, "update", "--version", "1.18.1"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: forgeHome, FORGE614_INSTALL_TEST_BASE_URL: origin },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(120_000),
    });
    const [secondOut, secondErr, secondCode] = await Promise.all([
      new Response(secondUpdate.stdout).text(),
      new Response(secondUpdate.stderr).text(),
      secondUpdate.exited,
    ]);
    expect(secondCode).toBe(0);
    expect(secondErr).toBe("");
    expect(JSON.parse(secondOut).result).toMatchObject({ currentVersion: assetVersion, latestVersion: "1.18.1", installedVersion: "1.18.1" });
    const migrated = Bun.spawnSync([launcher, "--version"], { env: { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: forgeHome }, stdout: "pipe", stderr: "pipe" });
    expect(migrated.stdout.toString().trim()).toBe("forge614-engines 1.18.1");
    expect(readFileSync(activeVersion, "utf8").trim()).toBe("1.18.1");

    const workersBin = join(forgeHome, "workers", "bin");
    mkdirSync(workersBin, { recursive: true });
    writeFileSync(join(workersBin, "forge614-workers"), "fixture");
    const engram = join(forgeHome, "engram", "bin", `forge614-engram${platform === "windows" ? ".exe" : ""}`);
    const claudeCommand = `"${launcher}" memory-hook-run --agent claude-code`;
    const codexCommand = `"${launcher}" memory-hook-run --agent codex`;
    const mcpForeign = '  "otherServer" : { "command" : "other", "args" : ["keep"] },';
    const mcpConfig = join(home, ".claude.json");
    mkdirSync(home, { recursive: true });
    const claudeMcpBefore = `{
  "custom" : { "exact" : "spacing stays" },
  "mcpServers" : {
${mcpForeign}
    "forge614-engram": { "command": ${JSON.stringify(engram)}, "args": ["mcp"] }
  }
}
`;
    writeFileSync(mcpConfig, claudeMcpBefore);
    const claudeSettingsPath = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    const claudeSettingsBefore = `{
  "permissions": { "allow": ["mcp__forge614-engram", "mcp__other"] },
  "hooks": { "SessionStart": [
    { "hooks": [{ "type": "command", "command": ${JSON.stringify(claudeCommand)} }] },
    { "matcher": "startup", "hooks": [{ "type": "command", "command": "/foreign/claude-hook" }] }
  ] },
  "foreign" : { "keep" : true }
}
`;
    writeFileSync(claudeSettingsPath, claudeSettingsBefore);
    const managedBlock = `Own Claude notes.\n\n<!-- forge614-engines:begin engram-memory-protocol -->\nmanaged instructions\n<!-- forge614-engines:end engram-memory-protocol -->\n\nKeep this sentence.\n`;
    const claudeManualPath = join(home, ".claude", "CLAUDE.md");
    writeFileSync(claudeManualPath, managedBlock);

    const codexConfigPath = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const codexConfigFull = `[mcp_servers.forge614-engram]\ncommand = ${JSON.stringify(engram)}\nargs = ["mcp"]\ndefault_tools_approval_mode = "approve"\n\n[mcp_servers.other]\ncommand = "other"\nargs = ["keep"]\n\n[hooks]\nSessionStart = [{ matcher = "^(startup|resume|clear|compact)$", hooks = [{ type = "command", command = '${codexCommand}', additionalContextLimit = 4000 }] }, { matcher = "startup", hooks = [{ type = "command", command = "/foreign/codex-hook" }] }]\n`;
    writeFileSync(codexConfigPath, codexConfigFull);
    const codexManualPath = join(home, ".codex", "AGENTS.md");
    writeFileSync(codexManualPath, managedBlock.replaceAll("Claude", "Codex"));
    const claudeBefore = readFileSync(mcpConfig, "utf8");
    const claudeSettingsRaw = readFileSync(claudeSettingsPath, "utf8");
    const claudeManualRaw = readFileSync(claudeManualPath, "utf8");
    const codexBefore = readFileSync(codexConfigPath, "utf8");
    const codexManualRaw = readFileSync(codexManualPath, "utf8");

    const blocked = await runInstalledCli(launcher, ["uninstall", "--json"], home, home);
    expect(blocked.status).toBe(1);
    expect(JSON.parse(blocked.stderr)).toMatchObject({ schemaVersion: 1, code: "DEPENDENT_NODES_INSTALLED" });
    expect(readFileSync(mcpConfig, "utf8")).toBe(claudeBefore);

    const fromInside = await runInstalledCli(launcher, ["uninstall", "--force", "--json"], home, join(forgeHome, "engines", "bin"));
    expect(fromInside.status).toBe(1);
    expect(JSON.parse(fromInside.stderr)).toMatchObject({ schemaVersion: 1, code: "UNINSTALL_FROM_INSTALLATION" });
    expect(readFileSync(claudeSettingsPath, "utf8")).toBe(claudeSettingsRaw);
    expect(readFileSync(codexConfigPath, "utf8")).toBe(codexBefore);

    const removed = await runInstalledCli(launcher, ["uninstall", "--force", "--json"], home, home, { FORGE614_INSTALL_TEST_BASE_URL: origin });
    expect(removed.status).toBe(0);
    expect(JSON.parse(removed.stdout).result).toMatchObject({ removed: true, dependents: ["workers"] });
    expect(existsSync(join(forgeHome, "engines"))).toBe(false);
    expect(existsSync(join(forgeHome, "workers"))).toBe(true);
    const claudeMcpAfter = readFileSync(mcpConfig, "utf8");
    const claudeSettingsAfter = readFileSync(claudeSettingsPath, "utf8");
    const claudeManualAfter = readFileSync(claudeManualPath, "utf8");
    const codexAfter = readFileSync(codexConfigPath, "utf8");
    const codexManualAfter = readFileSync(codexManualPath, "utf8");
    expect(claudeMcpAfter).toContain('  "otherServer" : { "command" : "other", "args" : ["keep"] }');
    expect(claudeSettingsAfter).toContain('{ "matcher": "startup", "hooks": [{ "type": "command", "command": "/foreign/claude-hook" }] }');
    expect(claudeSettingsAfter).toContain("/foreign/claude-hook");
    expect(claudeSettingsAfter).toContain("mcp__other");
    expect(claudeManualAfter).toContain("Own Claude notes.");
    expect(claudeManualAfter).toContain("Keep this sentence.");
    expect(claudeManualAfter).not.toContain("managed instructions");
    expect(codexAfter).toContain('[mcp_servers.other]\ncommand = "other"\nargs = ["keep"]');
    expect(codexAfter).toContain('{ matcher = "startup", hooks = [{ type = "command", command = "/foreign/codex-hook" }] }');
    expect(codexAfter).toContain("/foreign/codex-hook");
    expect(codexManualAfter).toContain("Own Codex notes.");
    expect(codexManualAfter).not.toContain("managed instructions");
    expect(claudeSettingsAfter.length).toBeGreaterThan(0);
    expect(claudeSettingsRaw).toContain('"foreign" : { "keep" : true }');
    expect(codexBefore).toContain('[mcp_servers.other]\ncommand = "other"\nargs = ["keep"]');
    rmSync(home, { recursive: true, force: true });
  }, 120_000);
});
