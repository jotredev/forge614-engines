import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputFlag = args.indexOf("--out");
const output = outputFlag === -1 ? join(root, "dist", "release") : resolve(args[outputFlag + 1] ?? "");
if (outputFlag !== -1 && !args[outputFlag + 1]) throw new Error("--out requires a directory.");

// forge614-engines ships as a single self-contained native binary (no Node/Bun
// runtime assumptions on the target machine), so each supported OS/arch gets
// its own compiled binary and its own release asset — unlike forge614-shell,
// which ships JS run by the user's own Node install.
const targets = [
  { bunTarget: "bun-darwin-arm64", platform: "darwin", arch: "arm64" },
  { bunTarget: "bun-darwin-x64", platform: "darwin", arch: "x64" },
  { bunTarget: "bun-linux-arm64", platform: "linux", arch: "arm64" },
  { bunTarget: "bun-linux-x64", platform: "linux", arch: "x64" },
];

const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = metadata.version;
const stagingRoot = await mkdtemp(join(tmpdir(), "forge614-engines-release-"));
const bun = process.execPath.endsWith("bun") ? process.execPath : "bun";

try {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const target of targets) {
    const releaseName = `forge614-engines-${version}-${target.platform}-${target.arch}`;
    const releaseRoot = join(stagingRoot, releaseName);
    const binaryPath = join(releaseRoot, "forge614-engines");
    const archive = join(output, `${releaseName}.tar.gz`);

    await mkdir(releaseRoot, { recursive: true });
    execFileSync(
      bun,
      ["build", "src/interfaces/cli/main.ts", "--compile", "--target", target.bunTarget, "--outfile", binaryPath],
      { cwd: root, stdio: "inherit" },
    );
    await chmod(binaryPath, 0o755);
    await cp(join(root, "package.json"), join(releaseRoot, "package.json"));

    execFileSync("tar", ["-czf", archive, "-C", stagingRoot, releaseName]);
    const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
    await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);
    console.log(`Created ${archive}`);
  }

  await cp(join(root, "scripts", "install.sh"), join(output, "install.sh"));
  await chmod(join(output, "install.sh"), 0o755);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
