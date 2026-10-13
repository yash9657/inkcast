/**
 * Cue resolution — landing the picture on the words that introduce it.
 *
 * The MVP measured 25 ms of narration drift across 164 seconds and still felt
 * misaligned, which sounds like a contradiction until you notice what was being
 * measured. Beat-level sync was perfect; *element* timing was a guess. The
 * planner wrote `enter.at: 0.35` and hoped, so a diagram could arrive four
 * seconds before the sentence that named it while the audio was, technically,
 * frame-accurate. A learner does not experience that as good sync. They
 * experience it as drift.
 *
 * `Enter.cue` fixes the authoring end: the planner names a verbatim phrase from
 * the narration instead of inventing a fraction. This module is the other end —
 * it turns that phrase into a real offset and writes the fraction back into
 * `enter.at`, so the renderer keeps its simple fractional model and gains
 * word-accurate placement for free.
 *
 * Precision comes from three sources, best first:
 *
 * 1. **Word timings** (`scene.words`), from a provider that returns them or from
 *    the optional local Whisper aligner. Exact.
 * 2. **Measured phrase boundaries.** Each phrase is its own measured clip, so the
 *    matched token is placed by interpolating inside the phrase that contains it.
 *    Accurate to a fraction of a clause.
 * 3. Nothing. If the phrase cannot be found we warn, name the scene and the cue,
 *    and leave the author's `at` untouched — silently moving an element to a
 *    plausible-looking time would hide the planner's bug.
 *
 * Matching is normalised (case, punctuation, whitespace) and runs the cue through
 * the *same* text pipeline as the narration, so a cue written "the rate is 0.1"
 * still matches narration spoken as "the rate is zero point one".
 *
 * ## Which word, and how we know (plan item 4.1)
 *
 * *Finding* the cue used to be this module's hardest job and is now, for a
 * freshly compiled board, not its job at all. The compiler writes
 * `enter.cueWord` — the index of the cue's first spoken word, taken with the
 * tokeniser this file counts with (`@inkcast/core`'s `speech.ts`) — and
 * resolution becomes a lookup. That is the shape `docs/PIPELINE.md` argued for
 * from the beginning: an index cannot fail to match or match twice, and a
 * tolerant search on a phrase that occurs twice will anchor a reveal to the wrong
 * occurrence while logging nothing worse than "matched loosely".
 *
 * The search below therefore has two jobs left, and both are temporary:
 *
 * - **A storyboard compiled before 4.1** has cues and no indices. It is placed by
 *   search, every use is reported, and the fallback dies one release after the
 *   corpus has been recompiled.
 * - **An index that no longer names its own cue's first word** is not a
 *   degradation, it is a bug: narration edited without recompiling, or a compiler
 *   and a tokeniser that disagree. It is named as such (`brokenIndices`), gated by
 *   the caller, and — under `degrade` — placed by search so the film still
 *   renders.
 *
 * The one invariant everything above rests on: the token stream built from the
 * *measured phrases* must be the token stream the compiler counted. Phrases are
 * cut at punctuation and `matchTokens` throws punctuation away, so it holds by
 * construction — and is checked anyway, once per scene, because a silent
 * off-by-one in that stream would move every reveal in the beat.
 */
import type { Scene } from '@inkcast/core';
import { cueTokens, findTokens, matchTokens, narrationTokens } from '@inkcast/core';
import type { PhraseTiming } from './phrase.js';
import type { WordTiming } from './providers/types.js';

/**
 * The tokeniser is `@inkcast/core`'s (`speech.ts`), because the planner counts
 * with it too — an `Enter.cueWord` is an index into its stream. Re-exported here
 * so the voice package still answers "how is a cue tokenised".
 */
export { cueTokens, matchTokens } from '@inkcast/core';

/* ------------------------------------------------------------------ matching */

export type TokenSpan = {
  /** Index of the first matched token in the scene's token stream. */
  index: number;
  /** How many tokens matched. */
  length: number;
  /** 1 = every cue token matched in order; lower = fuzzy. */
  score: number;
};

/** Minimum fuzzy score accepted. Below this, a cue is treated as unmatched. */
export const MIN_CUE_SCORE = 0.6;

