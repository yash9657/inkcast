/**
 * Landing each part of a drawing on the words that name it.
 *
 * ## The defect this exists for
 *
 * A beat asks for one picture and gets one cue, and the compiler used to hand that single
 * cue to every stroke of it (`compile.ts`, "one picture, one moment"). For a drawing of
 * three strokes that is right — a hillside, the fog on it and the figure on it are one
 * gesture, and scattering them across the beat by a guess was a measured defect. For a
 * drawing of thirty marks it is the *opposite* defect, and `synccheck.mts` measured it on
 * the shipped film: in the recap, thirty elements resolved to one phrase and were then
 * stepped a tenth of a second apart, so the board sat empty for six seconds of a ten
 * second beat and then drew the entire cell in the last three — every stroke of it while
 * the narrator was three sentences past what it showed.
 *
 * Neither "all together" nor "spread evenly" is what a person does. A person draws the
 * left stack while saying *the left stack*, then the gap while saying *the gap*, then the
 * ion while saying *a lithium ion crosses it*. The picture and the sentence advance
 * together, which is the whole of what makes a board legible.
 *
 * ## Why this is possible here and nowhere else
 *
 * Because the drawing author names its marks. `DRAW_BRIEF` insists on it — `left-stack`,
 * `damp-gap`, `ion-1`, not `rect-3` — and that name is the part in the same words the
 * lesson stage was writing narration in, about the same subject, in the same beat. So the
 * match is not a heuristic over the narration's rarest words (which is what `cues.ts`
 * does, and it is a guess by construction): it is the mark's own name, found verbatim in
 * the sentence. A mark called `damp-gap` in a beat that says "across the damp gap" is not
 * a coincidence to be scored, it is an answer.
 *
 * That is also why this cannot live in the cached drawing. `drawKey` is the instruction
 * and nothing else, deliberately, so two lessons share a picture — and a cue is a
 * quotation from *one* beat's narration. The names travel with the drawing; the words
 * they land on are resolved here, per beat, against the narration that beat actually got.
 *
 * ## What happens to a mark whose name is not spoken
 *
 * It is placed *between* the marks that were, in proportion to where it sits in drawing
 * order. A hatch, a dot scatter and a leader arrow have no name a narrator would ever
 * say, so nothing can be looked up for them — but their position in the sequence is
 * known, and the two named marks either side of them are pinned to real words, so the
 * words in between are the answer.
 *
 * The first version of this took the simpler rule — an unnamed mark joins the gesture in
 * front of it — and `tandemcheck.mts` caught what that costs. It is right in the middle
 * of a drawing and wrong at both ends: on beat s1 the first mark's own name was not
 * spoken until 61% of the way through, so the board sat empty for six of ten seconds and
 * then drew twenty-three marks, which is the defect this module exists to remove,
 * reproduced by its fix. Interpolation has no ends to get wrong — a run before the first
 * name spreads from the opening words, a run after the last spreads to the closing ones
 * — and it keeps the gesture anyway, because a hatch one mark behind its box interpolates
 * to one step behind its box.
 */
import type { Mark } from '@inkcast/core';
import { STOPWORDS, singular } from './text.js';

/** Words in a cue phrase, matching `deriveCues` so both read the same on the board. */
const CUE_WORDS = 3;

/**
 * Name fragments too generic to be a part.
 *
 * These are shapes and positions rather than things: a mark called `left-box` matching on
 * "left" would land the box on any sentence with a direction in it, which is a guess
 * wearing the costume of an answer. `main`, `outer` and their kind are the same. What is
 * left after this filter is the vocabulary of the subject — `stack`, `gap`, `ion`,
 * `graphite`, `electron` — which is exactly the vocabulary the narration is written in.
 */
const GENERIC = new Set([
  'box',
  'rect',
  'shape',
  'circle',
  'ellipse',
  'line',
  'arrow',
  'label',
  'text',
  'dot',
  'dots',
  'hatch',
  'mark',
  'left',
  'right',
  'top',
  'bottom',
  'upper',
  'lower',
  'mid',
  'middle',
  'centre',
  'center',
  'inner',
  'outer',
  'main',
  'big',
  'small',
  'group',
  'part',
  'item',
  'thing',
  'area',
  'region',
  'side',
  'end',
  'edge',
]);

