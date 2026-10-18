#!/usr/bin/env node
// Target compilation, isolated smoke checks, and publication helpers.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Reads and validates the package version used in release filenames. */
function version() {
  const value = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error("package.json must contain a X.Y.Z version");
  return value;
}

/** Runs a program and throws with its captured output on failure. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || `${command} failed`).trim());
  return result.stdout ?? "";
}

/** Compiles the current target and archives the expected versioned package. */
function build() {
  const target = process.env.FORGE614_TARGET;
  const parts = target?.split("-");
  if (parts?.length !== 2 || !["darwin", "linux", "windows"].includes(parts[0]) || !["arm64", "x64"].includes(parts[1])) throw new Error("FORGE614_TARGET must be <platform>-<architecture>");
  const [platform, architecture] = parts;
  if (platform === "windows" && architecture !== "x64") throw new Error("Windows arm64 is not supported");
  const currentVersion = version();
  const name = `forge614-engines-${currentVersion}-${platform}-${architecture}`;
  const root = join("dist", "targets", `${platform}-${architecture}`, name);
  const launcher = join(root, `forge614-engines${platform === "windows" ? ".exe" : ""}`);
  mkdirSync(root, { recursive: true });
  run("bun", ["build", "./src/interfaces/cli/main.ts", "--compile", `--target=bun-${platform}-${architecture}`, `--outfile=${launcher}`]);
  copyFileSync("package.json", join(root, "package.json"));
  mkdirSync(join("dist", "release"), { recursive: true });
  run("tar", ["-czf", join("dist", "release", `${name}.tar.gz`), "-C", join("dist", "targets", `${platform}-${architecture}`), name]);
  process.stdout.write(`${launcher}\n`);
}

/** Runs the compiled binary with isolated HOME and FORGE614_HOME and checks its version. */
function smoke() {
  const target = process.env.FORGE614_TARGET;
  const parts = target?.split("-");
  if (parts?.length !== 2) throw new Error("FORGE614_TARGET must be <platform>-<architecture>");
  const [platform, architecture] = parts;
  const currentVersion = version();
  const name = `forge614-engines-${currentVersion}-${platform}-${architecture}`;
  const binary = join("dist", "targets", `${platform}-${architecture}`, name, `forge614-engines${platform === "windows" ? ".exe" : ""}`);
  const temporary = mkdtempSync(join(tmpdir(), "engines-release-smoke-"));
  try {
    const output = run(binary, ["--version"], { env: { ...process.env, HOME: temporary, USERPROFILE: temporary, FORGE614_HOME: join(temporary, ".forge614") } }).trim();
    if (output !== `forge614-engines ${currentVersion}`) throw new Error(`unexpected version smoke output: ${output}`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

/** Adds the compatibility sidecars and records their own digests in SHA256SUMS. */
function sidecars() {
  const directory = join("dist", "release");
  const names = readdirSync(directory).filter((name) => name.endsWith(".tar.gz")).sort();
  for (const name of names) {
    const bytes = readFileSync(join(directory, name));
    const digest = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(directory, `${name}.sha256`), `${digest}  ${name}\n`);
  }
  const sumsPath = join(directory, "SHA256SUMS");
  const sums = readFileSync(sumsPath, "utf8").trimEnd().split(/\r?\n/);
  for (const name of names) {
    const sidecar = `${name}.sha256`;
    const digest = createHash("sha256").update(readFileSync(join(directory, sidecar))).digest("hex");
    sums.push(`${digest}  ${sidecar}`);
  }
  writeFileSync(sumsPath, `${sums.join("\n")}\n`);
}

/** Publishes the staged release assets after a version tag triggers the release workflow. */
function publish() {
  const tag = `v${version()}`;
  const assets = readdirSync(join("dist", "release")).sort().map((name) => join("dist", "release", name));
  run("gh", ["release", "create", tag, ...assets, "--title", tag, "--generate-notes"], { env: { ...process.env, GH_REPO: "jotredev/forge614-engines" } });
}

/** Runs the requested release helper. */
function main() {
  const action = process.argv[2];
  if (action === "build") build();
  else if (action === "smoke") smoke();
  else if (action === "sidecars") sidecars();
  else if (action === "publish") publish();
  else throw new Error("usage: target-release.mjs <build|smoke|sidecars|publish>");
}

try { main(); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "release action failed"}\n`); process.exitCode = 1; }