/**
 * Best window of `haystack` for `needle`, scored on in-order token agreement.
 *
 * This is the tolerance that makes cues usable by an LLM planner: a cue is
 * quoted from narration that then went through symbol and number expansion, so a
 * token or two commonly differs. Order is respected, so a window that merely
 * contains the same words in a different arrangement scores poorly.
 */
function findFuzzy(haystack: readonly string[], needle: readonly string[]): TokenSpan | undefined {
  if (!needle.length) return undefined;
  const width = Math.min(haystack.length, needle.length);
  let best: TokenSpan | undefined;

  for (let i = 0; i + width <= haystack.length; i++) {
    let matched = 0;
    let cursor = 0;
    for (let j = 0; j < needle.length && cursor < width; j++) {
      // Walk forward through the window looking for this cue token.
      for (let k = cursor; k < width; k++) {
        if (haystack[i + k] === needle[j]) {
          matched++;
          cursor = k + 1;
          break;
        }
      }
    }
    const score = matched / needle.length;
    if (!best || score > best.score) best = { index: i, length: width, score };
  }

  return best && best.score >= MIN_CUE_SCORE ? best : undefined;
}

/** Locate a cue in a scene's token stream: exact first, then in-order fuzzy. */
export function findCueSpan(sceneTokens: readonly string[], cue: string): TokenSpan | undefined {
  const needle = cueTokens(cue);
  if (!needle.length) return undefined;

  const exact = findTokens(sceneTokens, needle);
  if (exact >= 0) return { index: exact, length: needle.length, score: 1 };

  // A long cue that has drifted still usually matches on its opening words,
  // which is the part that determines *when* it starts.
  for (let take = needle.length - 1; take >= Math.max(2, Math.ceil(needle.length * 0.5)); take--) {
    const prefix = findTokens(sceneTokens, needle.slice(0, take));
    if (prefix >= 0) return { index: prefix, length: take, score: take / needle.length };
  }

  return findFuzzy(sceneTokens, needle);
}

/* -------------------------------------------------------------- token stream */

/** One token of the scene, tagged with where it came from. */
export type SceneToken = {
  token: string;
  /** Index into the phrase list. */
  phrase: number;
  /** Position of this token within its phrase. */
  slot: number;
  /** How many tokens its phrase has. */
  of: number;
};

/** Flatten measured phrases into one token stream for matching. */
export function sceneTokenStream(phrases: readonly PhraseTiming[]): SceneToken[] {
  const stream: SceneToken[] = [];
  phrases.forEach((phrase, index) => {
    const tokens = matchTokens(phrase.text);
    tokens.forEach((token, slot) => stream.push({ token, phrase: index, slot, of: tokens.length }));
  });
  return stream;
}

/* ------------------------------------------------------------------- placing */

/**
 * Seconds from scene start at which `token` begins.
 *
 * With word timings, the answer is read off directly. Without them, the token is
 * placed proportionally inside its own measured phrase — the phrase boundary is
 * real, so the error is bounded by the length of one clause rather than the
 * length of the scene.
 */
export function tokenOffsetSec(
  token: SceneToken,
  phrases: readonly PhraseTiming[],
  words?: readonly WordTiming[],
  tokenIndex?: number,
): number | undefined {
  if (words?.length && tokenIndex !== undefined) {
    const word = words[tokenIndex];
    if (word && Number.isFinite(word.start)) return Math.max(0, word.start);
  }
  const phrase = phrases[token.phrase];
  if (!phrase) return undefined;
  const span = Math.max(0, phrase.end - phrase.start);
  const fraction = token.of > 0 ? token.slot / token.of : 0;
  return phrase.start + span * fraction;
}

export type CueResolution = {
  elementId: string;
  cue: string;
  /** Offset within the scene, in seconds. */
  offsetSec: number;
  /** The fraction written into `enter.at`. */
  at: number;
  /** 1 = exact token match. */
  score: number;
  /** Which precision tier produced the offset. */
  source: 'words' | 'phrase';
  /**
   * How the *word* was found: the compiler's `enter.cueWord`, or this module
   * searching for the phrase. Orthogonal to `source`, which says how that word
   * was turned into a second — an index resolved against measured phrases is
   * `via: 'index', source: 'phrase'`.
   */
  via: 'index' | 'search';
};

