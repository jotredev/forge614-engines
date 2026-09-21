/**
 * Full commit messages (subject + body/footer, so BREAKING CHANGE: footers
 * are visible to classifyCommit) since `tag`, oldest first. Uses a null-byte
 * separator rather than newlines since a commit message itself may contain
 * blank lines.
 */
export function commitsSinceTag(runCapture, tag) {
  const output = runCapture("git", ["log", `${tag}..HEAD`, "--reverse", "--pretty=%B%x00"]);
  return output
    .split("\0")
    .map((message) => message.replace(/^\n+/, "").replace(/\n+$/, ""))
    .filter((message) => message.length > 0);
}
