import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
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
    const newBinaryPath = join(root, newVersion, `forge614-engines${exeSuffix}`);

    // The new version is always extracted and staged synchronously,
    // regardless of platform — this part never depends on the launcher swap.
    expect(readFileSync(newBinaryPath, "utf8")).toBe(`#!/bin/sh\necho fake\n`);

    if (process.platform === "win32") {
      // The launcher can't be overwritten by the process currently running
      // from it, so the actual swap is finished by a detached background
      // helper (scheduleWindowsSwap) some time after this function returns.
      // There is no real lock to wait out in THIS test, though — performUpdate
      // is called in-process here, not run from the launcher file itself — so
      // waiting for the helper here would only prove the helper eventually
      // runs, not that it correctly handles a genuinely locked file. That
      // real scenario (a running forge614-engines.exe replacing itself) is
      // covered by scripts/verify-windows-self-update.mjs, invoked from a
      // dedicated step in .github/workflows/verify.yml's Windows job.
      expect(result.note).toContain("background");
    } else {
      const launcherPath = join(root, "bin", `forge614-engines${exeSuffix}`);
      const linkTarget = readlinkSync(launcherPath);
      expect(linkTarget).toBe(newBinaryPath);
      expect(readFileSync(join(root, ".active-version"), "utf8")).toBe(newVersion);
    }
  });

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
