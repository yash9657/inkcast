/**
 * Block-level document parser.
 *
 * Structure is the planner's single biggest free win: a heading is a chapter, a
 * bullet list is a stack diagram, a numbered list is a flow chart. So ingest
 * normalises everything (markdown, plain text, HTML-derived markdown, PDF text)
 * into the same small block vocabulary and the planner works off that.
 */
import { collapseSpaces, normalizeChars, stripMarkdown, titleCase } from './text.js';

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'image'; alt: string; href: string };

const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)/;
const BULLET = /^(\s*)([-*+])\s+(.+)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.+)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const SETEXT = /^ {0,3}(=+|-{2,})\s*$/;

function cells(line: string): string[] {
  const m = line.match(TABLE_ROW);
  const body = m?.[1] ?? line;
  return body.split('|').map((c) => stripMarkdown(c).trim());
}

/** True when the text uses enough markdown syntax to trust its structure. */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split('\n');
  let signals = 0;
  for (const l of lines) {
    if (HEADING.test(l) || BULLET.test(l) || ORDERED.test(l) || FENCE.test(l) || TABLE_ROW.test(l))
      signals++;
  }
  return signals >= 2;
}

/**
 * Parse markdown (or markdown-ish text) into blocks.
 *
 * Two views of the same lines, and the difference is one word long: **prose is collapsed
 * and a fenced block is not** (plan item 6.2). This used to normalise the whole document
 * first — `[ \t]+ → ' '`, then every space beside a newline dropped — which is right for a
 * paragraph and destroys a listing, because a code block's leading spaces *are* its block
 * structure. The two arrays are the same length by construction (nothing here changes the
 * line count), so an index into one is an index into the other.
 */
export function parseBlocks(input: string): Block[] {
  const rawLines = normalizeChars(input).split('\n');
  const lines = rawLines.map(collapseSpaces);
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join(' ').trim();
    para = [];
    if (!joined) return;
    const img = joined.match(IMAGE_ONLY);
    if (img) {
      blocks.push({ kind: 'image', alt: img[1] ?? '', href: img[2] ?? '' });
      return;
    }
    blocks.push({ kind: 'paragraph', text: joined });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (!line.trim()) {
      flushPara();
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      flushPara();
      const marker = fence[1] ?? '```';
      const lang = fence[2] ?? '';
      const body: string[] = [];
      i++;
      for (; i < lines.length; i++) {
        const l = lines[i] ?? '';
        if (l.trimStart().startsWith(marker.slice(0, 3))) break;
        // The *raw* line: this is the one place in the parser where the spaces at the
        // start of a line carry meaning. The closing fence is still found on the
        // collapsed view, where indentation is not what identifies it.
        body.push(rawLines[i] ?? l);
      }
      if (body.join('\n').trim()) blocks.push({ kind: 'code', lang, text: body.join('\n') });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushPara();
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        text: stripMarkdown(heading[2] ?? ''),
      });
      continue;
    }

    // Setext heading: the *previous* paragraph line was the heading text.
    const setext = line.match(SETEXT);
    if (setext && para.length === 1 && para[0]) {
      const t = para[0];
      para = [];
      blocks.push({
        kind: 'heading',
        level: (setext[1] ?? '=').startsWith('=') ? 1 : 2,
        text: stripMarkdown(t),
      });
      continue;
    }

    if (HR.test(line)) {
      flushPara();
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flushPara();
      const ordered = ORDERED.test(line) && !BULLET.test(line);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const l = lines[i] ?? '';
        const b = l.match(BULLET) ?? l.match(ORDERED);
        if (b) {
          items.push(stripMarkdown(b[3] ?? ''));
          continue;
        }
        if (!l.trim()) {
          // A blank line ends the list unless the next line continues it.
          const nxt = lines[i + 1] ?? '';
          if (BULLET.test(nxt) || ORDERED.test(nxt)) continue;
          break;
        }
        if (/^\s{2,}\S/.test(l) && items.length) {
          // Continuation of the previous item.
          items[items.length - 1] = `${items[items.length - 1]} ${stripMarkdown(l)}`.trim();
          continue;
        }
        break;
      }
      i--;
      const clean = items.map((t) => t.trim()).filter(Boolean);
      if (clean.length) blocks.push({ kind: 'list', ordered, items: clean });
      continue;
    }

    if (QUOTE.test(line)) {
      flushPara();
      const body: string[] = [];
      for (; i < lines.length; i++) {
        const q = (lines[i] ?? '').match(QUOTE);
        if (!q) break;
        body.push(q[1] ?? '');
      }
      i--;
      const t = stripMarkdown(body.join(' '));
      if (t) blocks.push({ kind: 'quote', text: t });
      continue;
    }

    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      flushPara();
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      for (; i < lines.length; i++) {
        const l = lines[i] ?? '';
        if (!TABLE_ROW.test(l)) break;
        rows.push(cells(l));
      }
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/**
 * Recover headings from unstructured plain text: a short standalone line with
 * no terminal punctuation, followed by prose, is a heading in every plain-text
 * document ever written.
 */
export function inferHeadings(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind !== 'paragraph') {
      out.push(b);
      continue;
    }
    const t = b.text.trim();
    const next = blocks[i + 1];
    const looksHeading =
      t.length <= 72 &&
      t.split(/\s+/).length <= 10 &&
      !/[.!?,;:]$/.test(t) &&
      /^[\p{Lu}\p{N}]/u.test(t) &&
      next !== undefined &&
      (next.kind === 'paragraph' || next.kind === 'list');
    if (looksHeading) {
      const upper = t === t.toUpperCase();
      out.push({ kind: 'heading', level: 2, text: upper ? titleCase(t.toLowerCase()) : t });
    } else {
      out.push(b);
    }
  }
  return out;
}

/** Plain text of a block, as a narrator would read it. */
export function blockText(b: Block): string {
  switch (b.kind) {
    case 'heading':
      return b.text;
    case 'paragraph':
      return b.text;
    case 'quote':
      return b.text;
    case 'list':
      return b.items.join('. ');
    case 'code':
      return b.text;
    case 'table':
      return [b.header.join(', '), ...b.rows.map((r) => r.join(', '))].join('. ');
    case 'image':
      return b.alt;
  }
}
