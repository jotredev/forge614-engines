import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests run the real scripts/install.sh against a fake release served
// from 127.0.0.1. The installer is bash-only, and the "Windows checks" job also
// runs `bun test`, so the whole suite is skipped there.

const VERSION = "9.9.9";
const MISSING_ASSET_MESSAGE = (target: string) => `Latest release is missing a Forge614 Engines asset for ${target}.`;
const installScript = join(import.meta.dir, "install.sh");

/** Programs install.sh must find on PATH; the run fails fast if one is missing on this machine. */
const REQUIRED_TOOLS = ["curl", "tar", "mktemp", "rm", "uname", "basename", "find", "mkdir", "mv", "ln", "readlink", "grep", "sed"];
/** Programs install.sh uses only when present (checksum tools, and gzip that GNU tar spawns). */
const OPTIONAL_TOOLS = ["shasum", "sha256sum", "gzip"];

const platform = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const target = `${platform}-${arch}`;
const archiveName = `forge614-engines-${VERSION}-${target}.tar.gz`;

/** Resolves a program from the normal PATH or fails the test setup with its name. */
function requireProgram(name: string): string {
  const found = Bun.which(name);
  if (!found) throw new Error(`The installer test needs "${name}" on PATH.`);
  return found;
}

/**
 * Builds a directory that is the ONLY entry of PATH for the installer, holding
 * symlinks to the programs install.sh uses and a python3 wrapper that records
 * every call in `marker` before running the real Python.
 *
 * @param dir Where to create the tool directory.
 * @param marker File that the python3 wrapper appends a line to on each call.
 * @param withNode Whether to also link the real `node`.
 */
