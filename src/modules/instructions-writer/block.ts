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
    const before = raw.slice(0, beginIndex).replace(/\n+$/, "\n");
    const after = raw.slice(endIndex + end.length).replace(/^\n+/, "");
    return before === "" && after === "" ? "" : `${before}${after}`;
  }

  const rendered = `${begin}\n${content}\n${end}`;
  if (hasBlock) {
    return `${raw.slice(0, beginIndex)}${rendered}${raw.slice(endIndex + end.length)}`;
  }
  if (raw.length === 0) return `${rendered}\n`;
  const separator = raw.endsWith("\n") ? "" : "\n";
  return `${raw}${separator}\n${rendered}\n`;
}
