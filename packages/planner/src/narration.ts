/**
 * Turning written prose into something a narrator would actually say.
 *
 * The failure mode of every naive text-to-video tool is dumping the source
 * sentence verbatim: "It should be noted that the aforementioned algorithm
 * utilises an iterative approach." Nobody talks like that. This module
 * compresses, de-bureaucratises and contracts source sentences, then selects
 * just enough of them to fill one 4–12 second beat.
 */
import { capitalize, sentences, stripMarkdown, wordCount, words } from './text.js';

type Rule = [RegExp, string];

/** Written-to-spoken substitutions, applied in order. */
const SPOKEN: Rule[] = [
  // Reference plumbing nobody says out loud.
  [/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, ''],
  [/\s*\((?:see\s+)?(?:e\.g\.|i\.e\.)?[^()]{0,90}\bet al\.[^()]{0,20}\)/gi, ''],
  [/,?\s*\bas\s+(?:shown|seen|described|illustrated|discussed)\s+in\s+(?:figure|fig\.?|table|section|chapter|appendix)\s*[\w.\d]*/gi, ''],
  [/,?\s*\(?\bsee\s+(?:figure|fig\.?|table|section|chapter|appendix)\s*[\w.\d]*\)?/gi, ''],
  [/\s*\((?:[^()]{0,60})\)/g, ' '],

  // Filler openers.
  [/^\s*it (?:is|should be) (?:important to note|noted|worth noting) that\s*/i, ''],
  [/^\s*(?:note|notice) that\s*/i, ''],
  [/^\s*as (?:previously |already )?(?:mentioned|noted|discussed)[, ]\s*/i, ''],
  [/^\s*in (?:this|the) (?:section|chapter|paper|article|post|document)[^,]{0,30},\s*/i, ''],
  [/^\s*(?:first|firstly) of all,\s*/i, 'First, '],

  // Bureaucratic phrasing.
  [/\butili[sz]e(s|d)?\b/gi, 'use$1'],
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bfor the purpose of\b/gi, 'to'],
  [/\bat this point in time\b/gi, 'now'],
  [/\ba (?:large |small )?number of\b/gi, 'several'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bin the event that\b/gi, 'if'],
  [/\bwith (?:respect|regard) to\b/gi, 'for'],
  [/\bin terms of\b/gi, 'for'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bsubsequently\b/gi, 'then'],
  [/\bapproximately\b/gi, 'about'],
  [/\badditionally\b/gi, 'also'],
  [/\bin addition\b/gi, 'also'],
  [/\b(?:furthermore|moreover)\b/gi, 'and'],
  [/\b(?:consequently|therefore|thus|hence)\b/gi, 'so'],
  [/\bnevertheless\b/gi, 'still'],
  [/\bnonetheless\b/gi, 'still'],
  [/\bis able to\b/gi, 'can'],
  [/\bare able to\b/gi, 'can'],
  [/\bha(?:s|ve) the ability to\b/gi, 'can'],
  [/\bin conclusion\b/gi, 'so, to wrap up'],
  [/\baforementioned\b/gi, 'that'],
  [/\bcommence(s|d)?\b/gi, 'start$1'],
  [/\bdemonstrate(s|d)?\b/gi, 'show$1'],
  [/\bfacilitate(s|d)?\b/gi, 'help$1'],
  [/\bendeavour(s|ed)?\b/gi, 'try'],

  // Abbreviations and symbols.
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'in other words,'],
  [/\betc\.?/gi, 'and so on'],
  [/\bvs\.?\b/gi, 'versus'],
  [/\bcf\.\s*/gi, 'compare '],
  [/(\d)\s*%/g, '$1 percent'],
  [/\s&\s/g, ' and '],
  [/\s*>=\s*/g, ' at least '],
  [/\s*<=\s*/g, ' at most '],
  [/(\d)\s*x\b/g, '$1 times'],
  [/\s*(?:→|->)\s*/g, ' becomes '],

  // Spoken contractions.
  [/\bit is\b/g, "it's"],
  [/\bthat is\b/g, "that's"],
  [/\bthere is\b/g, "there's"],
  [/\bhere is\b/g, "here's"],
  [/\bdo not\b/gi, "don't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bdid not\b/gi, "didn't"],
  [/\bcannot\b/gi, "can't"],
  [/\bcan not\b/gi, "can't"],
  [/\bwill not\b/gi, "won't"],
  [/\bis not\b/gi, "isn't"],
  [/\bare not\b/gi, "aren't"],
  [/\bwe will\b/gi, "we'll"],
  [/\byou will\b/gi, "you'll"],
  [/\bwe have\b/gi, "we've"],
  [/\byou are\b/gi, "you're"],
  [/\blet us\b/gi, "let's"],
];

