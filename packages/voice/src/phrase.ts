/**
 * Phrase splitting — how the voice stage learns where the words actually are.
 *
 * Cue resolution needs to know, in seconds, when a particular phrase is spoken.
 * There are three ways to get that: guess (what the planner did), run a forced
 * aligner (a Python dependency we will not take), or **synthesise in phrases and
 * measure each one**. The third is exact by construction: if a phrase is its own
 * clip, its start and end are arithmetic, not estimation.
 *
 * So narration is cut on sentence and clause boundaries, each piece is
 * synthesised and measured, and the pieces are re-joined with a deliberate gap.
 * Two details make that sound like speech rather than a splice:
 *
 * 1. **Punctuation is preserved on each phrase.** A clause handed to the engine
 *    as "and you want to reach the valley below," keeps its comma and therefore
 *    keeps continuation intonation. Strip the comma and every clause ends on a
 *    terminal fall, which is what makes naive chunking sound chopped.
 * 2. **Clause splits are conservative.** A comma only becomes a cut when both
 *    sides are substantial (`MIN_CLAUSE_WORDS`), so "w, the weight," never
 *    becomes three clips.
 */
import { splitSentences } from './text.js';

/** Below this, a comma is punctuation rather than a boundary worth cutting on. */
export const MIN_CLAUSE_WORDS = 4;

/**
 * Silence inserted between clauses of the same sentence, in seconds.
 *
 * Small on purpose: the engine's own trimmed tail already leaves a few tens of
 * milliseconds, and this rides on top of it.
 */
export const PHRASE_GAP_SEC = 0.07;

/** Silence between ordinary sentences — an idea boundary, so it is audible. */
export const SENTENCE_GAP_SEC = 0.24;

/**
 * How long the pause after a sentence is, by how much the sentence was.
 *
 * A flat gap after every sentence is what "so many unnatural pauses" turned out to mean. A
 * measured render put **35 pauses into two minutes** — one every 3.5 seconds — all of them
 * 0.24s, because good spoken teaching is written in short sentences and every one of them
 * was treated as a full stop. At that density a uniform pause stops reading as punctuation
 * and starts reading as a machine.
 *
 * So the gap is graduated by the length of the sentence that just ended: a four-word line
 * in a run barely breathes, an ordinary sentence gets what it always got, a long one that
 * carried a real claim gets room to land. Measured on the same lesson, the graduated scheme
 * spends **8.4s across five distinct lengths** where the flat one spent 8.8s across one —
 * more shape, slightly less silence, and the speaking rate stays inside the teaching band.
 *
 * A first cut used two tiers and made every sentence of seven words or more a landing. That
 * put 19 long pauses in and pushed the delivered rate *below* the band: the fix for a flat
 * rhythm is not a slower one.
 */
const GAP_BY_WORDS: readonly [maxWords: number, gap: number][] = [
  // A run of short sentences is one thought delivered in beats, not three thoughts.
  [7, 0.1],
  [12, SENTENCE_GAP_SEC],
  [Infinity, 0.42],
];

/**
 * Gap after a question, the longest there is: the silence is the point, because the learner
 * is meant to attempt an answer before being told it.
 */
const QUESTION_GAP_SEC = 0.6;

export type Phrase = {
  /**
   * Exactly what the engine is asked to say, punctuation included. Never
   * re-normalise this: it has already been through `normalizeNarration`.
   */
  text: string;
  /** Zero-based index of the sentence this phrase belongs to. */
  sentence: number;
  /** True when this phrase carries its sentence's terminal punctuation. */
  endsSentence: boolean;
  /**
   * Words in the whole sentence this phrase belongs to, not just in this phrase.
   *
   * Recorded at the split because that is the only place it is known: in `clause` mode the
   * terminal phrase of a ten-word sentence can itself be three words, and `gapAfter` was
   * about to call that a run and clip the pause. Length is a property of the sentence.
   */
  sentenceWords: number;
};

export type PhraseSplit = 'clause' | 'sentence';

export type SplitOptions = {
  /**
   * `clause` cuts inside sentences at commas, semicolons and colons, which buys
   * sub-sentence cue precision. `sentence` is the conservative mode for engines
   * whose prosody suffers from short inputs.
   */
  mode?: PhraseSplit;
  minClauseWords?: number;
};

function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/**
 * Cut one already-normalised sentence into clauses.
 *
 * The delimiter stays with the clause it closes, and a cut is only made when the
 * text on *both* sides is long enough to be worth a boundary — otherwise the
 * clause keeps growing.
 */
