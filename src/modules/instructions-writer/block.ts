export function blockMarkers(blockId: string): { begin: string; end: string } {
  return {
    begin: `<!-- forge614-engines:begin ${blockId} -->`,
    end: `<!-- forge614-engines:end ${blockId} -->`,
  };
}

export function extractBlock(raw: string, blockId: string): string | undefined {
  const { begin, end } = blockMarkers(blockId);
  const beginIndex = raw.indexOf(begin);
  const endIndex = raw.indexOf(end);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) return undefined;
  return raw.slice(beginIndex + begin.length, endIndex).trim();
}

export function withBlock(raw: string, blockId: string, content: string | undefined): string {
  const { begin, end } = blockMarkers(blockId);
  const beginIndex = raw.indexOf(begin);
  const endIndex = raw.indexOf(end);
  const hasBlock = beginIndex !== -1 && endIndex !== -1 && endIndex >= beginIndex;

  if (content === undefined) {
    if (!hasBlock) return raw;
    const beforeRaw = raw.slice(0, beginIndex);
    const afterRaw = raw.slice(endIndex + end.length);
    // Insertion always adds exactly one trailing "\n" after the block, and exactly
    // one leading "\n" before it when the surrounding content was non-empty (none
    // when it was empty). Undo exactly that single, self-owned character on each
    // side -- never collapse or otherwise touch any other pre-existing whitespace,
    // so content outside the block's own markers survives byte-for-byte.
    let before: string;
    if (beforeRaw === "") {
      before = "";
    } else if (beforeRaw.endsWith("\n")) {
      before = beforeRaw.slice(0, -1);
    } else {
      before = beforeRaw;
    }
    const after = afterRaw.startsWith("\n") ? afterRaw.slice(1) : afterRaw;
    return `${before}${after}`;
  }

  const rendered = `${begin}\n${content}\n${end}`;
  if (hasBlock) {
    return `${raw.slice(0, beginIndex)}${rendered}${raw.slice(endIndex + end.length)}`;
  }
  if (raw.length === 0) return `${rendered}\n`;
  return `${raw}\n${rendered}\n`;
}
