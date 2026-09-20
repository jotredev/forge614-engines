import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enginesRoot, performUpdate, platformArch, UpdateAssetMissingError } from "./self-update";
import pkg from "../../package.json";

let workDir: string;
let home: string;
let server: ReturnType<typeof Bun.serve> | undefined;
let previousApiUrl: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "engines-selfupdate-"));
  home = join(workDir, "home");
  mkdirSync(home);
  previousApiUrl = process.env.FORGE614_RELEASE_API_URL;
});

afterEach(() => {
  server?.stop(true);
  server = undefined;
  rmSync(workDir, { recursive: true, force: true });
  if (previousApiUrl === undefined) delete process.env.FORGE614_RELEASE_API_URL;
  else process.env.FORGE614_RELEASE_API_URL = previousApiUrl;
});

/** Builds a real, valid release archive (same layout release-bundle.mjs produces) for the given version, and serves it plus a fake GitHub "latest release" API response over a local HTTP server. Returns the API URL to point FORGE614_RELEASE_API_URL at. */
function serveFakeRelease(version: string, opts: { corruptChecksum?: boolean; omitAsset?: boolean } = {}): string {
  const { platform, arch, exeSuffix } = platformArch();
  const releaseName = `forge614-engines-${version}-${platform}-${arch}`;
  const assetName = `${releaseName}.tar.gz`;

  const stagingRoot = join(workDir, "staging");
  const releaseRoot = join(stagingRoot, releaseName);
  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(join(releaseRoot, `forge614-engines${exeSuffix}`), "#!/bin/sh\necho fake\n");
  writeFileSync(join(releaseRoot, "package.json"), JSON.stringify({ version }));

  const archivePath = join(workDir, assetName);
  execFileSync("tar", ["-czf", archivePath, "-C", stagingRoot, releaseName]);
  const realChecksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  const checksum = opts.corruptChecksum ? "0".repeat(64) : realChecksum;

  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/release") {
        const assets = opts.omitAsset
          ? []
          : [
              { name: assetName, browser_download_url: `http://localhost:${server!.port}/${assetName}` },
              { name: `${assetName}.sha256`, browser_download_url: `http://localhost:${server!.port}/${assetName}.sha256` },
            ];
        return Response.json({ tag_name: `v${version}`, assets });
      }
      if (url.pathname === `/${assetName}`) {
        return new Response(readFileSync(archivePath));
      }
      if (url.pathname === `/${assetName}.sha256`) {
        return new Response(`${checksum}  ${assetName}\n`);
      }
      return new Response("not found", { status: 404 });
    },
  });

  return `http://localhost:${server.port}/release`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** On Windows the active launcher is swapped by a detached background helper (see scheduleWindowsSwap in self-update.ts) since the launcher can't overwrite itself while running — poll for it to finish instead of asserting synchronously. */
async function waitForFileContent(path: string, expected: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      last = readFileSync(path, "utf8");
      if (last === expected) return last;
    }
    await sleep(100);
  }
  return last;
}

describe("performUpdate", () => {
  test("is a noop when the latest release is already the running version", async () => {
    process.env.FORGE614_RELEASE_API_URL = serveFakeRelease(pkg.version);

    const result = await performUpdate(home);

    expect(result).toEqual({ updated: false, currentVersion: pkg.version, latestVersion: pkg.version });
  });

  test("downloads, verifies, and activates a newer version", async () => {
    const newVersion = "9999.0.0";
    process.env.FORGE614_RELEASE_API_URL = serveFakeRelease(newVersion);

    const result = await performUpdate(home);

    expect(result.updated).toBe(true);
    expect(result.currentVersion).toBe(pkg.version);
    expect(result.latestVersion).toBe(newVersion);

    const root = enginesRoot(home);
    const { exeSuffix } = platformArch();
    const activeVersionFile = join(root, ".active-version");

    if (process.platform === "win32") {
      // The launcher can't be overwritten by the process currently running
      // from it, so the real swap finishes via a detached background helper
      // (scheduleWindowsSwap) a moment after performUpdate returns — this is
      // genuinely exercised here since `bun test` on windows-latest CI runs
      // as a real Windows process, spawning a real detached powershell.exe.
      const active = await waitForFileContent(activeVersionFile, newVersion, 15_000);
      expect(active).toBe(newVersion);

      const launcherPath = join(root, "bin", `forge614-engines${exeSuffix}`);
      const newBinaryPath = join(root, newVersion, `forge614-engines${exeSuffix}`);
      expect(readFileSync(launcherPath, "utf8")).toBe(readFileSync(newBinaryPath, "utf8"));
    } else {
      const launcherPath = join(root, "bin", `forge614-engines${exeSuffix}`);
      const linkTarget = readlinkSync(launcherPath);
      expect(linkTarget).toBe(join(root, newVersion, `forge614-engines${exeSuffix}`));
      expect(readFileSync(activeVersionFile, "utf8")).toBe(newVersion);
    }
  }, 20_000);

  test("throws UpdateAssetMissingError when the latest release has no asset for this platform/arch", async () => {
    const newVersion = "9999.0.0";
    process.env.FORGE614_RELEASE_API_URL = serveFakeRelease(newVersion, { omitAsset: true });

    await expect(performUpdate(home)).rejects.toThrow(UpdateAssetMissingError);
  });

  test("refuses to activate a download whose checksum does not match", async () => {
    const newVersion = "9999.0.0";
    process.env.FORGE614_RELEASE_API_URL = serveFakeRelease(newVersion, { corruptChecksum: true });

    await expect(performUpdate(home)).rejects.toThrow("checksum failed");

    const root = enginesRoot(home);
    expect(() => readFileSync(join(root, ".active-version"), "utf8")).toThrow();
  });
});

describe("platformArch", () => {
  test("maps win32 to windows with a .exe suffix", () => {
    expect(platformArch("win32", "x64")).toEqual({ platform: "windows", arch: "x64", exeSuffix: ".exe" });
  });

  test("maps darwin/linux with no suffix", () => {
    expect(platformArch("darwin", "arm64")).toEqual({ platform: "darwin", arch: "arm64", exeSuffix: "" });
    expect(platformArch("linux", "x64")).toEqual({ platform: "linux", arch: "x64", exeSuffix: "" });
  });

  test("defaults unrecognized arches to x64", () => {
    expect(platformArch("linux", "ia32")).toEqual({ platform: "linux", arch: "x64", exeSuffix: "" });
  });
});
