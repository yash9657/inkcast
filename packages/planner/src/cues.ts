/**
 * Choosing the words a drawing should land on.
 *
 * `Enter.at` is a guess; `Enter.cue` is an intent. The voice stage resolves a cue
 * to a real timestamp, so an element that carries one arrives exactly as the
 * narrator names it — which is the difference between a synced video and a video
 * a learner experiences as drifting.
 *
 * A good cue is a short phrase, verbatim from that beat's narration, distinctive
 * enough to occur once. This module picks one per element, spread across the
 * beat's sentences in the order the elements are meant to appear.
 */
import { STOPWORDS, sentences, words } from './text.js';

type Token = { word: string; start: number; end: number };

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    if (m.index === undefined) continue;
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** How many times a word occurs in the narration, case-insensitively. */
function counts(all: Token[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of all) {
    const k = t.word.toLowerCase();
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/** Character offsets of each sentence within the narration. */
function sentenceSpans(narration: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (const s of sentences(narration)) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const at = narration.indexOf(trimmed, from);
    if (at < 0) continue;
    spans.push({ start: at, end: at + trimmed.length });
    from = at + trimmed.length;
  }
  if (!spans.length && narration.trim()) spans.push({ start: 0, end: narration.length });
  return spans;
}

/**
 * A verbatim phrase from `narration` for each of `count` elements.
 *
 * Element *k* is cued from roughly the *k*-th slice of the beat, anchored on the
 * rarest content word in that slice so the phrase is easy for the voice stage to
 * locate. Phrases may repeat when there are more elements than sentences — two
 * elements landing on the same words is a legitimate authoring choice (a plot and
 * the ball on it), and a repeated cue still beats a guessed fraction.
 */
export function deriveCues(narration: string, count: number, words_ = 3): (string | undefined)[] {
  const all = tokens(narration);
  if (!all.length || count <= 0) return new Array(count).fill(undefined);
  const freq = counts(all);
  const spans = sentenceSpans(narration);
  const out: (string | undefined)[] = [];
  const used = new Set<string>();

  for (let k = 0; k < count; k++) {
    // Spread the elements across the beat: the first lands on the opening
    // sentence, the last on the closing one.
    const si =
      spans.length === 1
        ? 0
        : Math.min(spans.length - 1, Math.floor((k * spans.length) / Math.max(1, count)));
    const span = spans[si] ?? spans[0]!;
    const inSpan = all.filter((t) => t.start >= span.start && t.end <= span.end);
    const pool = inSpan.length ? inSpan : all;
    const candidates = pool
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.word.length >= 4 && !STOPWORDS.has(t.word.toLowerCase()))
      .sort((a, b) => {
        const fa = freq.get(a.t.word.toLowerCase()) ?? 1;
        const fb = freq.get(b.t.word.toLowerCase()) ?? 1;
        return fa - fb || a.i - b.i;
      });
    let phrase: string | undefined;
    for (const c of candidates.length ? candidates : pool.map((t, i) => ({ t, i }))) {
      const from = pool.indexOf(c.t);
      const last = pool[Math.min(pool.length - 1, from + words_ - 1)];
      if (!last) continue;
      const text = narration.slice(c.t.start, last.end).trim();
      if (!text || wordsIn(text) < 1) continue;
      if (used.has(text.toLowerCase()) && candidates.length > used.size) continue;
      phrase = text;
      break;
    }
    if (phrase) used.add(phrase.toLowerCase());
    out.push(phrase);
  }
  return out;
}

function wordsIn(s: string): number {
  return words(s).length;
}

/** True when a cue can actually be found in the narration the voice stage sees. */
export function cueResolves(narration: string, cue: string | undefined): boolean {
  if (!cue) return false;
  return narration.toLowerCase().includes(cue.toLowerCase());
}

/**
 * The cue an intent asked for, if it survives contact with the narration.
 *
 * A model-authored cue is a quotation, and quotations drift — "the minus sign"
 * when the narration says "that minus sign". Rather than trust it, fall back to a
 * derived phrase, which is verbatim by construction.
 */
export function preferredCue(
  narration: string,
  wanted: string | undefined,
  derived: string | undefined,
): string | undefined {
  if (wanted && cueResolves(narration, wanted)) return exactCase(narration, wanted);
  return derived;
}

/** Return the narration's own casing for a cue, so it matches character for character. */
function exactCase(narration: string, cue: string): string {
  const at = narration.toLowerCase().indexOf(cue.toLowerCase());
  return at < 0 ? cue : narration.slice(at, at + cue.length);
}