type Token = { word: string; start: number; end: number };

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    if (m.index === undefined) continue;
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Compared singular and lower-case, so "stacks" in the narration names `left-stack`. */
function key(word: string): string {
  return singular(word.toLowerCase().replace(/['’]/g, ''));
}

/**
 * What this mark would be called out loud, most specific first.
 *
 * A label says its own words, and they are the strongest signal there is — a label
 * reading "graphite" is *written* as the narrator says graphite. Otherwise the id, which
 * the brief requires to be the part rather than the shape. Generic fragments are dropped,
 * and digits with them: `ion-1`, `ion-2` and `ion-3` are all the word "ion", which is
 * correct — they are one gesture and the narration names them once.
 */
export function markNames(mark: Mark): string[] {
  const fromId = mark.id
    .split(/[^\p{L}\p{N}]+/u)
    .map(key)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w) && !STOPWORDS.has(w));
  const fromText =
    mark.kind === 'label'
      ? (mark.text ?? '')
          .split(/[^\p{L}\p{N}]+/u)
          .map(key)
          .filter((w) => w.length >= 3 && !GENERIC.has(w) && !STOPWORDS.has(w))
      : [];
  // De-duplicated, label words first: a label's text is what the board writes, so a mark
  // that both is named `cathode` and writes "cathode" should be looked up once.
  return [...new Set([...fromText, ...fromId])];
}

/**
 * Where in `tokens` this mark's name is spoken, or -1.
 *
 * Two names that both occur wins over one that does — `damp-gap` in a beat saying "the
 * damp gap" should land on that phrase and not on an earlier bare "gap" — so an adjacent
 * pair is looked for first and single words only after.
 */
function findName(names: string[], tokens: Token[], keys: string[], from: number): number {
  if (!names.length) return -1;
  const want = new Set(names);
  if (names.length > 1) {
    for (let i = Math.max(0, from); i < tokens.length - 1; i++) {
      if (want.has(keys[i] as string) && want.has(keys[i + 1] as string)) return i;
    }
  }
  for (let i = Math.max(0, from); i < tokens.length; i++) {
    if (want.has(keys[i] as string)) return i;
  }
  return -1;
}

/**
 * A verbatim phrase of `narration` starting at token `i`.
 *
 * Verbatim and character-exact, because the voice stage finds a cue by searching the text
 * it spoke. Three words, so it is distinctive enough to occur once without being long
 * enough to straddle a clause boundary.
 */
function phraseAt(narration: string, tokens: Token[], i: number): string | undefined {
  const first = tokens[i];
  const last = tokens[Math.min(tokens.length - 1, i + CUE_WORDS - 1)];
  if (!first || !last) return undefined;
  const text = narration.slice(first.start, last.end).trim();
  return text || undefined;
}

/**
 * Below this many marks, a drawing is one gesture and keeps the beat's own cue.
 *
 * The rule this module replaces is right for a small drawing and only for a small one. A
 * hillside, the fog across it and the figure standing on it are three strokes of one
 * action, and scattering them over three phrases was a measured defect — so a drawing
 * that could be made in one movement of the hand is left alone entirely. Past that it is
 * a diagram being built part by part, which is the case here.
 */
const GESTURE_MARKS = 6;

/**
 * How far into the narration the last mark may be placed by interpolation.
 *
 * A picture has to be finished, and seen to be finished, while there are still words left
 * to say about it — a stroke landing on the final syllable is a stroke nobody watches
 * arrive. A mark whose own name is genuinely spoken later than this keeps that word: the
 * narration saying it last is the narration saying draw it last.
 */
const TAIL = 0.86;

/**
 * How far past its turn in the drawing a mark's name may be spoken and still be its cue.
 *
 * A name occurs where it occurs, and the same word can be said about two different things
 * — which is how the first version of this put beat s1's opening stroke 61% of the way
 * into its beat. The drawing there opens on the left electrode, the narration opens on
 * "two flat stacks facing each other", and the author had named the mark `graphite-
 * outline` after the *material*: the only "graphite" in the beat is two sentences later,
 * in "called graphite". Matched forward, that one word dragged the first stroke past the
 * middle of the beat and, because the search cannot go back, took the twenty-two marks
 * behind it along.
 *
 * So a match has to agree with the drawing, not only with the narration. Drawing order is
 * a person's order and it tracks the sentence — that is the assumption this whole module
 * rests on — so a mark a quarter of the beat out of step with its own position is not
 * being named, it is colliding with another mention of the same word. Its neighbours
 * place it better than that word does.
 *
 * Generous on purpose: this is here to reject a mark landing in a different part of the
 * beat, not to hold the drawing to an even spread it has no reason to obey.
 */
const DRIFT = 0.25;

/**
 * A cue per mark, in the order the marks are drawn.
 *
 * `undefined` means "leave the caller's own answer standing" — the intent's cue — and is
 * returned for every mark of a drawing small enough to be one gesture, or one with no
 * narration to match against.
 *
 * The name search only ever moves forward through the narration. That is not an
 * optimisation: drawing order is a person's order (containers, then parts, then
 * connectors, then names) and it has to agree with the sentence, or the board draws the
 * wire while the narrator is still on the electrode and has nothing left to draw when it
 * gets there. A name that occurs only *behind* the cursor is treated as unspoken, and the
 * mark is placed by its neighbours instead.
 */
export function cueMarks(marks: readonly Mark[], narration: string): (string | undefined)[] {
  const out: (string | undefined)[] = new Array(marks.length).fill(undefined);
  const tokens = tokenize(narration);
  if (!tokens.length || marks.length < GESTURE_MARKS) return out;
  const keys = tokens.map((t) => key(t.word));
  const n = marks.length;

  /* --- pin every mark the narration names, in order --- */

  const anchors: { k: number; token: number }[] = [];
  let cursor = 0;
  marks.forEach((mark, k) => {
    const hit = findName(markNames(mark), tokens, keys, cursor);
    if (hit < 0) return;
    // Where this mark's turn falls if the drawing and the sentence keep step exactly.
    const turn = ((tokens.length - 1) * k) / Math.max(1, n - 1);
    if (hit > turn + (tokens.length - 1) * DRIFT) return;
    anchors.push({ k, token: hit });
    // One word past the match, not past the whole cue phrase: two parts named in the same
    // clause ("the gap between the two stacks") must each get their own word, and a
    // three-word stride would swallow the second.
    cursor = hit + 1;
  });

  /* --- and place the rest between them --- */

  // Virtual anchors at both ends, so a run before the first name spreads from the opening
  // words and a run after the last spreads towards the closing ones rather than piling up
  // on whichever real anchor happens to be nearest.
  const last = tokens.length - 1;
  const fence = [
    { k: -1, token: 0 },
    ...anchors,
    { k: n, token: Math.max(anchors[anchors.length - 1]?.token ?? 0, Math.round(last * TAIL)) },
  ];

  let placed = 0;
  for (let seg = 0; seg + 1 < fence.length; seg++) {
    const a = fence[seg] as { k: number; token: number };
    const b = fence[seg + 1] as { k: number; token: number };
    for (let k = Math.max(0, a.k); k < Math.min(n, b.k + 1); k++) {
      if (out[k] !== undefined) continue;
      const span = b.k - a.k;
      const token =
        k === a.k && a.k >= 0
          ? a.token
          : Math.round(a.token + ((b.token - a.token) * (k - a.k)) / Math.max(1, span));
      const phrase = phraseAt(narration, tokens, Math.min(last, Math.max(0, token)));
      if (phrase) {
        out[k] = phrase;
        placed += 1;
      }
    }
  }

  // A drawing the narration names nothing in is not a drawing this can time. Spreading it
  // over words chosen only by arithmetic is the guess `cues.ts` already makes and the one
  // the intent's single cue was introduced to stop, so it is handed back untouched.
  if (!anchors.length || !placed) return new Array(n).fill(undefined);
  return out;
}