function makeToolDir(dir: string, marker: string, withNode: boolean): string {
  mkdirSync(dir, { recursive: true });
  for (const name of REQUIRED_TOOLS) symlinkSync(requireProgram(name), join(dir, name));
  for (const name of OPTIONAL_TOOLS) {
    const found = Bun.which(name);
    if (found) symlinkSync(found, join(dir, name));
  }
  if (withNode) symlinkSync(requireProgram("node"), join(dir, "node"));
  const realPython = existsSync("/usr/bin/python3") ? "/usr/bin/python3" : requireProgram("python3");
  const wrapper = join(dir, "python3");
  writeFileSync(wrapper, `#!/bin/sh\necho called >> "${marker}"\nexec "${realPython}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  return dir;
}

/**
 * Packs a minimal fake release (a package.json and an executable) into
 * `<archiveName>` plus its `.sha256` file, in the format `shasum -c` accepts.
 *
 * @param stage Scratch directory used to assemble the release.
 * @param dist Directory where the archive and checksum are written.
 */
function buildRelease(stage: string, dist: string): void {
  const folder = `forge614-engines-${VERSION}-${target}`;
  mkdirSync(join(stage, folder), { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(stage, folder, "package.json"), JSON.stringify({ version: VERSION }));
  const binary = join(stage, folder, "forge614-engines");
  writeFileSync(binary, "#!/bin/sh\necho forge614-engines\n");
  chmodSync(binary, 0o755);
  const packed = Bun.spawnSync([requireProgram("tar"), "-czf", join(dist, archiveName), "-C", stage, folder]);
  if (packed.exitCode !== 0) throw new Error(`tar failed: ${packed.stderr.toString()}`);
  const hex = createHash("sha256").update(readFileSync(join(dist, archiveName))).digest("hex");
  writeFileSync(join(dist, `${archiveName}.sha256`), `${hex}  ${archiveName}\n`);
}

describe.skipIf(process.platform === "win32")("scripts/install.sh --latest", () => {
  let root: string;
  let server: ReturnType<typeof Bun.serve>;
  let release: unknown;
  let noNodeDir: string;
  let withNodeDir: string;
  const marker = () => join(root, "python3-called");

  /** Release JSON whose asset URLs point at the local server unless `archiveUrl` overrides the archive one. */
  function releaseJson(tag: string, archiveUrl?: string): unknown {
    const base = `http://127.0.0.1:${server.port}/dl`;
    return {
      tag_name: tag,
      assets: [
        { name: archiveName, browser_download_url: archiveUrl ?? `${base}/${archiveName}` },
        { name: `${archiveName}.sha256`, browser_download_url: `${base}/${archiveName}.sha256` },
      ],
    };
  }

  /**
   * Runs install.sh with a controlled environment (temporary HOME and
   * FORGE614_HOME, PATH limited to `toolDir`) and a hard timeout.
   *
   * @returns The exit code, both output streams and the FORGE614_HOME used.
   */
  async function runInstaller(toolDir: string) {
    const forgeHome = mkdtempSync(join(root, "home-"));
    const proc = Bun.spawn(["/bin/bash", installScript], {
      env: { HOME: forgeHome, FORGE614_HOME: forgeHome, FORGE614_RELEASE_API_URL: `http://127.0.0.1:${server.port}/release`, PATH: toolDir },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, stdout, stderr, forgeHome };
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "forge614-install-test-"));
    const dist = join(root, "dist");
    buildRelease(join(root, "stage"), dist);
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/release") return Response.json(release);
        if (path.startsWith("/dl/")) {
          const file = Bun.file(join(dist, path.slice("/dl/".length)));
          return new Response(file);
        }
        return new Response("not found", { status: 404 });
      },
    });
    noNodeDir = makeToolDir(join(root, "bin-no-node"), marker(), false);
    withNodeDir = makeToolDir(join(root, "bin-with-node"), marker(), true);
  });

  afterAll(() => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(marker(), { force: true });
    release = releaseJson(`v${VERSION}`);
  });

  test("the tool directory really has no node", () => {
    expect(Bun.which("node", { PATH: noNodeDir })).toBeNull();
  });

  test("a. without Node, the python3 fallback reads the release and installs it", async () => {
    const result = await runInstaller(noNodeDir);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const active = join(result.forgeHome, "engines", "bin", "forge614-engines");
    expect(result.stdout).toContain(`Installed Forge614 Engines v${VERSION} at ${active}`);
    expect(readlinkSync(active)).toBe(join(result.forgeHome, "engines", VERSION, "forge614-engines"));
    expect(existsSync(marker())).toBe(true);
  });

  test.skipIf(!Bun.which("node"))("b. with Node, the release is read by Node and python3 is never called", async () => {
    const result = await runInstaller(withNodeDir);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const active = join(result.forgeHome, "engines", "bin", "forge614-engines");
    expect(result.stdout).toContain(`Installed Forge614 Engines v${VERSION} at ${active}`);
    expect(existsSync(marker())).toBe(false);
  });

  for (const badUrl of [`file:///tmp/${archiveName}`, `ftp://127.0.0.1/${archiveName}`]) {
    test(`c. without Node, a ${badUrl.split(":")[0]}:// download URL is rejected`, async () => {
      release = releaseJson(`v${VERSION}`, badUrl);
      const result = await runInstaller(noNodeDir);
      expect(result.code).toBe(65);
      expect(result.stderr.trim()).toBe(MISSING_ASSET_MESSAGE(target));
      expect(existsSync(join(result.forgeHome, "engines", "bin"))).toBe(false);
    });

    test.skipIf(!Bun.which("node"))(`c. with Node, a ${badUrl.split(":")[0]}:// download URL is rejected`, async () => {
      release = releaseJson(`v${VERSION}`, badUrl);
      const result = await runInstaller(withNodeDir);
      expect(result.code).toBe(65);
      expect(result.stderr.trim()).toBe(MISSING_ASSET_MESSAGE(target));
      expect(existsSync(join(result.forgeHome, "engines", "bin"))).toBe(false);
    });
  }

  test("d. without Node, a tag_name that is not a version is rejected", async () => {
    release = releaseJson("v9.9");
    const result = await runInstaller(noNodeDir);
    expect(result.code).toBe(65);
    expect(result.stderr.trim()).toBe(MISSING_ASSET_MESSAGE(target));
  });
});
