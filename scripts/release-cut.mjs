import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
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

const releaseDir = join(root, "dist", "release");
run("bun", ["scripts/release-bundle.mjs"]);

const status = runCapture("git", ["status", "--porcelain", "--", "package.json", "bun.lock"]);
if (status) {
  run("git", ["add", "package.json", "bun.lock"]);
  run("git", ["commit", "-m", `chore: release v${version}\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`]);
}

const tag = `v${version}`;
run("git", ["tag", tag]);
run("git", ["push", "origin", "HEAD"]);
run("git", ["push", "origin", tag]);

const assets = (await readdir(releaseDir))
  .filter((name) => name !== "install.sh")
  .map((name) => join(releaseDir, name));
assets.push(join(releaseDir, "install.sh"));

run("gh", [
  "release",
  "create",
  tag,
  ...assets,
  "--title",
  tag,
  "--notes",
  `Forge614 Engines ${tag}. Install with:\n\ncurl -fsSL https://github.com/jotredev/forge614-engines/releases/download/${tag}/install.sh | bash`,
]);

console.log(`\nRelease ${tag} published: https://github.com/jotredev/forge614-engines/releases/tag/${tag}`);
