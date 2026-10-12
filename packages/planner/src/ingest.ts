import { providerEnv, fetchPublicText } from '@inkcast/core';
/**
 * Stage 1 — ingest.
 *
 * `ingest()` turns raw text, a file (`.md` `.txt` `.pdf` `.docx`) or an
 * `http(s)` URL into a `SourceDoc`: a title, canonical markdown, and the
 * heading outline. Only text/markdown is handled in-process; PDF, docx and URL
 * extraction load their libraries lazily so the zero-dependency path always
 * works and a missing optional package degrades with one warning.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger, report } from '@inkcast/core';
import type { Block } from './blocks.js';
import { inferHeadings, looksLikeMarkdown, parseBlocks } from './blocks.js';
import { cjsDefault, optionalImport } from './optional.js';
import { serializeBlocks } from './serialize.js';
import { normalizeWhitespace, slugify, stripMarkdown, titleCase } from './text.js';
import type { IngestInput, SourceDoc, SourceImage, SourceKind, SourceSection } from './types.js';
import type { StageOptions } from '@inkcast/core';

const log = logger('planner:ingest');

/* ------------------------------------------------------------------- public */

export async function ingest(input: IngestInput, opts?: StageOptions): Promise<SourceDoc> {
  report(opts, { stage: 'ingest', pct: 0, note: 'reading source' });

  const raw = await readSource(input, opts);
  report(opts, { stage: 'ingest', pct: 70, note: 'parsing structure' });

  const doc = buildDoc(raw.text, raw.kind, raw.ref, raw.title);
  report(opts, {
    stage: 'ingest',
    pct: 100,
    note: `${doc.sections.length} sections, ${doc.text.length} chars`,
  });
  log.info(`ingested "${doc.title}"`, {
    kind: raw.kind,
    sections: doc.sections.length,
    chars: doc.text.length,
  });
  return doc;
}

/** Build a `SourceDoc` from already-extracted text. Exposed for reuse/tests. */
export function buildDoc(
  text: string,
  kind: SourceKind = 'text',
  ref?: string,
  titleHint?: string,
): SourceDoc {
  let blocks = parseBlocks(text);
  if (!looksLikeMarkdown(text)) blocks = inferHeadings(blocks);

  const { title, rest } = extractTitle(blocks, titleHint, ref);
  const canonical = serializeBlocks(rest);
  const doc: SourceDoc = {
    title,
    text: canonical,
    sections: sectionsOf(rest),
    origin: { kind, ...(ref === undefined ? {} : { ref }) },
  };
  const images = imagesOf(rest, ref);
  if (images.length) doc.images = images;
  return doc;
}

/* -------------------------------------------------------------- extraction */

type Extracted = { text: string; kind: SourceKind; ref?: string; title?: string };

async function readSource(input: IngestInput, opts?: StageOptions): Promise<Extracted> {
  if (input.url) return fromUrl(input.url, opts);
  if (input.filePath) return fromFile(input.filePath, opts);
  if (input.text && input.text.trim()) {
    const looksUrl = /^https?:\/\/\S+$/i.test(input.text.trim());
    if (looksUrl) return fromUrl(input.text.trim(), opts);
    return { text: input.text, kind: looksLikeMarkdown(input.text) ? 'markdown' : 'text' };
  }
  throw new Error('ingest() needs one of { text, filePath, url }');
}

async function fromFile(filePath: string, opts?: StageOptions): Promise<Extracted> {
  const abs = path.resolve(filePath);
  const ext = path.extname(abs).toLowerCase();
  const fallbackTitle = titleCase(path.basename(abs, ext).replace(/[-_]+/g, ' '));

  if (ext === '.pdf') return { ...(await fromPdf(abs, opts)), ref: abs };
  if (ext === '.docx') return { ...(await fromDocx(abs, opts)), ref: abs, title: fallbackTitle };
  if (ext === '.html' || ext === '.htm') {
    const html = await readFile(abs, 'utf8');
    return { text: await htmlToMarkdown(html), kind: 'html', ref: abs, title: fallbackTitle };
  }
  if (ext === '.doc') {
    throw new Error('legacy .doc is not supported — save as .docx, .md or .txt first');
  }
  const text = await readFile(abs, 'utf8');
  return {
    text,
    kind: ext === '.md' || ext === '.markdown' ? 'markdown' : 'txt',
    ref: abs,
    title: fallbackTitle,
  };
}

