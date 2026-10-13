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

/**
 * The half of `normalizeWhitespace` that a listing survives.
 *
 * Line endings, non-breaking spaces and smart quotes — substitutions that swap a character
 * for the character it stands for, and never change how many there are. Split out because
 * `parseBlocks` has to normalise a document *without* normalising the fenced blocks inside
 * it (plan item 6.2): a code block's leading spaces are its block structure, and collapsing
 * them deleted the one thing the code lane exists to preserve — before the lane ever saw it.
 */
export function normalizeChars(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Runs of spaces and tabs collapsed to one, and the ends trimmed. Prose only. */
export function collapseSpaces(s: string): string {
  return s.replace(/[ \t]+/g, ' ').trim();
}

/** Collapse whitespace, normalise quotes and dashes. */
export function normalizeWhitespace(s: string): string {
  return normalizeChars(s)
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
 *
 * The added prepositions, auxiliaries and determiners are the ones the first
 * version happened not to hit: the list was written from the failures on one
 * board rather than from the closed classes it is really enumerating, so
 * "through", "has", "against" and "each" were as danglable as "of" and "is" all
 * along and simply had not shipped a caption yet.
 */
const DANGLING =
  /^(?:the|a|an|and|or|but|nor|of|to|in|on|at|by|for|from|with|within|without|into|onto|unto|upon|through|throughout|across|along|around|against|toward|towards|between|among|amongst|amid|beyond|beneath|below|above|behind|beside|inside|outside|during|before|after|since|until|till|near|atop|as|is|are|was|were|be|been|being|am|has|have|had|do|does|did|can|could|shall|should|will|would|may|might|must|that|which|who|whose|whom|it|its|this|these|those|so|such|than|then|when|whenever|while|whereas|where|wherever|how|why|if|unless|whether|though|although|because|about|over|under|per|via|plus|versus|one|each|every|another|you|your|we|our|they|their|he|she|his|her)$/i;

/**
 * Words that can only be read as modifiers of a noun that the cut removed.
 *
 * Defect 0b shipped as "A charged battery is lithium held on the wrong" — nine
 * words, `captionWords: 9`, and the tenth word was "side". Every word in that
 * caption passed `DANGLING`, because "wrong" is not a function word; it is an
 * adjective, and an adjective left at the end of a cut promises a noun exactly
 * the way "of" promises an object.
 *
 * This list is deliberately narrower than "adjectives", because most adjectives
 * are perfectly good endings — "the slope is steep", "the gap is empty" — and a
 * list that trimmed those would turn good captions into stubs. What is in here
 * is the two classes that cannot stand alone in a noun phrase: attributive-only
 * modifiers ("mere", "sheer", "own", "same", "other"), and the comparative /
 * superlative / ordinal degrees, which are always *the something-est thing*.
 *
 * "right" and "left" are deliberately absent: "the ball rolls to the right" is a
 * finished sentence and this list has no way to tell it from "the right answer".
 * The two guards in `shorten` — a clause word as the first casualty, and a
 * determiner in front of the adjective — are what keep the rest of the list from
 * firing on a predicative or adverbial use. Both were found by measurement, not
 * by reasoning: over the two shipped lessons the unguarded list cut "Measuring
 * north is easy. The sun climbs higher" back to "…The sun climbs", because
 * "higher" there modifies the verb and there was no noun coming.
 */
const DANGLING_ADJ =
  /^(?:wrong|whole|entire|main|mere|sheer|utter|own|same|other|various|several|particular|respective|overall|single|only|further|additional|extra|upper|lower|inner|outer|opposite|previous|following|remaining|first|second|third|fourth|fifth|next|last|final|more|most|less|least|better|best|worse|worst|bigger|biggest|smaller|smallest|larger|largest|higher|highest|lowest|longer|longest|shorter|shortest|greater|greatest|faster|fastest|slower|slowest|stronger|strongest|weaker|weakest|deeper|deepest|wider|widest|narrower|narrowest|heavier|heaviest|lighter|lightest|harder|hardest|easier|easiest)$/i;

/**
 * Words that start a new clause, so the words before them are already finished.
 *
 * This is the guard that lets `DANGLING_ADJ` be used at all. "The answer is
 * wrong because the slope points uphill" cut at "wrong" is a complete thought
 * whose *next* word begins a new clause; "lithium held on the wrong side" cut at
 * "wrong" is a noun phrase with its head torn off. The difference is not in the
 * caption — the two are identical up to the cut — it is in the word that was
 * dropped, which is why the cut has to look at what it removed and not only at
 * what it kept.
 */
const CLAUSE_HEAD =
  /^(?:and|or|but|nor|so|because|since|as|although|though|while|whereas|whether|if|unless|until|when|whenever|where|wherever|which|who|whom|whose|that|then|therefore|thus|however|yet|before|after|once|too|also|instead|rather)$/i;

/**
 * Words that open a noun phrase, so whatever modifier follows them is waiting on
 * a noun.
 *
 * The second guard on `DANGLING_ADJ`, and the one that does most of the work. A
 * comparative after a determiner or a preposition is attributive — "on the wrong
 * ‹side›", "made of larger ‹grains›" — while the same word after a verb is
 * adverbial and finished: "the sun climbs higher", "the ball rolls faster". One
 * word of left context tells those apart, which no list of adjectives can.
 */
const NP_OPENER =
  /^(?:the|a|an|its|his|her|their|our|your|my|this|that|these|those|each|every|any|no|one|two|three|of|to|in|on|at|by|for|from|with|into|onto|than|as|very|much|even|still|next)$/i;

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
 *
 * Retreating to the previous phrase boundary is *preferred* to emitting a
 * dangling word: dropping the dangling tail is that retreat, and it drops the
 * whole phrase rather than two thirds of it — "on the wrong side of a gap" goes
 * entirely, because a phrase is the unit that reads as finished, not a word
 * count.
 *
 * The punctuation break is still the *first* one that fits and not the last, and
 * that is a deliberate restraint rather than an oversight. Taking the last break
 * in range keeps more of the sentence and reads no worse — measured over the two
 * shipped lessons it improves six captions, e.g. "Nothing tells you how far to
 * go" becoming "…, only which way" — but it also rewrites captions that had no
 * defect, and all four pinned storyboard hashes move for cuts that were never
 * broken. Defect 0b is a caption that ends mid-phrase; picking a later boundary
 * is a different change, worth making on its own with its own re-pinning.
 *
 * The shipped failure this was extended for is defect 0b: "A charged battery is
 * lithium held on the wrong", from `A charged battery is lithium held on the
 * wrong side.` at `captionWords: 9`. Nothing in the old list matched "wrong", so
 * the cut emitted it and the board promised a noun it never wrote. See
 * `DANGLING_ADJ` for why the fix is a narrow list and two guards rather than
 * "trim adjectives".
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
  const tokens = clean.split(/\s+/);
  const kept = tokens.slice(0, max);
  // The first word the budget cut off, which is the only evidence available about
  // whether the cut landed inside a phrase or between two of them. A trailing
  // adjective is trimmed only in the first case; see `CLAUSE_HEAD`. Punctuation
  // needs no guard here because both lists are anchored, so a token that carries
  // a comma or a full stop matches neither and stops the loop on its own.
  const casualty = (tokens[max] ?? '').replace(/^[^\p{L}\p{N}]+/u, '');
  const midPhrase = casualty !== '' && !CLAUSE_HEAD.test(casualty);
  return unpaired(trimDangling(kept, midPhrase), casualty)
    .join(' ')
    .replace(/[,;:.\-–—]+$/, '');
}

/**
 * Trim words off the end of a cut that promise a word the cut removed.
 *
 * Shared by both shorteners, because "how do you finish a cut" is one question:
 * `DANGLING` is the closed classes (a determiner, a preposition, an auxiliary) and
 * `DANGLING_ADJ` — guarded, see its own note — is the attributive-only modifiers.
 */
function trimDangling(tokens: readonly string[], midPhrase: boolean): string[] {
  const kept = [...tokens];
  while (kept.length > 1) {
    const last = kept[kept.length - 1] as string;
    const before = kept[kept.length - 2] as string;
    const adjective = midPhrase && DANGLING_ADJ.test(last) && NP_OPENER.test(before);
    if (!DANGLING.test(last) && !adjective) break;
    kept.pop();
  }
  return kept;
}

/**
 * A correlative whose second half the cut removed, and the words in front of it.
 *
 * The defect this closes, from a shipped film: "Falling is a tug of war between a
 * bigger pull and a bigger inertia" at nine words came out as **"Falling is a tug of
 * war between bigger pull"**, which QC's frame-vision flagged. Every guard above
 * passes it — the cut landed on "and", which is a clause head, so the mid-phrase
 * rule is off; the last kept word is "pull", which is an ordinary noun. Nothing
 * looking at the *end* of the caption can see the problem, because the problem is
 * "between", six words earlier, still waiting for its second object.
 *
 * So this looks at the one thing that identifies the case exactly: the cut fell on a
 * coordinator, and the retained words open a correlative that coordinator was going
 * to close. `between … and`, `either … or`, `neither … nor`, `from … to`. The head
 * is re-cut in front of the opener, which is the last place the phrase was finished.
 *
 * Deliberately narrow. "a difference between two places" cut after "two" is not this
 * — its casualty is a noun, not a coordinator — and firing there would shorten a
 * caption that reads perfectly well.
 */
const CORRELATIVE = /^(?:between|either|neither|from)$/i;
const COORDINATOR = /^(?:and|or|nor|to)$/i;

function unpaired(kept: readonly string[], casualty: string): string[] {
  if (!COORDINATOR.test(casualty)) return [...kept];
  const bare = (t: string): string => t.replace(/[^\p{L}\p{N}'-]/gu, '');
  for (let i = kept.length - 1; i > 0; i--) {
    if (!CORRELATIVE.test(bare(kept[i] as string))) continue;
    // Already closed inside the caption — "between A and B, between C" — so the
    // opener this cut orphaned is not this one.
    if (kept.slice(i + 1).some((t) => COORDINATOR.test(bare(t)))) return [...kept];
    // Never down to a stub. A correlative that opens the phrase — "Either the ball
    // speeds up **or** …" — has nothing in front of it to fall back to, and one word
    // is not a caption. The broken cut is the better of the two bad answers there.
    const head = trimDangling(kept.slice(0, i), true);
    return head.length >= 2 ? head : [...kept];
  }
  return [...kept];
}

/** Longest common word overlap ratio, for matching a term to narration. */
export function overlap(a: string, b: string): number {
  const A = new Set(keywords(a));
  if (A.size === 0) return 0;
  let hit = 0;
  for (const w of new Set(keywords(b))) if (A.has(w)) hit++;
  return hit / A.size;
}