export function splitClauses(sentence: string, minWords = MIN_CLAUSE_WORDS): string[] {
  const s = sentence.trim();
  if (!s) return [];

  const clauses: string[] = [];
  let start = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== ',' && c !== ';' && c !== ':') continue;

    const head = s.slice(start, i + 1);
    const tail = s.slice(i + 1);
    if (wordCount(head) < minWords || wordCount(tail) < minWords) continue;

    clauses.push(head.trim());
    start = i + 1;
  }

  const rest = s.slice(start).trim();
  if (rest) clauses.push(rest);
  return clauses.length ? clauses : [s];
}

/**
 * Split normalised narration into the phrases that will each become a clip.
 *
 * Input must already be normalised (`normalizeNarration`), because the phrase
 * text is handed straight to the engine and is what gets hashed into the cache
 * key.
 */
export function splitPhrases(text: string, opts: SplitOptions = {}): Phrase[] {
  const mode = opts.mode ?? 'clause';
  const sentences = splitSentences(text);
  const phrases: Phrase[] = [];

  sentences.forEach((sentence, si) => {
    const parts = mode === 'sentence' ? [sentence] : splitClauses(sentence, opts.minClauseWords);
    const sentenceWords = wordCount(sentence);
    parts.forEach((part, pi) => {
      phrases.push({
        text: part,
        sentence: si,
        endsSentence: pi === parts.length - 1,
        sentenceWords,
      });
    });
  });

  return phrases;
}

/**
 * Gap to insert after `phrase`, given what follows it. 0 if nothing follows.
 *
 * A clause boundary inside a sentence is the shortest thing there is; a question is the
 * longest; everything between is `GAP_BY_WORDS`, which is where the reasoning lives.
 *
 * `Scene.hold` still governs the pause *between* beats and `cadence` bounds that, so this
 * is only ever about the rhythm inside one beat.
 */
export function gapAfter(phrase: Phrase, next: Phrase | undefined): number {
  if (!next) return 0;
  if (!phrase.endsSentence) return PHRASE_GAP_SEC;
  if (/\?["')\]]?\s*$/.test(phrase.text)) return QUESTION_GAP_SEC;
  // Measured on the *sentence*, not on this phrase: in `clause` mode the closing phrase of
  // a long sentence can be three words, and it still lands what the sentence built.
  const tier = GAP_BY_WORDS.find(([max]) => phrase.sentenceWords < max);
  return tier?.[1] ?? SENTENCE_GAP_SEC;
}

/* ------------------------------------------------------------------- timing */

/** A phrase plus where it landed in the assembled scene clip. */
export type PhraseTiming = Phrase & {
  /** Seconds from scene start to this phrase's first sample. */
  start: number;
  /** Seconds from scene start to the end of its speech (gap excluded). */
  end: number;
};

/**
 * Warn when the planner has split a sentence across scene boundaries.
 *
 * A sentence cut in half produces exactly the MVP's failure mode — "under you
 * gets gentler" arriving as its own beat — and no amount of audio alignment can
 * repair it, so it has to be reported upstream.
 */
export function sentenceSpanWarnings(narrations: readonly string[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < narrations.length; i++) {
    const text = (narrations[i] ?? '').trim();
    if (!text) continue;

    const unterminated = !/[.!?]["')\]]?$/.test(text);
    const next = (narrations[i + 1] ?? '').trim();
    // A continuation starts lower-case, or with a conjunction that cannot open a
    // sentence that was meant to stand alone.
    const continues =
      /^(?:[a-z]|and\b|but\b|or\b|so\b|because\b|which\b|that\b|then\b)/i.test(next) &&
      /^[a-z]/.test(next);

    if (unterminated && next) {
      warnings.push(
        `scene ${i + 1} narration does not end a sentence ("…${tailOf(text)}") and scene ${i + 2} continues it — ` +
          'a sentence must never span two beats',
      );
    } else if (unterminated) {
      warnings.push(`scene ${i + 1} narration ends mid-sentence ("…${tailOf(text)}")`);
    } else if (continues) {
      warnings.push(
        `scene ${i + 2} narration opens mid-sentence ("${headOf(next)}…") — it reads as a fragment of scene ${i + 1}`,
      );
    }
  }
  return warnings;
}

function tailOf(s: string): string {
  return s.length > 40 ? s.slice(-40) : s;
}

function headOf(s: string): string {
  return s.length > 40 ? s.slice(0, 40) : s;
}