async function fromPdf(abs: string, opts?: StageOptions): Promise<Extracted> {
  type UnPdf = {
    getDocumentProxy(data: Uint8Array): Promise<unknown>;
    extractText(
      doc: unknown,
      o?: { mergePages?: boolean },
    ): Promise<{ totalPages: number; text: string[] | string }>;
    getMeta(doc: unknown): Promise<{ info?: Record<string, unknown> }>;
  };
  const unpdf = await optionalImport<UnPdf>('unpdf', 'cannot read PDF files');
  if (!unpdf) throw new Error(`cannot ingest ${abs}: install "unpdf" to enable PDF ingest`);

  const bytes = await readFile(abs);
  // pdf.js *detaches* the Uint8Array it is handed, so parse once and reuse the
  // proxy — never the array.
  const proxy = await unpdf.getDocumentProxy(new Uint8Array(bytes));
  const [extracted, meta] = await Promise.all([
    unpdf.extractText(proxy, { mergePages: false }),
    unpdf.getMeta(proxy).catch(() => ({ info: {} as Record<string, unknown> })),
  ]);
  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  report(opts, { stage: 'ingest', pct: 55, note: `${pages.length} PDF pages` });

  // Page boundaries are a genuine structural hint, so keep them as paragraph
  // breaks rather than gluing every page together.
  const text = pages.map((p) => reflow(p)).join('\n\n');
  const info = meta.info ?? {};
  const rawTitle = typeof info.Title === 'string' ? info.Title.trim() : '';
  return {
    text,
    kind: 'pdf',
    title: rawTitle && rawTitle.length > 2 ? rawTitle : undefined,
  };
}

async function fromDocx(abs: string, opts?: StageOptions): Promise<Extracted> {
  type Mammoth = {
    convertToHtml(i: { path: string }): Promise<{ value: string }>;
    extractRawText(i: { path: string }): Promise<{ value: string }>;
  };
  const mod = await optionalImport<unknown>('mammoth', 'cannot read .docx files');
  if (!mod) throw new Error(`cannot ingest ${abs}: install "mammoth" to enable .docx ingest`);
  const mammoth = cjsDefault<Mammoth>(mod);

  // convertToHtml keeps heading levels and lists; extractRawText throws them
  // away, which would cost us the whole outline.
  try {
    const { value } = await mammoth.convertToHtml({ path: abs });
    report(opts, { stage: 'ingest', pct: 55, note: 'docx → markdown' });
    return { text: await htmlToMarkdown(value), kind: 'docx' };
  } catch (err) {
    log.warn('docx HTML conversion failed, falling back to raw text', err as Error);
    const { value } = await mammoth.extractRawText({ path: abs });
    return { text: value, kind: 'docx' };
  }
}

async function fromUrl(url: string, opts?: StageOptions): Promise<Extracted> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`only http(s) URLs can be ingested, got ${parsed.protocol}`);
  }

  let body: string;
  let type: string;
  if (providerEnv().INKCAST_PUBLIC_SOURCES === '1') {
    const result = await fetchPublicText(parsed);
    body = result.body;
    type = result.contentType;
  } else {
    const res = await fetch(parsed, {
      redirect: 'follow',
      headers: { 'user-agent': 'inkcast/0.1 (+https://github.com/inkcast)' },
    });
    if (!res.ok) throw new Error(`fetch failed for ${url}: ${res.status} ${res.statusText}`);
    body = await res.text();
    type = res.headers.get('content-type') ?? '';
  }
  report(opts, { stage: 'ingest', pct: 45, note: `fetched ${body.length} bytes` });

  if (type.includes('text/markdown') || parsed.pathname.endsWith('.md')) {
    return { text: body, kind: 'markdown', ref: parsed.href };
  }
  if (type.includes('application/json')) {
    return { text: jsonToMarkdown(body), kind: 'text', ref: parsed.href };
  }
  if (type.startsWith('text/plain')) {
    return { text: body, kind: 'txt', ref: parsed.href };
  }

  const title = htmlTitle(body) ?? titleCase(path.basename(parsed.pathname).replace(/[-_]+/g, ' '));
  return {
    text: await htmlToMarkdown(body),
    kind: 'url',
    ref: parsed.href,
    title: title || parsed.hostname,
  };
}