export type ResolveCuesResult = {
  resolved: CueResolution[];
  /** Human-readable problems, each naming the scene and the phrase. */
  warnings: string[];
  /**
   * Unresolvable cues on the beat's *dominant* visual — the main picture, not a
   * decoration. Structured, not just a warning line, because this is the D5
   * defect one scrolled-past log line away from shipping: the beat's picture
   * keeps an authored fallback time while the narration names it somewhere
   * else. The caller decides whether this blocks (strict) or is recorded
   * (degrade); a missed cue on a decoration stays a warning only.
   */
  dominantMisses: Array<{ elementId: string; cue: string }>;
  /**
   * Cues placed by searching for their phrase because they carry no index.
   *
   * A storyboard compiled before plan item 4.1, in other words. Recorded rather
   * than merely logged (plan item 4.2) because "how many reveals in this film were
   * anchored by a search" is the number that decides when the fallback can be
   * deleted, and a log line cannot be counted after the run.
   */
  searched: Array<{ elementId: string; cue: string }>;
  /**
   * An authored index that could not be used, already written out for a human.
   *
   * Not a degradation and not a tolerance: an index is written by the compiler
   * against the narration in the same pass, so it can only be wrong if the
   * narration changed underneath it or two tokenisers disagree. Both are bugs, so
   * the caller gates these rather than recording them — see `narrate()`.
   */
  brokenIndices: string[];
};

/**
 * How late a beat's **dominant** figure may be cued before the picture is held
 * back instead of honoured.
 *
 * A cue is an intent about a moment, but the biggest thing in a beat is not a
 * moment — it is the beat's subject, and the learner has to be looking at it
 * while the reasoning is spoken. Verification of the gradient-descent benchmark
 * caught the failure this prevents: the lesson cued the loss curve on "so draw
 * it as a curve", the last clause of the beat, and the resolver dutifully placed
 * it at 80% of the narration. The result was eight seconds of a title alone in
 * an empty frame, twice — the same "caption in a void" the persistent canvas
 * exists to abolish, reintroduced by perfect sync.
 *
 * So a dominant figure's cue may fine-tune when it lands, never postpone it past
 * the opening of the beat. 0.15 is roughly "the teacher writes the heading, then
 * starts drawing": at 30% a thirteen-second beat still spent four seconds on a
 * caption alone, which frame-by-frame review of the re-render caught. Overlays inside a plot keep their own
 * fractions, so the picture still *builds* on the words; only the frame it builds
 * inside comes up front.
 */
export const MAX_DOMINANT_AT = 0.15;

/**
 * Share of a scene's own ink an element must cover to count as its dominant
 * figure. Above a quarter of the drawn area, its absence *is* an empty frame.
 */
const DOMINANT_SHARE = 0.25;

/** Area of an element's authored box. Zero-area boxes (arrows) never dominate. */
function boxArea(el: Scene['elements'][number]): number {
  return Math.max(0, el.at.w) * Math.max(0, el.at.h);
}

/**
 * The one element whose late arrival would leave the frame empty, or undefined.
 *
 * Text is exempt however large its box, and that exemption is the whole reason
 * cues exist: a line written onto the board exactly as it is spoken is the feature,
 * not the failure. A *picture* held back to the last clause is the failure, because
 * the reasoning is spoken over nothing.
 *
 * Deliberately the *authored box*, not the resolved ink: this runs in the voice
 * stage, before visuals, and the box is what the planner reserved for the figure.
 */
function dominantId(scene: Scene): string | undefined {
  const total = scene.elements.reduce((sum, el) => sum + boxArea(el), 0);
  if (!(total > 0)) return undefined;
  let best: { id: string; area: number } | undefined;
  for (const el of scene.elements) {
    if (el.type === 'text') continue;
    const area = boxArea(el);
    if (!best || area > best.area) best = { id: el.id, area };
  }
  if (!best || best.area / total < DOMINANT_SHARE) return undefined;
  return best.id;
}

