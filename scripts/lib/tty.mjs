// isTTY is injectable (defaulting to the real, ambient process.stdout.isTTY)
// rather than read internally, so callers — and their tests — get
// deterministic output regardless of the terminal they happen to run in.
// This matters in practice: release-cut.mjs spawns `bun test` as a child
// process with stdio: "inherit", which inherits the real terminal's TTY-ness
// when run interactively, so a test asserting plain (non-ANSI) output must
// not depend on the ambient value to stay stable.
export function dim(text, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[2m${text}\x1b[0m` : text;
}

export function bold(text, isTTY = process.stdout.isTTY) {
  return isTTY ? `\x1b[1m${text}\x1b[0m` : text;
}
