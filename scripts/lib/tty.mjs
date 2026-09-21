// No-op when stdout isn't a real terminal (piped/redirected) — raw ANSI
// escape codes in a file or another program's input would just be noise.
const isColorCapable = () => process.stdout.isTTY;

export function dim(text) {
  return isColorCapable() ? `\x1b[2m${text}\x1b[0m` : text;
}

export function bold(text) {
  return isColorCapable() ? `\x1b[1m${text}\x1b[0m` : text;
}
