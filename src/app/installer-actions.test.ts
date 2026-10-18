import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectInstalledDependents, uninstallEngines, updateEngines } from "./installer-actions";
import pkg from "../../package.json";

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("detectInstalledDependents", () => {
  test("detects managed node folders with an active version or launcher, plus Engram .bin-dir", () => {
    root = mkdtempSync(join(tmpdir(), "engines-dependents-"));
    const forgeHome = join(root, "forge614");
    mkdirSync(join(forgeHome, "shell"), { recursive: true });
    writeFileSync(join(forgeHome, "shell", ".active-version"), "1.0.0");
    mkdirSync(join(forgeHome, "workers", "bin"), { recursive: true });
    writeFileSync(join(forgeHome, "workers", "bin", "forge614-workers"), "");
    mkdirSync(join(forgeHome, "engram"), { recursive: true });
    writeFileSync(join(forgeHome, "engram", ".bin-dir"), "bin");

    expect(detectInstalledDependents({ FORGE614_HOME: forgeHome })).toEqual(["shell", "workers", "engram"]);
  });

  test("ignores incomplete directories without an installation marker", () => {
    root = mkdtempSync(join(tmpdir(), "engines-dependents-"));
    const forgeHome = join(root, "forge614");
    mkdirSync(join(forgeHome, "atlas"), { recursive: true });

    expect(detectInstalledDependents({ FORGE614_HOME: forgeHome })).toEqual([]);
  });
});

describe("updateEngines", () => {
  test("uses a loopback gatekeeper and reports the version read from the installed launcher", async () => {
    root = mkdtempSync(join(tmpdir(), "engines-update-"));
    const installer = [
      "#!/bin/sh",
      'mkdir -p "$FORGE614_HOME/engines/bin"',
      `printf '#!/bin/sh\\necho forge614-engines 1.18.2\\n' > "$FORGE614_HOME/engines/bin/forge614-engines"`,
      'chmod 755 "$FORGE614_HOME/engines/bin/forge614-engines"',
      "",
    ].join("\n");
    const digest = createHash("sha256").update(installer).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/releases/latest")) return Response.json({ tag_name: "v1.18.2" });
        if (path.endsWith("/install.sh")) return new Response(installer);
        if (path.endsWith("/SHA256SUMS")) return new Response(`${digest}  install.sh\n`);
        return new Response("missing", { status: 404 });
      },
    });
    try {
      const result = await updateEngines("1.18.2", {
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          FORGE614_HOME: join(root, "forge614"),
          FORGE614_INSTALL_TEST_BASE_URL: `http://127.0.0.1:${server.port}`,
        },
      });
      expect(result).toEqual({
        updated: true,
        currentVersion: pkg.version,
        latestVersion: "1.18.2",
        installedVersion: "1.18.2",
        note: "La actualización se completó con el instalador común.",
      });
    } finally {
      server.stop(true);
    }
  }, 120_000);
});

describe("uninstallEngines", () => {
  test("blocks removal while a dependent node is installed", async () => {
    root = mkdtempSync(join(tmpdir(), "engines-uninstall-"));
    const forgeHome = join(root, "forge614");
    mkdirSync(join(forgeHome, "workers", "bin"), { recursive: true });
    writeFileSync(join(forgeHome, "workers", "bin", "forge614-workers"), "");
    await expect(uninstallEngines({ env: { HOME: root, FORGE614_HOME: forgeHome }, cwd: root })).rejects.toMatchObject({
      code: "DEPENDENT_NODES_INSTALLED",
    });
  });
});