/**
 * Least travel time a movement gets, as a fraction of the narration. Below about
 * a fifth of a beat a descent reads as a jump cut, and the movement was the whole
 * reason to animate it.
 */
export const MIN_TRAVEL = 0.18;

/** Fraction of the narration between an element being drawn and starting to move. */
const TRAVEL_LEAD = 0.06;

/**
 * Seconds between two strokes of one gesture.
 *
 * The parts of a picture that share a cue are meant to arrive *together*, and together
 * does not mean simultaneously: a person draws a hillside, then the fog across it, then
 * the figure on it, in quick succession. Resolving each part to the identical instant
 * makes the picture appear as a paste, and a measured render showed three step-marks and
 * four limbs of a figure each landing on one frame.
 *
 * A tenth of a second is fast enough to read as one action and slow enough to read as
 * drawing. It is applied in storyboard order, which is also drawing order — a figure
 * cannot stand on a slope that has not been drawn — so the pass below doubles as the
 * guarantee that an overlay never precedes the thing it annotates.
 */
export const GESTURE_STEP_SEC = 0.1;

/**
 * Point a moving element's cue at the *movement* rather than at its arrival.
 *
 * For everything else a cue answers "when does this appear". For an element with
 * `motion` that is the wrong question: the ball is already on the curve, and the
 * words the planner cued ("the step is smaller") announce it *rolling*, not it
 * existing. The planner says so explicitly where it re-cues an existing mover,
 * then writes the phrase to `enter.cue` because that is the only cue field the IR
 * has — so the resolver has to finish the thought.
 *
 * Left unhandled this was the benchmark's worst animation defect: the resolver
 * moved `enter.at` to 0.9 and left `motion` at 0.46–0.94, so the ball popped in
 * already 91% of the way down and never visibly moved. The fix anchors the window
 * to the cue, guarantees it `MIN_TRAVEL` to run in — sliding it earlier when the
 * cue leaves no room rather than compressing it to a blink — and pulls the
 * element's own entry back in front of it so it is drawn before it travels.
 *
 * Returns the fraction the element should now enter at.
 */
export function anchorMotionToCue(el: Scene['elements'][number], cueAt: number): number {
  const motion = el.motion;
  if (!motion) return cueAt;
  const span = Math.max(MIN_TRAVEL, motion.to - motion.from);
  // Never run past the end of the narration: the tail of a movement that finishes
  // in the `hold` is time the learner spends watching nothing arrive.
  const latest = Math.max(0, 0.97 - span);
  const from = Math.min(cueAt, latest);
  const enter = Math.max(0, Math.min(from - TRAVEL_LEAD, cueAt));
  el.motion = { ...motion, from: round3(from), to: round3(Math.min(0.99, from + span)) };
  return enter;
}

export type ResolveCuesOptions = {
  /** Measured phrase boundaries for this scene, in order. */
  phrases: readonly PhraseTiming[];
  /**
   * Duration `enter.at` is a fraction of: the scene's measured **narration**,
   * excluding `hold`. That is the IR's definition and the renderer's.
   */
  narrationSec: number;
  /** Word timings for this scene, when available. */
  words?: readonly WordTiming[];
  /** Used only in warning text. */
  sceneLabel?: string;
};

/**
 * Resolve every `enter.cue` in a scene and write the result into `enter.at`.
 *
 * Mutates the scene in place — `narrate()` already works on a deep clone — and
 * returns what it did so the caller can log it. An element whose cue cannot be
 * matched keeps the `at` its author gave it.
 */
