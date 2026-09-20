import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: bun scripts/release-cut.mjs <version>  (e.g. 1.0.0)");
  process.exit(64);
}

const run = (command, args, opts = {}) => execFileSync(command, args, { cwd: root, stdio: "inherit", ...opts });
const runCapture = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();

const packageJsonPath = join(root, "package.json");
const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
pkg.version = version;
await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Bumped package.json to ${version}`);

run("bun", ["install"]);
run("bun", ["test"]);
run("bun", ["run", "typecheck"]);

// Building and publishing happen in CI (.github/workflows/release.yml),
// triggered by the tag push below — each platform's binary is compiled and
// smoke-tested on its own native runner (including a real Windows machine
// for windows-x64), which is more trustworthy than cross-compiling all
// targets from one developer's machine and catches bugs a single-host build
// can't (this replaced an earlier local-only version of this script after a
// stale-output bug leaked old assets into the v1.0.0 release).
const status = runCapture("git", ["status", "--porcelain", "--", "package.json", "bun.lock"]);
if (status) {
  run("git", ["add", "package.json", "bun.lock"]);
  run("git", ["commit", "-m", `chore: release v${version}\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`]);
}

const tag = `v${version}`;
run("git", ["tag", tag]);
run("git", ["push", "origin", "HEAD"]);
run("git", ["push", "origin", tag]);

console.log(`\nPushed tag ${tag} — GitHub Actions will build, verify, and publish the release:`);
console.log(`https://github.com/jotredev/forge614-engines/actions`);
