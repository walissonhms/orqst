/** Limited, inert Markdown blocks. Inline syntax, HTML, URLs and media remain literal text. */
export type ArtifactBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] };

export function artifactBlocks(text: string): ArtifactBlock[] {
  const blocks: ArtifactBlock[] = [];
  let code: string[] | undefined;
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (code) {
      if (
        marker &&
        fence &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = undefined;
        fence = undefined;
      } else code.push(line);
      continue;
    }
    if (marker) {
      code = [];
      fence = marker;
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line)?.[1];
    if (heading) {
      blocks.push({ kind: 'heading', text: heading });
      continue;
    }
    const item = /^\s{0,3}[-*+]\s+(.+)$/.exec(line)?.[1];
    const last = blocks.at(-1);
    if (item) {
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
    } else if (last?.kind === 'text') last.text += '\n' + line;
    else blocks.push({ kind: 'text', text: line });
  }
  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}

/** Text matches the limited preview; unsupported inline syntax is intentionally preserved. */
export function readableArtifact(text: string): string {
  return artifactBlocks(text)
    .map((block) => (block.kind === 'list' ? block.items.join('\n') : block.text))
    .join('\n');
}
