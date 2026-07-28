/** Render parsed blocks back to canonical markdown. */
import type { Block } from './blocks.js';

export function serializeBlock(b: Block): string {
  switch (b.kind) {
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, b.level)))} ${b.text}`;
    case 'paragraph':
      return b.text;
    case 'quote':
      return `> ${b.text}`;
    case 'list':
      return b.items.map((it, i) => (b.ordered ? `${i + 1}. ${it}` : `- ${it}`)).join('\n');
    case 'code':
      return `\`\`\`${b.lang}\n${b.text}\n\`\`\``;
    case 'table':
      return [
        `| ${b.header.join(' | ')} |`,
        `| ${b.header.map(() => '---').join(' | ')} |`,
        ...b.rows.map((r) => `| ${r.join(' | ')} |`),
      ].join('\n');
    case 'image':
      return `![${b.alt}](${b.href})`;
  }
}

export function serializeBlocks(blocks: Block[]): string {
  return blocks.map(serializeBlock).join('\n\n');
}