export function resolveSceneCues(scene: Scene, opts: ResolveCuesOptions): ResolveCuesResult {
  const resolved: CueResolution[] = [];
  const warnings: string[] = [];
  const dominantMisses: ResolveCuesResult['dominantMisses'] = [];
  const searched: ResolveCuesResult['searched'] = [];
  const brokenIndices: string[] = [];
  const label = opts.sceneLabel ?? scene.id;
  const empty = (): ResolveCuesResult => ({
    resolved,
    warnings,
    dominantMisses,
    searched,
    brokenIndices,
  });

  const cued = scene.elements.filter((el) => el.enter.cue?.trim());
  if (!cued.length) return empty();

  if (!(opts.narrationSec > 0)) {
    warnings.push(
      `scene "${label}" has no measured narration, so ${cued.length} cue(s) cannot be resolved`,
    );
    return empty();
  }

  const stream = sceneTokenStream(opts.phrases);
  if (!stream.length) {
    warnings.push(`scene "${label}" has no speakable narration, so its cues cannot be resolved`);
    return empty();
  }

  const tokens = stream.map((s) => s.token);
  // The invariant every index rests on, checked once rather than trusted: the
  // words the clips were cut into are the words the compiler counted. It holds by
  // construction (phrases are cut at punctuation, `matchTokens` discards
  // punctuation) — but an off-by-one here would move every reveal in the beat by
  // one word and look exactly like good sync, so it is not left to construction.
  //
  // Only asked when something in the beat actually carries an index: without one,
  // nothing here reads the stream positionally and a disagreement is not a defect
  // in anything. (It is also how a caller may hand this function measured phrases
  // for narration it is not literally quoting, which several tests do.)
  const anyIndexed = cued.some((el) => el.enter.cueWord !== undefined);
  const authored = anyIndexed ? narrationTokens(scene.narration) : tokens;
  const streamAgrees =
    authored.length === tokens.length && authored.every((t, i) => t === tokens[i]);
  if (!streamAgrees) {
    brokenIndices.push(
      `scene "${label}": the measured phrases tokenise to ${tokens.length} word(s) but its ` +
        `narration tokenises to ${authored.length} — the phrase splitter and the tokeniser ` +
        'disagree, so no cue index in this scene can be trusted',
    );
  }

  const dominant = dominantId(scene);

  // Word timings are only trustworthy as an index into the stream when there is
  // one timing per token; a mismatch means the aligner disagreed with the text,
  // and phrase interpolation is the safer answer.
  const wordsUsable = opts.words?.length === stream.length ? opts.words : undefined;

  for (const el of cued) {
    const cue = el.enter.cue!.trim();
    const span = spanFor(el, cue, tokens, streamAgrees, {
      label,
      searched,
      brokenIndices,
    });

    if (!span) {
      warnings.push(
        `scene "${label}": cue "${cue}" does not appear in its narration — element "${el.id}" keeps enter.at ${el.enter.at}`,
      );
      if (el.id === dominant) dominantMisses.push({ elementId: el.id, cue });
      continue;
    }

    const token = stream[span.index];
    if (!token) continue;

    const offset = tokenOffsetSec(token, opts.phrases, wordsUsable, span.index);
    if (offset === undefined) {
      warnings.push(
        `scene "${label}": cue "${cue}" matched but could not be timed — element "${el.id}" unchanged`,
      );
      continue;
    }

    // Clamped strictly inside the scene: an element that starts exactly at the
    // end never draws, and the renderer would silently swallow it.
    const cueAt = clamp(offset / opts.narrationSec, 0, 0.995);
    // A mover's cue names when it *moves*; its entry goes just in front of that,
    // and the cap below then applies to when it appears, not to when it travels.
    const moving = el.motion !== undefined;
    let at = anchorMotionToCue(el, cueAt);
    if (
      el.id === dominant &&
      at > MAX_DOMINANT_AT &&
      el.type !== 'equation' &&
      el.type !== 'text'
    ) {
      if (!moving) {
        warnings.push(
          `scene "${label}": cue "${cue}" lands at ${Math.round(at * 100)}% of the narration, but ` +
            `"${el.id}" is the beat's main picture — held to ${Math.round(MAX_DOMINANT_AT * 100)}% ` +
            'so the frame is not empty while the idea is being spoken. Cue the figure on an ' +
            'opening phrase and let its overlays carry the later words.',
        );
      }
      at = MAX_DOMINANT_AT;
    }
    el.enter.at = round3(at);
    resolved.push({
      elementId: el.id,
      cue,
      offsetSec: round3(offset),
      at: round3(at),
      score: round3(span.score),
      source: wordsUsable ? 'words' : 'phrase',
      via: span.via,
    });

    if (span.score < 1) {
      warnings.push(
        `scene "${label}": cue "${cue}" matched loosely (${Math.round(span.score * 100)}%) — ` +
          'quote the narration verbatim for exact placement',
      );
    }
  }

  spreadGesture(scene, opts.narrationSec, resolved);
  return empty();
}

