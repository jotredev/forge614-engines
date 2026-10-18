import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json";

const workersSource = process.env.FORGE614_WORKERS_SOURCE;
const root = mkdtempSync(join(tmpdir(), "engines-workers-dependency-e2e-"));
const assets = new Map<string, Uint8Array>();
const releaseAssets = new Map<string, Uint8Array>();
const requests: string[] = [];
const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
let server: ReturnType<typeof Bun.serve>;

/** Returns one GNU SHA-256 manifest entry. */
function manifestLine(name: string, bytes: Uint8Array): string {
  return `${createHash("sha256").update(bytes).digest("hex")}  ${name}`;
}

/** Builds the real Workers 1.1.0 binary and stages its local release assets. */
function stageWorkers(): void {
  if (!workersSource) throw new Error("FORGE614_WORKERS_SOURCE is required for this opt-in E2E.");
  const manifest = JSON.parse(readFileSync(join(workersSource, "package.json"), "utf8")) as { version: string };
  if (manifest.version !== "1.1.0") throw new Error(`Expected Workers 1.1.0, received ${manifest.version}.`);
  const executableName = `forge614-workers${platform === "windows" ? ".exe" : ""}`;
  const executable = join(root, executableName);
  const built = Bun.spawnSync(["bun", "build", "./src/main.ts", "--compile", `--target=bun-${platform}-${arch}`, `--outfile=${executable}`], { cwd: workersSource });
  if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  const pointer = new Uint8Array(readFileSync(join(workersSource, "forge614.node.json")));
  const installer = new Uint8Array(readFileSync(join(workersSource, "install.mjs")));
  const name = `forge614-workers-${platform}-${arch}${platform === "windows" ? ".exe" : ""}`;
  const binary = new Uint8Array(readFileSync(executable));
  const files = new Map<string, Uint8Array>([
    ["install.mjs", installer],
    ["forge614.node.json", pointer],
    [name, binary],
  ]);
  const sums = [...files].map(([file, bytes]) => manifestLine(file, bytes)).sort().join("\n") + "\n";
  files.set("SHA256SUMS", new Uint8Array(Buffer.from(sums)));
  for (const [file, bytes] of files) releaseAssets.set(`v1.1.0/${file}`, bytes);
}

/** Builds a real Engines release archive compatible with the shared installer. */
function stageEngines(): void {
  const packageDir = `forge614-engines-${pkg.version}-${platform}-${arch}`;
  const stage = join(root, "engines-stage");
  const packagePath = join(stage, packageDir);
  mkdirSync(packagePath, { recursive: true });
  const executable = join(packagePath, `forge614-engines${platform === "windows" ? ".exe" : ""}`);
  const built = Bun.spawnSync(["bun", "build", "./src/interfaces/cli/main.ts", "--compile", `--target=bun-${platform}-${arch}`, `--outfile=${executable}`], { cwd: process.cwd() });
  if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  copyFileSync("package.json", join(packagePath, "package.json"));
  const archiveName = `${packageDir}.tar.gz`;
  const archivePath = join(root, archiveName);
  const packed = Bun.spawnSync(["tar", "-czf", archivePath, "-C", stage, packageDir]);
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  const archive = new Uint8Array(readFileSync(archivePath));
  const sidecar = `${manifestLine(archiveName, archive)}\n`;
  writeFileSync(`${archivePath}.sha256`, sidecar);
  const files = new Map<string, Uint8Array>([
    ["install.sh", new Uint8Array(readFileSync("install.sh"))],
    ["install.ps1", new Uint8Array(readFileSync("install.ps1"))],
    ["install.mjs", new Uint8Array(readFileSync("install.mjs"))],
    ["forge614.node.json", new Uint8Array(readFileSync("forge614.node.json"))],
    [archiveName, archive],
    [`${archiveName}.sha256`, new Uint8Array(Buffer.from(sidecar))],
  ]);
  const sums = [...files].map(([file, bytes]) => manifestLine(file, bytes)).sort().join("\n") + "\n";
  files.set("SHA256SUMS", new Uint8Array(Buffer.from(sums)));
  for (const [file, bytes] of files) assets.set(`v${pkg.version}/${file}`, bytes);
}

/** Starts a loopback release server for both repositories. */
beforeAll(() => {
  if (!workersSource) return;
  stageEngines();
  stageWorkers();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname);
      if (url.pathname === "/repos/jotredev/forge614-workers/releases/latest") return Response.json({ tag_name: "v1.1.0" });
      if (url.pathname === "/repos/jotredev/forge614-engines/releases/latest") return Response.json({ tag_name: `v${pkg.version}` });
      const match = /^\/repos\/jotredev\/(forge614-(?:engines|workers))\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (!match) return new Response("not found", { status: 404 });
      const [, repo, tag, file] = match;
      const source = repo === "forge614-engines" ? assets : releaseAssets;
      const bytes = source.get(`${tag}/${decodeURIComponent(file!)}`);
      return bytes ? new Response(Buffer.from(bytes)) : new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("Workers 1.1.0 dependency installation", () => {
  test.skipIf(!workersSource)("installs real Engines and Workers from an empty FORGE614_HOME using loopback releases", async () => {
    const home = join(root, "empty-home");
    const forgeHome = join(home, ".forge614");
    mkdirSync(home, { recursive: true });
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
      value !== undefined && !["http_proxy", "https_proxy", "all_proxy"].includes(key.toLowerCase()),
    )) as Record<string, string>;
    if (process.platform === "win32") {
      const path = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1];
      for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
      if (path !== undefined) env.Path = path;
    }
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      FORGE614_HOME: forgeHome,
      FORGE614_INSTALL_TEST_BASE_URL: `http://127.0.0.1:${server.port}`,
      FORGE614_INSTALL_REPOSITORY: "jotredev/forge614-workers",
      FORGE614_INSTALL_NODE: "workers",
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    });
    const child = Bun.spawn(["node", join(workersSource!, "install.mjs"), "--latest"], { cwd: workersSource, env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (status !== 0) throw new Error(`Workers installer failed (${status}): ${stderr}${stdout} Requests: ${requests.join(", ")}`);
    const engine = join(forgeHome, "engines", "bin", `forge614-engines${platform === "windows" ? ".exe" : ""}`);
    const workers = join(forgeHome, "workers", "bin", `forge614-workers${platform === "windows" ? ".exe" : ""}`);
    expect(existsSync(engine)).toBe(true);
    expect(existsSync(workers)).toBe(true);
    expect(Bun.spawnSync([engine, "--version"], { env, stdout: "pipe" }).stdout.toString().trim()).toBe(`forge614-engines ${pkg.version}`);
    expect(Bun.spawnSync([workers, "--version"], { env, stdout: "pipe" }).stdout.toString().trim()).toBe("forge614-workers 1.1.0");
    const capability = Bun.spawnSync([engine, "capabilities", "--agent", "claude-code"], { env, stdout: "pipe" });
    expect(JSON.parse(capability.stdout.toString())).toMatchObject({ schemaVersion: 1, supportsReadOnly: true });
  }, 120_000);
});