/* -------------------------------------------------------------------- HTML */

function htmlTitle(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) return stripTags(h1[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t?.[1])
    return stripTags(t[1])
      .split(/\s+[|–—-]\s+/)[0]
      ?.trim();
  return undefined;
}

const CHROME = 'nav, script, style, header, footer, aside, noscript, iframe, form, svg, button';

/**
 * HTML → markdown. cheerio picks the content root and strips site chrome;
 * turndown does the conversion. Both are optional: without them we fall back to
 * a tag stripper that still preserves headings and list items.
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  type Cheerio = { load(h: string): (sel: string) => { remove(): void; html(): string | null } };
  type Turndown = new (o?: Record<string, unknown>) => {
    remove(tags: string[]): void;
    turndown(h: string): string;
  };

  const cheerioMod = await optionalImport<Cheerio>('cheerio', 'using the built-in HTML stripper');
  let body = html;
  if (cheerioMod) {
    const $ = cheerioMod.load(html);
    $(CHROME).remove();
    body = $('main').html() ?? $('article').html() ?? $('body').html() ?? html;
  }

  const tdMod = await optionalImport<unknown>('turndown', 'using the built-in HTML stripper');
  if (tdMod) {
    const TurndownService = cjsDefault<Turndown>(tdMod);
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '_',
    });
    td.remove(['nav', 'script', 'style', 'header', 'footer', 'aside']);
    return td.turndown(body);
  }
  return htmlToMarkdownFallback(body);
}

/** Dependency-free HTML → markdown that keeps headings, lists and paragraphs. */
export function htmlToMarkdownFallback(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|nav|header|footer|aside|noscript|svg|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, l: string, t: string) => {
        const level = Number(l);
        return `\n\n${'#'.repeat(Number.isFinite(level) ? level : 2)} ${stripTags(t)}\n\n`;
      })
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t: string) => `\n- ${stripTags(t)}`)
      .replace(
        /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
        (_m, t) => `\n\n> ${stripTags(t)}\n\n`,
      )
      .replace(
        /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
        (_m, t) => `\n\n\`\`\`\n${stripTags(t)}\n\`\`\`\n\n`,
      )
      .replace(/<(p|div|section|article|br|tr|table|ul|ol)[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const n = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (code.startsWith('#')) {
      const n = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** A JSON endpoint still deserves a sensible outline. */
function jsonToMarkdown(body: string): string {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return body;
  }
  const lines: string[] = [];
  const walk = (v: unknown, depth: number, label?: string) => {
    const pad = '#'.repeat(Math.min(6, depth + 1));
    if (v === null || typeof v !== 'object') {
      lines.push(label ? `- ${label}: ${String(v)}` : `- ${String(v)}`);
      return;
    }
    if (Array.isArray(v)) {
      if (label) lines.push(`${pad} ${label}`);
      for (const item of v.slice(0, 40)) walk(item, depth + 1);
      return;
    }
    if (label) lines.push(`${pad} ${label}`);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, depth + 1, k);
  };
  walk(data, 0);
  return lines.join('\n');
}

/* ------------------------------------------------------------- PDF reflow */

/**
 * Undo the hard line wrapping in extracted PDF text: rejoin lines that are
 * mid-sentence, keep genuine breaks (bullets, headings, short trailing lines).
 */
export function reflow(pageText: string): string {
  const lines = normalizeWhitespace(pageText).split('\n');
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      out.push('');
      continue;
    }
    const prev = out.length ? out[out.length - 1] : undefined;
    const startsBlock =
      /^([-*•‣◦]|\d{1,3}[.)]|#{1,6}\s)/.test(line) || /^[A-Z][^a-z]{4,}$/.test(line);
    const prevContinues =
      prev !== undefined &&
      prev !== '' &&
      !/[.!?:;]["')\]]?$/.test(prev) &&
      !/^([-*•‣◦]|\d{1,3}[.)])/.test(prev);
    if (prevContinues && !startsBlock) {
      if (prev.endsWith('-')) out[out.length - 1] = prev.slice(0, -1) + line;
      else out[out.length - 1] = `${prev} ${line}`;
      continue;
    }
    out.push(line.replace(/^[•‣◦]\s*/, '- '));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ----------------------------------------------------------- doc assembly */

function extractTitle(
  blocks: Block[],
  hint: string | undefined,
  ref: string | undefined,
): { title: string; rest: Block[] } {
  const first = blocks[0];
  if (first?.kind === 'heading' && first.level <= 2 && first.text.trim()) {
    // Promote the leading heading to the document title so it is not also a
    // section — otherwise the opening scene says the same thing twice.
    const onlyTop =
      blocks.filter((b) => b.kind === 'heading' && b.level === first.level).length === 1;
    if (onlyTop) return { title: first.text.trim(), rest: blocks.slice(1) };
    return { title: first.text.trim(), rest: blocks };
  }
  if (hint?.trim()) return { title: hint.trim(), rest: blocks };
  const firstPara = blocks.find((b) => b.kind === 'paragraph');
  if (firstPara?.kind === 'paragraph') {
    const s = stripMarkdown(firstPara.text).split(/(?<=[.!?])\s/)[0] ?? '';
    const t = s
      .split(/\s+/)
      .slice(0, 9)
      .join(' ')
      .replace(/[.,;:]$/, '');
    if (t.length > 2) return { title: t, rest: blocks };
  }
  if (ref) {
    const base = ref.startsWith('http') ? new URL(ref).hostname : path.basename(ref);
    return {
      title: titleCase(base.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')),
      rest: blocks,
    };
  }
  return { title: 'Untitled', rest: blocks };
}

function sectionsOf(blocks: Block[]): SourceSection[] {
  const sections: SourceSection[] = [];
  let current: { heading: string; level: number; body: Block[] } = {
    heading: '',
    level: 0,
    body: [],
  };
  const flush = () => {
    const text = serializeBlocks(current.body).trim();
    if (text || current.heading) {
      sections.push({ heading: current.heading, level: current.level, text });
    }
  };
  for (const b of blocks) {
    if (b.kind === 'heading') {
      flush();
      current = { heading: b.text, level: b.level, body: [] };
      continue;
    }
    current.body.push(b);
  }
  flush();
  return sections.filter((s) => s.heading !== '' || s.text !== '');
}

function imagesOf(blocks: Block[], ref: string | undefined): SourceImage[] {
  const out: SourceImage[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.kind !== 'image' || !b.href) continue;
    const href = resolveHref(b.href, ref);
    if (seen.has(href)) continue;
    seen.add(href);
    const alt = b.alt.trim();
    out.push({
      id: slugify(alt || path.basename(href).replace(/\.[a-z0-9]+$/i, '')),
      description: alt || 'illustration from the source document',
      href,
    });
  }
  return out;
}

function resolveHref(href: string, ref: string | undefined): string {
  if (/^(https?:|data:)/i.test(href)) return href;
  if (!ref) return href;
  if (ref.startsWith('http')) {
    try {
      return new URL(href, ref).href;
    } catch {
      return href;
    }
  }
  return path.resolve(path.dirname(ref), href);
}