/**
 * Where in the token stream this element's cue starts, and how that was decided.
 *
 * The order is the whole of plan item 4.1: an authored index if there is one and it
 * still names its cue's own first word, otherwise the phrase search, with the
 * reason for the demotion recorded either way. Nothing here throws — a film that
 * stops rendering because a cue moved by one word is worse than one that places it
 * by search and says so — and the caller turns `brokenIndices` into an error under
 * `strict`.
 */
function spanFor(
  el: Scene['elements'][number],
  cue: string,
  tokens: readonly string[],
  streamAgrees: boolean,
  sink: { label: string; searched: ResolveCuesResult['searched']; brokenIndices: string[] },
): (TokenSpan & { via: 'index' | 'search' }) | undefined {
  const search = (): (TokenSpan & { via: 'search' }) | undefined => {
    const found = findCueSpan(tokens, cue);
    return found ? { ...found, via: 'search' } : undefined;
  };

  const index = el.enter.cueWord;
  if (index === undefined) {
    // A board compiled before the index existed. Placed the old way, counted so
    // the fallback can be deleted on evidence rather than on a hunch.
    sink.searched.push({ elementId: el.id, cue });
    return search();
  }
  if (!streamAgrees) return search();

  const first = cueTokens(cue)[0];
  const at = tokens[index];
  if (at === undefined) {
    sink.brokenIndices.push(
      `scene "${sink.label}": element "${el.id}" is cued at word ${index}, but the narration has ` +
        `only ${tokens.length} spoken word(s) — the index and the narration come from different ` +
        'versions of this scene, so the reveal is placed by searching for its phrase instead',
    );
    return search();
  }
  if (first !== undefined && at !== first) {
    sink.brokenIndices.push(
      `scene "${sink.label}": element "${el.id}" is cued at word ${index}, which is "${at}", but ` +
        `its cue "${cue}" starts on "${first}" — the narration changed after it was compiled, so ` +
        'the reveal is placed by searching for its phrase instead',
    );
    return search();
  }
  // Length is the cue's own, and the score is 1 by construction: the compiler
  // wrote this index from an exact match against this very text.
  return { index, length: Math.max(1, cueTokens(cue).length), score: 1, via: 'index' };
}

/**
 * Stagger simultaneous strokes by at most 350 ms. Distinct speech cues retain
 * their temporal order regardless of the order geometry is stored in the IR.
 */
function spreadGesture(
  scene: Scene,
  narrationSec: number,
  resolved: readonly CueResolution[],
): void {
  if (!(narrationSec > 0) || !resolved.length) return;
  const byId = new Map(resolved.map((r) => [r.elementId, r]));
  // Storage order is geometry order, not speech order. A late-cued shape must
  // never push every subsequent label past the word that introduces it.
  const ordered = scene.elements
    .filter((el) => byId.has(el.id))
    .sort((a, b) => a.enter.at - b.enter.at);
  for (let i = 0; i < ordered.length;) {
    const start = ordered[i]!.enter.at;
    let end = i + 1;
    while (end < ordered.length && Math.abs(ordered[end]!.enter.at - start) < 0.001) end++;
    const next = ordered[end]?.enter.at ?? 0.995;
    const count = end - i;
    // Even a twenty-stroke object is one gesture, not two seconds of cue drift.
    const step = Math.min(
      GESTURE_STEP_SEC / narrationSec,
      0.35 / narrationSec / Math.max(1, count - 1),
      Math.max(0, next - start) / count,
    );
    for (let j = i; j < end; j++) {
      const el = ordered[j]!;
      const moved = Math.min(0.995, start + (j - i) * step);
      el.enter.at = round3(moved);
      const record = byId.get(el.id);
      if (record) record.at = el.enter.at;
    }
    i = end;
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