/** Compress one written sentence into one spoken sentence. */
export function speakify(input: string): string {
  let s = stripMarkdown(input);
  for (const [re, to] of SPOKEN) s = s.replace(re, to);
  s = s
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+([.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;:\s]+/, '')
    .trim();
  if (!s) return '';
  s = capitalize(s);
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

const BREAKS = [
  /,\s+(?=which\s)/i,
  /,\s+(?=and\s)/i,
  /,\s+(?=but\s)/i,
  /;\s+/,
  /\s+—\s+/,
  /\s+–\s+/,
  /,\s+(?=so\s)/i,
];

/** Split a sentence longer than `maxWords` at a natural clause boundary. */
export function splitLong(sentence: string, maxWords = 22): string[] {
  if (wordCount(sentence) <= maxWords) return [sentence];
  for (const re of BREAKS) {
    const m = sentence.match(re);
    if (!m || m.index === undefined) continue;
    const head = sentence.slice(0, m.index).trim();
    const tail = sentence.slice(m.index + m[0].length).trim();
    if (wordCount(head) < 4 || wordCount(tail) < 4) continue;
    return [
      ...splitLong(`${head.replace(/[,;—–]$/, '')}.`, maxWords),
      ...splitLong(capitalize(tail), maxWords),
    ];
  }
  return [sentence];
}

/** Words that must never be the last thing said in a sentence. */
const DANGLING =
  /\s+(?:a|an|the|and|or|but|of|to|in|on|at|by|for|with|from|as|is|are|was|were|be|been|that|which|its|their|his|her|this|these|those|not|no|any|some|more|less|very|also|such|about|into|than|then|so|if|when|while|because|how|what|it|they|we|you|he|she|there|here)$/i;

/** Verbs that leave a sentence hanging without their object. */
const TRANSITIVE =
  /\s+(?:get|gets|getting|take|takes|taking|make|makes|making|give|gives|giving|use|uses|using|need|needs|keep|keeps|put|puts|reach|reaches|become|becomes|call|calls|show|shows|find|finds|do|does|have|has|want|wants|let|lets|see|sees|know|knows|say|says|add|adds|set|sets)$/i;

/** Cut a sentence down to `maxWords`, preferring a clause boundary. */
export function clampSentence(sentence: string, maxWords: number): string {
  if (wordCount(sentence) <= maxWords) return sentence;
  const parts = splitLong(sentence, maxWords);
  const first = parts[0];
  if (first && wordCount(first) <= maxWords) return first;
  let kept = words(sentence).slice(0, maxWords).join(' ');
  // "…and takes a." is worse than a slightly shorter, complete-sounding clause.
  kept = tidyTail(kept);
  return `${kept.replace(/[,;:]$/, '')}.`;
}

/**
 * Narration for a list or a sequence of steps: say every item, in order, so the
 * spoken track and the diagram on the board stay in lockstep. Steps get ordinal
 * connectives; peers get a comma list.
 */
export function composeItems(
  items: string[],
  ordered: boolean,
  lead: string | undefined,
  maxWords: number,
): string {
  const clean = items.map((i) => stripMarkdown(i).replace(/[.;:,]+$/, '')).filter(Boolean);
  if (!clean.length) return '';

  const build = (perItem: number): string => {
    const short = clean.map((i) => trimWords(i, perItem));
    if (ordered) {
      const parts = short.map((item, k) => {
        const connective = k === 0 ? 'First, ' : k === short.length - 1 ? 'Finally, ' : 'Then ';
        return `${connective}${lowerFirst(item)}.`;
      });
      return speakify(parts.join(' ').replace(/\.\./g, '.'));
    }
    const spoken = short.map(lowerFirst);
    const listed =
      spoken.length > 1
        ? `${spoken.slice(0, -1).join(', ')}, and ${spoken[spoken.length - 1]}`
        : spoken[0]!;
    const opener = lead ? `${stripMarkdown(lead).replace(/[.:]$/, '')}: ` : 'Watch out for ';
    return speakify(`${opener}${lowerFirst(listed)}.`);
  };

  for (const per of [12, 8, 6, 4, 3]) {
    const text = build(per);
    if (wordCount(text) <= maxWords || per === 3) return text;
  }
  return build(3);
}

function trimWords(s: string, max: number): string {
  const w = s.split(/\s+/).filter(Boolean);
  if (w.length <= max) return s;
  return tidyTail(w.slice(0, max).join(' '));
}

/** Drop trailing words that leave the clause dangling. */
function tidyTail(input: string): string {
  let kept = input;
  for (let i = 0; i < 6; i++) {
    const next = kept.replace(DANGLING, '').replace(TRANSITIVE, '');
    if (next === kept) break;
    kept = next;
  }
  return kept;
}

/** Lower-case a leading word unless it looks like a name or an acronym. */
function lowerFirst(s: string): string {
  const first = s.split(/\s+/)[0] ?? '';
  if (!first) return s;
  // "A learning rate…" mid-sentence should not read as an initial.
  if (first.length === 1) return s[0]!.toLowerCase() + s.slice(1);
  if (first.toUpperCase() === first) return s;
  if (/^[A-Z][a-z]+[A-Z]/.test(first)) return s;
  return s[0]!.toLowerCase() + s.slice(1);
}

/**
 * Openers that make consecutive beats feel like one person talking rather than
 * a list of captions. Chosen by beat index so plans stay deterministic.
 */
const OPENERS = ['', '', 'So ', '', 'Now, ', '', "Here's the idea. ", '', 'And ', '', 'Next, ', ''];

const ALREADY_CONNECTED = /^(so|now|next|and|but|then|first|second|third|finally|here|that|this|in|when|if)\b/i;

export type NarrationOptions = {
  /** Beat index, used to vary spoken openers deterministically. */
  index?: number;
  /** Word budget for the beat. */
  minWords?: number;
  maxWords?: number;
  /** Longest single sentence before it is split. */
  maxSentenceWords?: number;
};

/**
 * Write the narration for one beat from its source sentences.
 *
 * Selection keeps the topic sentence (writers put the point first), then adds
 * the most information-dense remaining sentences in document order until the
 * word budget is spent. Nothing is dumped verbatim: every sentence goes through
 * `speakify` and long ones are broken at clause boundaries.
 */
export function writeNarration(source: string | string[], opts: NarrationOptions = {}): string {
  const minWords = opts.minWords ?? 12;
  const maxWords = opts.maxWords ?? 30;
  const maxSentenceWords = opts.maxSentenceWords ?? 22;

  const raw = Array.isArray(source) ? source.flatMap((s) => sentences(s)) : sentences(source);
  const candidates: string[] = [];
  for (const s of raw) {
    for (const part of splitLong(speakify(s), maxSentenceWords)) {
      const clean = speakify(part);
      if (wordCount(clean) >= 3) candidates.push(clampSentence(clean, maxSentenceWords));
    }
  }
  if (!candidates.length) {
    const fallback = speakify(Array.isArray(source) ? source.join(' ') : source);
    return fallback || '';
  }

  // Score by content density so a filler sentence loses to a substantive one.
  const scored = candidates.map((s, i) => ({
    s,
    i,
    score: density(s) - i * 0.05 + (i === 0 ? 0.6 : 0),
  }));
  const picked: number[] = [];
  let total = 0;
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    const n = wordCount(c.s);
    if (total > 0 && total + n > maxWords) continue;
    picked.push(c.i);
    total += n;
    if (total >= minWords && picked.length >= 2) break;
    if (total >= maxWords) break;
  }
  if (!picked.length) picked.push(0);
  picked.sort((a, b) => a - b);

  let text = picked.map((i) => candidates[i]!).join(' ');
  const opener = OPENERS[(opts.index ?? 0) % OPENERS.length] ?? '';
  if (opener && !ALREADY_CONNECTED.test(text) && wordCount(text) + 2 <= maxWords + 4) {
    text = opener.endsWith(' ') && /^[A-Z]/.test(text) && opener !== "Here's the idea. "
      ? `${opener}${text[0]!.toLowerCase()}${text.slice(1)}`
      : `${opener}${text}`;
  }
  return text.replace(/\s{2,}/g, ' ').trim();
}

/** Fraction of a sentence's words that carry topical information. */
function density(s: string): number {
  const w = words(s);
  if (!w.length) return 0;
  const content = w.filter((x) => x.length > 4).length;
  const numbers = w.filter((x) => /\d/.test(x)).length;
  return content / w.length + Math.min(0.2, numbers * 0.05);
}

/**
 * Locate, as a fraction of the narration, where a term is first spoken. Used to
 * time an element's entrance to the words that introduce it.
 */
export function mentionFraction(narration: string, term: string): number | undefined {
  const w = words(narration).map((x) => x.toLowerCase());
  if (!w.length) return undefined;
  const target = words(term).map((x) => x.toLowerCase()).filter((x) => x.length > 2);
  if (!target.length) return undefined;
  for (let i = 0; i < w.length; i++) {
    for (const t of target) {
      const word = w[i]!;
      if (word === t || (t.length > 4 && word.startsWith(t.slice(0, Math.max(4, t.length - 2))))) {
        return i / w.length;
      }
    }
  }
  return undefined;
}
