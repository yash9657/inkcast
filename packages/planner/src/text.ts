/**
 * Text utilities shared by ingest, the heuristic planner and narration writing.
 * Everything here is deterministic — same input, same output, so plans hash
 * stably and the cache in `@inkcast/core` actually works.
 */

/** Words that carry no topical information when scoring or matching. */
export const STOPWORDS = new Set(
  (
    "a an the and or but if then than that this these those there here it its it's of to in on at " +
    'for from with without by as is are was were be been being do does did done have has had ' +
    'will would can could should may might must not no nor so such very more most less least ' +
    'also just only even much many other another each every both few some any all we you they ' +
    'he she i our your their his her them us me my mine into over under about after before ' +
    'between while when where which who whom whose what how why because however therefore thus ' +
    'per via using used use uses new like same one two three first second next last well often'
  ).split(' '),
);

const ABBREVIATIONS = [
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'cf.',
  'approx.',
  'Fig.',
  'Eq.',
  'No.',
  'Dr.',
  'Mr.',
  'Mrs.',
  'Ms.',
  'Prof.',
  'St.',
  'Jr.',
  'Sr.',
];

/** Collapse whitespace, normalise quotes and dashes. */
export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** Strip markdown decoration, leaving the words a narrator would actually say. */
export function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/^\s*[-=]{3,}\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sentence splitter that survives abbreviations, decimals and initials.
 * Deliberately simple and dependency-free; it only has to be right often
 * enough to give the planner clean beats.
 */
export function sentences(input: string): string[] {
  const text = normalizeWhitespace(input).replace(/\n+/g, ' ');
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = text[i + 1];
    // Not a boundary unless followed by whitespace/end.
    if (next !== undefined && next !== ' ' && next !== '"' && next !== ')') continue;
    const head = text.slice(start, i + 1);
    if (ABBREVIATIONS.some((a) => head.endsWith(a))) continue;
    // Decimal numbers: "3.5" — digit before and after the dot.
    const prev = text[i - 1];
    if (
      ch === '.' &&
      prev !== undefined &&
      /\d/.test(prev) &&
      /^\s?\d/.test(text.slice(i + 1, i + 3))
    )
      continue;
    // Single initial: "J. Smith"
    if (ch === '.' && /(^|\s)[A-Z]$/.test(text.slice(start, i))) continue;
    const s = head.trim();
    if (s) out.push(s);
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export function words(s: string): string[] {
  const m = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ?? [];
}

export function wordCount(s: string): number {
  return words(s).length;
}

/** Seconds this narration will take at the configured pace. */
export function estimateDurationSec(narration: string, wordsPerSecond = 2.6): number {
  const n = wordCount(narration);
  // A short line still costs breath and a beat of silence either side.
  return Math.max(1.2, n / Math.max(0.5, wordsPerSecond) + 0.5);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  );
}

/** Crude but reliable English singulariser for icon lookup. */
export function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.length < 4) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses') || w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes'))
    return w.slice(0, -2);
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export function titleCase(s: string): string {
  return s.replace(/\S+/g, (w) => (w.length > 3 ? w[0]!.toUpperCase() + w.slice(1) : w)).trim();
}

/** Capitalise the first letter without touching the rest. */
export function capitalize(s: string): string {
  const t = s.trimStart();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/** Content words, lower-cased, stopwords removed. */
export function keywords(s: string): string[] {
  return words(stripMarkdown(s))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Term frequency of content words, highest first. */
export function keyTerms(s: string, limit = 8): string[] {
  const freq = new Map<string, number>();
  for (const w of keywords(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

/**
 * Words that cannot end a phrase, because they promise a next word that is not
 * coming. Dropping them is what turns a cut into an ending.
 */
const DANGLING =
  /^(?:the|a|an|and|or|but|of|to|in|on|at|by|for|from|with|into|onto|as|is|are|was|were|be|been|that|which|who|whose|whom|it|its|this|these|those|so|than|then|when|while|where|how|why|if|because|about|over|under|per|via|one|you|your|we|our|they|their|he|she|his|her)$/i;

/**
 * Shorten a phrase to at most `max` words, preferring to cut at a natural break.
 * Used for diagram node labels and on-canvas text, never for narration.
 *
 * **Never ellipsises.** An "…" on a whiteboard is a promise the video does not
 * keep: the learner reads "How big a step is the one knob you…" and waits for the
 * rest of a sentence that is never written. Verification found five of them on the
 * benchmark board, in captions and in recap nodes — the recap, of all places,
 * where the accumulated board is supposed to *be* the summary.
 *
 * So a cut has to leave something that reads as finished. In order: cut at a real
 * punctuation break, else take `max` words and keep dropping trailing words that
 * dangle ("…is the one knob you" → "…is the one knob"). Only if that eats the
 * phrase down to nothing do we fall back to the plain word cut, which is at worst
 * a terse label rather than an unkept promise.
 */
export function shorten(s: string, max: number): string {
  const clean = stripMarkdown(s)
    .replace(/[.;:,]+$/, '')
    .trim();
  const w = words(clean);
  if (w.length <= max) return clean;
  // Prefer cutting at a comma / dash / colon if one lands in range.
  const cut = clean.search(/[,—–:;(]/);
  if (cut > 0) {
    const head = clean.slice(0, cut).trim();
    if (wordCount(head) <= max && wordCount(head) >= Math.min(2, max)) return head;
  }
  const tokens = clean.split(/\s+/).slice(0, max);
  while (tokens.length > 1 && DANGLING.test(tokens[tokens.length - 1] as string)) tokens.pop();
  return tokens.join(' ').replace(/[,;:.\-–—]+$/, '');
}

/** Longest common word overlap ratio, for matching a term to narration. */
export function overlap(a: string, b: string): number {
  const A = new Set(keywords(a));
  if (A.size === 0) return 0;
  let hit = 0;
  for (const w of new Set(keywords(b))) if (A.has(w)) hit++;
  return hit / A.size;
}
