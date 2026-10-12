/**
 * Output formats, and fitting a lesson to one.
 *
 * A vertical short is not a cropped landscape video. The constraint is the point:
 * 45–60 seconds forces one idea, one visual and one payoff per beat, which is
 * usually a *better* explanation than the long cut. So the preset does not just
 * change the aspect ratio — it changes how many beats survive, how long each one
 * may speak, how many visuals it may draw, and how large the type is.
 *
 * Trimming only ever cuts at sentence boundaries. The MVP cut mid-sentence and
 * produced fragments like "under you gets gentler", which is worse than saying
 * less.
 *
 * `explainer` is the same argument made a second time, against a measurement instead of
 * against intuition. It is landscape like `standard` and it is *not* a shorter
 * `standard`: 165 words instead of 330, eight beats instead of fourteen, a hold ceiling
 * instead of a global one, and a board that wipes. Read its entry in `PRESETS` for where
 * each of those numbers comes from — every one of them is a line from the side-by-side
 * timing in `docs/HANDOFF-PARITY.md` rather than a preference.
 */
import type { BoardMode, StageOptions, StoryboardMeta, TextElement } from '@inkcast/core';
import type { Lesson, LessonStep, VisualIntent } from '@inkcast/core';
import {
  LETTERS_PER_WORD,
  critiqueLesson,
  lessonBeats,
  logger,
  noteProblem,
  spokenLetters,
} from '@inkcast/core';
import { keywords, sentences, wordCount } from './text.js';

const log = logger('planner:presets');

export type PresetName = 'standard' | 'short' | 'square' | 'explainer' | 'deepdive';

export type Preset = {
  name: PresetName;
  aspect: StoryboardMeta['aspect'];
  /** Target runtime, in seconds. Drives trimming and the lesson critique. */
  maxSeconds: number;
  /** Beats per region: 3–5 reads as a panel of one argument; 2 suits vertical. */
  maxPerRegion: number;
  /** Visual intents drawn per beat. Vertical gets exactly one. */
  visualsPerBeat: number;
  /** Hard cap on beats. */
  maxBeats: number;
  /**
   * Whether exceeding `maxBeats` is by itself a reason to delete a beat.
   *
   * Absent means "decide from the board mode", which is the rule `adaptLesson` has
   * always used and which keeps `standard`, `short` and `square` — and their four
   * pinned storyboard hashes — on exactly the branch they take today. Set it only
   * where the count has been **measured** not to buy anything on that format; see
   * `countBinds` in `adaptLesson` for what the measurement has to show.
   */
  countBinds?: boolean;
  /** Spoken words per beat before narration is trimmed at a sentence break. */
  maxWordsPerBeat: number;
  /** Type scale for the caption that names each cell. */
  captionRole: TextElement['role'];
  /** Longest a caption may be, in words. */
  captionWords: number;
  vertical: boolean;
  /** Extra silence after every beat, on top of what the lesson asked for. */
  holdBonus: number;
  /**
   * Ceiling on the silence a beat may *ask* for, in seconds. Absent means no ceiling
   * beyond the one the cadence already imposes.
   *
   * Silence is the second half of the script-economy defect and it was the invisible
   * half. A measured 174s film spent **26.8s in pauses of 0.35s or longer — 15.4% of
   * its runtime** against Golpo's 3.2s (5.4%) on the same lesson, and none of that was
   * anybody's decision: `CADENCE` in `@inkcast/core` is a global table, so the only
   * ceilings in the pipeline were 0.8s for a `punchy` beat and **3s** for a
   * `slow_deliberate` one, which is what a worked example and a misconception are read
   * as. A sixty-second film cannot afford a three-second pause and a two-and-a-half
   * minute one can, and a single global number cannot say both.
   *
   * So the ceiling is a property of the format, and it lives here rather than in
   * `CADENCE` for the reason `CADENCE`'s own comment gives about two catalogues of one
   * fact: the cadence table says what a *delivery* means and this says what a *format*
   * can afford, and they are different facts that happen to meet in one `Math.min`.
   *
   * Applied in **two** places, and it took both. `trimStep` caps the author's request,
   * which makes the ceiling binding on the length estimate (`lessonSeconds` reads
   * `step.hold`). `holdFor` in `compile.ts` caps the finished scene, which is what
   * makes it binding on the film — before that line existed the cadence floor
   * (`slow_deliberate` floors at 0.9s) and the trailing-question bonus (a full second)
   * both walked straight past a 0.8s ceiling, so the cap made the estimate wrong
   * rather than the film short. It is written down here because a cap that is silently
   * half-applied is exactly the kind of quiet degradation this repo keeps paying for.
   */
  maxHold?: number;
  /**
   * The most separate *moments* a beat may introduce ink at (plan item 1.5).
   *
   * Not a cap on elements — a cap on **starts**. The distinction is the whole of it:
   * scene s7 of `projects/deb81002b073` carries 26 marks and 26 distinct enter
   * fractions, so something new appears every 0.46 s for the entire beat with no rest
   * anywhere in it. Over the film that is 158 objects in 131 s, one every 0.83 s, and
   * it is the "attention firehose" the dissection measured.
   *
   * Twenty-six marks is not the defect; a *person* drawing that diagram would make
   * twenty-six marks. Twenty-six separate decisions to start is. A hand draws the left
   * stack while saying *the left stack* — several strokes, one movement, one moment —
   * then stops, then draws the gap. So the marks are coalesced onto shared cues until
   * the beat has at most this many starts, and `serializePen` draws each run back to
   * back. What the ceiling buys is the *gaps between the runs*.
   *
   * Absent means no ceiling, which is what `standard` has: both shipped lessons pin
   * byte-identical compiles to it (`test/pinned-hashes.test.ts`), and this arrives the
   * way `explainer` itself did — as a new behaviour a *format* opts into, never as an
   * edit to the one everything is pinned against.
   */
  maxGestures?: number;
  /**
   * Narration pace used for *estimating*, in words a second.
   *
   * Not the same number as the speaking rate the voice stage targets: this one has to
   * predict a finished video, gaps and all. See `DELIVERED_WPS` and `lessonSeconds`.
   */
  wordsPerSecond: number;
  /**
   * Seconds the finished board stays on screen after the last word.
   *
   * Lived as a literal in the compiler and was therefore invisible to the length
   * estimate, which is exactly the shape of bug this file just paid for.
   */
  outroSec: number;
  /**
   * What the board does between beats — see `BoardMode` in `@inkcast/core`.
   *
   * `accumulate` on `standard`, `short` and `square`, because the two shipped lessons
   * are pinned to compile byte-identically and changing any of those three would move
   * both. `explainer` is `wipe`, and it is the only preset that is — a *new* key cannot
   * move a pinned hash, which is why the mode arrives as a new format rather than as a
   * changed default on an old one. `Preset` is never serialised, so a required field
   * here costs no bytes downstream; what reaches the storyboard is `meta.board`, and
   * only when it is `wipe`.
   */
  board: BoardMode;
};

/**
 * Spoken letters a second a finished render actually delivers.
 *
 * **This is the calibration now, and `DELIVERED_WPS` below is derived from it.** The
 * change is the answer to a finding that sat open through Phases 6 and 7: `DELIVERED_WPS
 * = 2.2` fitted one shipped film and not the other, every run said so through the
 * `pace-calibration` advisory, and the three candidate fixes on the table were "re-measure
 * the constant", "make it per-cadence" and "accept the spread". The corpus refutes the
 * first two and makes the third unnecessary.
 *
 *  - **Per-cadence is refuted outright.** `CADENCE` scales the speaking rate by
 *    0.933/1.0/1.067, so a cadence mix *could* move delivered pace by ±7% — but every
 *    beat of every film in the corpus is `building_energy`. A rate that varies by cadence
 *    cannot explain a spread between films whose cadence is identical.
 *  - **Re-measuring the constant does not fix it either**, because the spread is not an
 *    offset. It is between films: 1.98 w/s (`qc0-doc`), 2.28 (`qc65-longitude`), 2.39
 *    (`qc0-hashmap`), 2.50 (`qc64-gd`). Any single number is wrong by ±11% somewhere.
 *  - **The unit was wrong.** Over those same four films, spoken letters a second spans
 *    **9.50–9.90, ±2.1%** — a fifth of the spread — and the residual is flat rather than
 *    ordered. The engine speaks at a near-constant rate; words a second is a property of
 *    the film's *vocabulary*, not of this pipeline. Photosynthesis averages 4.86 letters a
 *    word and gradient descent 3.79, which is the whole of the 21% gap between them.
 *    Confirmed at beat level too: across 106 timed phrases, words a second has a
 *    coefficient of variation of 16.6% and letters a second 9.6%.
 *
 * Measured over the normalised text the engine is actually handed — see `spokenLetters`,
 * which is in `@inkcast/core` because `measureDrift` has to count the identical way.
 * Pooled over `qc0-doc`, `qc0-hashmap`, `qc65-longitude` and `qc64-gd`: 4,272 spoken
 * letters over 442.6s of narration audio, at the standard preset with the default local
 * voice. It carries the gap the voice stage puts after every sentence, which is why it is
 * below the in-phrase rate (10.29) that the same corpus measures.
 *
 * **Re-measure it when the engine, the language or the phrase gaps change** — those are
 * the things it is a property of. A lesson full of long words is no longer one of them,
 * which is the point. `measureDrift`'s advisory is the standing check.
 */
export const DELIVERED_LPS = 9.65;

/**
 * The same measurement, per voice provider — because it is a property of the engine.
 *
 * The constant above was pooled over four films spoken by **the local default voice**,
 * and its own note says to re-measure it "when the engine, the language or the phrase
 * gaps change". A keyed run changes all three at once, and nobody had noticed: the
 * ElevenLabs film in `projects/deb81002b073` delivered **10.87 lps**, 13% faster than
 * the number that budgeted it, and QC's `pace-calibration` advisory said so on every
 * run. Thirteen per cent means every scene is shorter than the plan asked for before
 * any other defect acts — the film is compressed beyond plan by construction.
 *
 * So the estimate reads the rate of the provider the run will actually use, threaded
 * from `cast()` (which resolves the provider before the lesson stage) through
 * `PresetInput.voiceProvider`.
 *
 * ## What is measured and what is not
 *
 * `kokoro` is the pooled four-film figure and is solid.
 *
 * `elevenlabs` was **10.87 until 2026-08-25**, and that number was measured on one film
 * (`projects/deb81002b073`) spoken by `eleven_flash_v2_5` splitting at clauses. This repo
 * now defaults to `eleven_multilingual_v2` splitting at sentences, and both change the
 * rate — fewer inter-fragment gaps alone makes a scene faster. Re-measured under the
 * current engine on `projects/f3ac9c760194`, the acceptance film of
 * `docs/PLAN-WATCHABILITY.md`: **12.16 spoken letters a second over 54.6s of narration**
 * across eight scenes, which is 158 words at 2.89 words a second and 4.20 letters a word.
 * QC's `pace-calibration` reported it as +12% against the old constant, which is exactly
 * what that advisory exists to do.
 *
 * **It is still one film**, and it should be pooled the moment there is a second. What it
 * is not any more is a measurement of a different engine. The honest confidence interval
 * here is "the engine's rate, ±the variation between two lessons", and this corpus has
 * never measured that for a paid provider.
 *
 * `say` and `silence` have no measurement at all and take the local figure: `say` is
 * not for publishing (`SAY_NOT_FOR_PUBLISHING`) and `silence` speaks nothing.
 */
export const DELIVERED_LPS_BY_PROVIDER: Readonly<Record<string, number>> = {
  kokoro: DELIVERED_LPS,
  elevenlabs: 12.16,
  say: DELIVERED_LPS,
  system: DELIVERED_LPS,
  silence: DELIVERED_LPS,
};

/** Spoken letters a second `provider` delivers. The local rate for anything unknown. */
export function deliveredLps(provider?: string): number {
  return (provider ? DELIVERED_LPS_BY_PROVIDER[provider] : undefined) ?? DELIVERED_LPS;
}

/**
 * The same, in words a second — the unit the preset field and the brief speak.
 *
 * An unknown provider returns `DELIVERED_WPS` *exactly*, byte for byte, which is what
 * keeps `resolvePreset({})` and therefore both pinned lesson hashes unchanged.
 */
export function deliveredWps(provider?: string): number {
  return provider && DELIVERED_LPS_BY_PROVIDER[provider] !== undefined
    ? round2(DELIVERED_LPS_BY_PROVIDER[provider]! / LETTERS_PER_WORD)
    : DELIVERED_WPS;
}

/**
 * Words a second a finished render delivers, for a film of average word length.
 *
 * Derived, not measured — the measurement is `DELIVERED_LPS` above. Kept as a named
 * constant because two things still speak words: the preset field `wordsPerSecond` (and
 * the `--wps` flag that overrides it), and the brief's word budget. Both are interfaces to
 * a person or a model, and neither can count letters in advance.
 *
 * 9.65 / 4.23 = 2.28, against the 2.2 that was here before. The corpus mean moved by 4%;
 * what actually changed is that the estimate no longer has to be wrong by ±11% on films at
 * the ends of the vocabulary range.
 */
export const DELIVERED_WPS = round2(DELIVERED_LPS / LETTERS_PER_WORD);

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export const PRESETS: Record<PresetName, Preset> = {
  standard: {
    name: 'standard',
    aspect: '16:9',
    // 150s, raised from 120 once the estimate stopped flattering itself. Two reasons, and
    // the second is the honest one. A landscape explainer at two and a half minutes is
    // normal for the genre; and 120 was chosen when running for free was the headline,
    // then quietly enforced by deleting beats. Both shipped lessons are 116s and 134s of
    // real speech, so 120 could not hold either without cutting — see `droppableIds`.
    maxSeconds: 150,
    maxPerRegion: 4,
    visualsPerBeat: 3,
    maxBeats: 14,
    maxWordsPerBeat: 46,
    captionRole: 'label',
    captionWords: 9,
    vertical: false,
    holdBonus: 0.15,
    wordsPerSecond: DELIVERED_WPS,
    outroSec: 1.6,
    board: 'accumulate',
  },
  short: {
    name: 'short',
    aspect: '9:16',
    maxSeconds: 60,
    maxPerRegion: 2,
    visualsPerBeat: 1,
    maxBeats: 8,
    maxWordsPerBeat: 24,
    captionRole: 'heading',
    captionWords: 6,
    vertical: true,
    holdBonus: 0.1,
    wordsPerSecond: DELIVERED_WPS,
    outroSec: 1,
    board: 'accumulate',
  },
  /**
   * The one measured against a competitor, and the shape that won.
   *
   * Same lesson, both tools, timed (`docs/HANDOFF-PARITY.md`): theirs ran 59.5s on ~145
   * words with 3.2s of silence; ours ran 174s on 348 words with 26.8s of silence. The
   * in-speech rate was never the problem — measured 142–151 wpm, inside the teaching
   * band on both sides. **We simply said two and a half times as much and stalled
   * between saying it.** So this preset is not "standard, shorter": every field below is
   * the same landscape film with the two defects taken out, and the numbers are derived
   * from that comparison rather than chosen.
   *
   * THE WORD BUDGET, IN WORDS, WHICH IS THE ONLY UNIT THE AUTHOR CAN COUNT.
   * 75 seconds × 2.28 words a second (`DELIVERED_WPS`, measured, gaps included) = **171
   * words for the whole film** — the ~160 the comparison asks for, landing at 75s in the
   * 60–90s target band. `teachingBrief` states that number to the model directly; this
   * is where it comes from.
   *
   * That number reads 171 rather than the 165 this block said until 2026-08-27, and
   * nothing about the film changed: `DELIVERED_WPS` is derived from `DELIVERED_LPS`,
   * which gate 6 re-pinned to the measured 12.16 letters a second. The prose here had
   * kept the old 2.2. It is spelled out because the block below divides this budget by
   * the beats, so a stale numerator would make that derivation look like an error.
   *
   * `maxWordsPerBeat` is that budget divided by the beats, and the arithmetic has one
   * wrinkle worth writing down. `wordBudget` gives the hook and the worked example a
   * 1.6× leash, so nine beats are 7 + 2×1.6 = **10.2 shares**, and 171 ÷ 10.2 = 16.8
   * words a share. It is set to 18 rather than 17 on purpose: `clampNarration` cuts
   * whole sentences, so a ceiling pinned to the average would take the last sentence off
   * nearly every beat and turn a backstop into scissors. At 18 the ceiling sums to
   * 7×18 + 2×29 = 184 words, just inside the ≤190 the gate allows, and it only bites on
   * a beat that has genuinely run away with the film.
   *
   * ## Why nine beats and eighteen words, 2026-08-27 (was eight and twenty)
   *
   * This pair is the same derivation re-run at nine beats, and it was measured rather
   * than chosen. Three casts of one prompt authored **9, 9 and 10 beats** — never eight
   * — so `maxBeats: 8` meant every cast entered the trimmer needing a beat deleted. The
   * word budget was never the problem: after `clampNarration` the three casts said 147,
   * 151 and 158 words, comfortably inside 165. **The beat count was the whole of it.**
   *
   * `overBudget` ORs the two rules, so relaxing either one alone changes nothing — at
   * `maxBeats: 99` the seconds rule still cut a beat, and at `maxSeconds: 999` the beat
   * rule still did. Measured on all three casts, only the pair moves the outcome.
   *
   * What the pair costs and buys, measured: an extra beat costs seconds, and tightening
   * the per-beat clamp 20 → 18 pays for it. The three casts land at **68.6s, 69.3s and
   * 67.5s on 145, 144 and 144 words** — the same argument in one more, slightly shorter
   * beat, still inside the 60–90s band with the estimator's measured ±5% (gate 6) to
   * spare. The 184-word ceiling and the 171-word budget are **byte-identical** to what
   * eight-and-twenty gave, which is the check that says this is a re-derivation and not
   * a loosening: `maxSeconds` is untouched, so the brief still asks for the same film.
   *
   * Why it mattered enough to move: the beat the trimmer reached was the misconception,
   * and the figure routed to it went with it — plan gates 8 and 7 respectively. See
   * `misconceptionIsPayload`, whose protection only fires when the author happens to
   * cite `worked` and so held on two of the three casts by luck.
   *
   * THE SILENCE. `maxHold` 0.8 and `holdBonus` 0. Eight beats at the ceiling plus a 1.0s
   * outro is 7.4s of authored pause in a 75s film — 9.9% at the absolute ceiling, well
   * under it in practice, against 15.4% measured. Note what this does *not* claim: most
   * of that 26.8s was the voice stage's per-sentence gaps, and those come out with the
   * word count rather than with this number. The two fields work the same seam from
   * opposite ends. `holdBonus` goes to zero because 0.15s a beat is a decision nobody
   * made, taken eight times.
   *
   * `board: 'accumulate'`, and it was `'wipe'` from 2026-08-21 to 2026-08-27. **A3 is
   * reversed**, for three reasons, in order of weight:
   *
   *  1. **The measurement that bought `wipe` was taken with the wrong instrument.**
   *     Content fill 55.5% → 62.3% is `fillcheck`'s number, and its `cover` term is a
   *     union of *bounding boxes* — blind to lines, arrows and label-heavy cards, and
   *     therefore blind to exactly the marks a toured board is made of. Measured since:
   *     of one card's 29% `cover`, 18 points were handwriting, and a 560×1 balance beam
   *     — one of the most prominent strokes on it — scored 0.2%. See
   *     `docs/HANDOFF-GATE-ONE.md`. The number rewarded the thing it could see.
   *  2. **"At 90 seconds or less there is no board tour worth taking" is contradicted by
   *     the best evidence available.** The reference product's strongest film is its
   *     *shortest* — 89.5s — and it is a board tour: one persistent canvas, zero hard
   *     cuts, every scene change a pan or a zoom over ink that is still there.
   *  3. **`wipe` and bought silence do not compose.** Under `wipe` every second the
   *     voice stage buys so a board can be read is a second that board might not be
   *     there for; that is `projects/c5caa09eb153`, 52% blank paper (`docs/STATUS.md`,
   *     2026-08-27). Under `accumulate` the same second is free.
   *
   * What A3 was right about is unchanged and is now the *camera's* problem rather than
   * the board's: nobody re-reads beat four at a quarter of the screen. `resolveFraming`
   * walks the board beat by beat instead of framing all of it at once, which is what
   * `MAX_VIEWS_PER_SEC` and `walkWindow` are for. `docs/CONTRACT.md` carries the
   * re-amended clause and both dates.
   *
   * `maxPerRegion` 3 is a live number again — `planBoard` lays real regions under
   * `accumulate` — and it stays at 3 rather than moving, because it was chosen against
   * this preset's nine beats and nothing about that changed. `--board wipe` still
   * overrides the mode (`resolvePreset`), and must keep working.
   *
   * `captionRole` and `captionWords` deliberately stay where `standard` has them. The
   * 62.3% fill above was measured with `--board wipe` at exactly these type roles, and
   * moving them would re-litigate a measured configuration on no evidence — with a live
   * text-clipping defect (`empty stac`, `AV nod`) waiting on the other side. Type scale
   * is not this preset's argument.
   */
  explainer: {
    name: 'explainer',
    aspect: '16:9',
    maxSeconds: 75,
    maxPerRegion: 3,
    visualsPerBeat: 2,
    maxBeats: 9,
    // Measured false on this format — see `countBinds` in `adaptLesson`. It stays the
    // ceiling the brief states to the author and the number `maxWordsPerBeat` is derived
    // from; what it is not, here, is scissors.
    countBinds: false,
    maxWordsPerBeat: 18,
    captionRole: 'label',
    captionWords: 8,
    vertical: false,
    holdBonus: 0,
    maxHold: 0.8,
    maxGestures: 10,
    wordsPerSecond: DELIVERED_WPS,
    outroSec: 1,
    board: 'accumulate',
  },
  /**
   * The long cut, with the board defects taken out — the studio's second length.
   *
   * `explainer` above is the argument that a 75-second film teaches better than a
   * 150-second one, and it is the studio's default because of it. This exists for the
   * case that argument does not cover: a subject that genuinely needs fourteen beats,
   * where the honest answer is a longer film rather than a thinner one.
   *
   * It is **`standard`'s budget**, field for field — same 150 seconds, same fourteen
   * beats, same words per beat — with the three things that made `standard` unwatchable
   * changed and nothing else:
   *
   *  - `board: 'wipe'`. One card per beat. On the corpus this moved content fill from
   *    55.5% to 62.3% and regions from 4 to 1, and it is the only way to stop a
   *    ten-panel recap frame that shows every beat at a size nobody can read. A long
   *    film has *more* reason to wipe than a short one, not less: the mega-canvas gets
   *    bigger with every beat and the camera zoom with it.
   *  - `maxHold: 1.2` against `standard`'s uncapped. Higher than `explainer`'s 0.8
   *    because two and a half minutes can afford a longer pause where a minute cannot —
   *    that is the whole reason the ceiling is a property of the format.
   *  - `holdBonus: 0`. 0.15s a beat is a decision nobody made, taken fourteen times.
   *
   * And `maxGestures`, which `standard` cannot have: both shipped lessons pin
   * byte-identical compiles to `standard`, so the gesture ceiling (plan 1.5) arrives on
   * the new presets exactly as `board: 'wipe'` did.
   *
   * **`standard` itself is untouched and stays reachable**, by `--preset standard` and
   * as the CLI's default. It is what the pinned hashes are taken against, what every
   * cached project on disk was compiled at, and what a user who wants the old shape
   * asks for by name.
   */
  deepdive: {
    name: 'deepdive',
    aspect: '16:9',
    maxSeconds: 150,
    maxPerRegion: 4,
    visualsPerBeat: 3,
    maxBeats: 14,
    maxWordsPerBeat: 46,
    captionRole: 'label',
    captionWords: 9,
    vertical: false,
    holdBonus: 0,
    maxHold: 1.2,
    maxGestures: 10,
    wordsPerSecond: DELIVERED_WPS,
    outroSec: 1.6,
    board: 'wipe',
  },
  square: {
    name: 'square',
    aspect: '1:1',
    maxSeconds: 90,
    maxPerRegion: 3,
    visualsPerBeat: 2,
    maxBeats: 11,
    maxWordsPerBeat: 34,
    captionRole: 'body',
    captionWords: 7,
    vertical: false,
    holdBonus: 0.12,
    wordsPerSecond: DELIVERED_WPS,
    outroSec: 1,
    board: 'accumulate',
  },
};

export type PresetInput = {
  preset?: PresetName;
  aspect?: StoryboardMeta['aspect'];
  maxSeconds?: number;
  wordsPerSecond?: number;
  board?: BoardMode;
  /**
   * Which voice provider this run will speak with — `kokoro`, `elevenlabs`, `say`.
   *
   * Not the voice *id*: `FormatOptions.voice` is `meta.voice`, which names a voice or
   * a mood and cannot answer this. See `DELIVERED_LPS_BY_PROVIDER` for why the
   * estimate needs to know, and `cast()` for where the answer comes from — it
   * resolves the provider before the lesson stage runs, which is what makes this
   * possible at all.
   */
  voiceProvider?: string;
};

/**
 * The preset an option bag selects: explicit name first, then the aspect.
 *
 * `explainer` is reachable by name only, and that is deliberate rather than an
 * oversight of the aspect table below. It shares 16:9 with `standard`, so an aspect
 * cannot choose between them — and the two disagree about the *film*, not the frame.
 * The CLI keeps `standard` as its default because a local run is where a
 * two-and-a-half-minute cut is still wanted; the hosted studio asks for `explainer` by
 * name, because a stranger's first video has ninety seconds to earn the next one.
 */
export function resolvePreset(opts: PresetInput = {}): Preset {
  const base =
    PRESETS[
      opts.preset ??
        (opts.aspect === '9:16' ? 'short' : opts.aspect === '1:1' ? 'square' : 'standard')
    ];
  const preset: Preset = { ...base };
  if (opts.aspect) {
    preset.aspect = opts.aspect;
    preset.vertical = opts.aspect === '9:16';
  }
  if (opts.maxSeconds) preset.maxSeconds = opts.maxSeconds;
  // The provider's own rate, unless the caller named one. Order matters: an explicit
  // `--wps` is a person overriding the pipeline and wins over both.
  preset.wordsPerSecond = opts.wordsPerSecond || deliveredWps(opts.voiceProvider);
  if (opts.board) preset.board = opts.board;
  return preset;
}

/* ---------------------------------------------------------------- narration */

/**
 * Estimated wall-clock length of a lesson: speech, deliberate silence, and the outro.
 *
 * **Calibrated against a measured render, because the assumed rate was costing beats.**
 * The old default of 2.5 words a second is the *target* speaking rate (150 wpm) and it is
 * not what a finished video delivers: the voice stage puts a gap after every sentence, and
 * a beat of eight short sentences spends real time in those gaps. Measured on
 * `projects/f70a4904eb30` — 272 words, 122.5s of narration audio — delivery is **2.2 words
 * a second**, 12% slower than assumed.
 *
 * That gap had teeth. The estimate said a ten-beat lesson fitted in 120s once two beats
 * were cut; the render came out at 131s. So the trimmer damaged the lesson *and* missed
 * the target it damaged it for. An honest estimate cuts less by cutting from a true
 * starting point, and `droppableIds` now decides what may go.
 *
 * Takes the whole preset rather than a rate because the outro is part of the video, and
 * `maxSeconds` is compared against something a viewer would time with a stopwatch.
 */
export function lessonSeconds(lesson: Lesson, pace: Preset | number = DELIVERED_WPS): number {
  const wps = typeof pace === 'number' ? pace : pace.wordsPerSecond;
  const outro = typeof pace === 'number' ? 0 : pace.outroSec;
  // Words in, letters out. The caller's knob stays `wordsPerSecond` — it is what the preset
  // carries and what `--wps` overrides — but the estimate is per spoken letter, because
  // that is the rate that holds still across films (see `DELIVERED_LPS`). Scaling by
  // `LETTERS_PER_WORD` keeps the knob meaning exactly what it says: words a second *for a
  // film of average word length*, which is the only reading under which the number was ever
  // true. `--wps 2.6` is still 18% faster than the default, on any lesson.
  const lps = wps * LETTERS_PER_WORD;
  return (
    outro +
    lessonBeats(lesson).reduce((t, b) => t + spokenLetters(b.step.narration) / lps + b.step.hold, 0)
  );
}

/**
 * Cut narration to a word budget **at a sentence boundary**, keeping whole
 * sentences from the start. A beat that would be left empty keeps its first
 * sentence however long it is: a slightly long sentence is recoverable, a
 * truncated clause is not.
 */
export function clampNarration(narration: string, maxWords: number): string {
  const parts = sentences(narration);
  if (!parts.length) return narration.trim();
  const kept: string[] = [];
  let total = 0;
  for (const s of parts) {
    const n = wordCount(s);
    if (kept.length && total + n > maxWords) break;
    kept.push(s.trim());
    total += n;
  }
  return (kept.length ? kept : [parts[0]!.trim()]).join(' ');
}

/* ------------------------------------------------------------------ trimming */

/**
 * The silence a beat is allowed to *ask* for, once the format has had its say.
 *
 * Two ceilings, and they are different rules rather than one rule twice. The vertical
 * one is about the medium: a short is watched with a thumb on the scroll and a
 * half-second of nothing is where it gets scrolled, so `short` has always clamped hard
 * and given the hook the only long pause in the film. The preset one is about the
 * budget, and it is new: a 75-second film cannot spend three seconds on one pause
 * (see `Preset.maxHold` for the measurement that says so).
 *
 * Both are floors-in-reverse rather than the final word. `holdForCadence` in
 * `@inkcast/core` still raises a beat to its cadence's baseline afterwards and
 * `holdFor` in `compile.ts` still adds the question bonus, so what this changes for
 * certain is the author's request and the length estimate that reads it —
 * `lessonSeconds` sums `step.hold`, so an un-capped request used to inflate the
 * estimate and cost a beat before a single frame was drawn.
 *
 * A preset without `maxHold` comes through this function byte-identically: `standard`,
 * `short` and `square` compile exactly as they did, which the pinned hashes require.
 */
function cappedHold(step: LessonStep, preset: Preset, role: 'hook' | 'worked' | 'other'): number {
  const asked = preset.vertical ? Math.min(step.hold, role === 'hook' ? 1.2 : 0.5) : step.hold;
  return preset.maxHold === undefined ? asked : Math.min(asked, preset.maxHold);
}

function trimStep(
  step: LessonStep,
  preset: Preset,
  role: 'hook' | 'worked' | 'other' = 'other',
): LessonStep {
  const visuals = pickVisuals(step.visuals, preset.visualsPerBeat);
  return {
    ...step,
    // A renderer preset cannot decide which sentence carries the explanation. Fit the
    // complete script before drawing; if that is unavailable, retain whole explanation
    // units and report the overrun instead of silently discarding their conclusions.
    narration: step.narration.trim(),
    visuals,
    hold: cappedHold(step, preset, role),
  };
}

/**
 * Which visuals survive when a beat may only draw a few.
 *
 * `plot` and `path` are local, free, and carry the most explanatory weight, so
 * they win. A bare `text` intent loses: the caption already names the cell, and
 * more words is the failure mode we are trying to escape.
 */
export function pickVisuals(visuals: VisualIntent[], limit: number): VisualIntent[] {
  if (visuals.length <= limit) return visuals;
  const weight = (v: VisualIntent): number => {
    switch (v.kind) {
      // A composed drawing wins every tie: it is local, free, addressable part by part,
      // and it is the only lane that can draw what the beat actually describes.
      case 'draw':
        return 0;
      case 'plot':
        return 1;
      case 'path':
        return 2;
      // A listing is a quotation, and it wins over every generated picture for the same
      // reason marks do: it is the thing itself, not an approximation of it.
      case 'code':
        return 2.5;
      case 'illustration':
        return 3;
      case 'diagram':
        return 4;
      case 'motion':
        return 5;
      case 'icon':
        return 6;
      default:
        return 7;
    }
  };
  return visuals
    .map((v, i) => ({ v, i }))
    .sort((a, b) => weight(a.v) - weight(b.v) || a.i - b.i)
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.v);
}

/**
 * Steps ranked by how much they serve the one insight the lesson exists to install —
 * used only when cutting.
 *
 * `coreInsight` leads the goal sentence, and that is the whole change. The field was
 * added to the schema, prompted for at length ("the sentence the whole video exists to
 * install… a beat that does not serve it is a beat to cut") and then read by nothing but
 * an is-it-empty check in `critiqueLesson`. This function is the one place in the
 * codebase that asks the question the field was written to answer, and it was asking it
 * of the wrong sentence.
 *
 * The objective is a bad proxy for it, and measurably so. It is the *acceptance test* —
 * "explain why the AV node delay is necessary for ventricular filling" — so it is written
 * in the technical register, and several of its words are usually in `jargonBudget`, which
 * the beats are forbidden to use until they have earned them. Overlap with the objective
 * is therefore *lowest* for the lessons that follow the vocabulary rule best. On the
 * cardiac lesson that actually shipped (`projects/cardiac8f/lesson.json`), all seven steps
 * score **zero** against objective + topic: the ideas talk about patches, sparks, walls,
 * doorways, a cable and a mesh, and the objective says "SA node", "Purkinje fibres",
 * "atrioventricular". A ranking that is all zeroes is not a ranking, so the drop order
 * fell through to the tie-break — the later beat first — and every preset deleted `step7`,
 * "Starting at the bottom wrings blood upward into the outflow vessels": the payoff, the
 * beat the other six exist to reach. The pedagogy decision this file's comments are proud
 * of was, on the only keyed film we have, "drop the last one".
 *
 * With `coreInsight` in the goal the same seven steps score `[1, 0, 2, 1, 6, 0, 5]`, which
 * is a ranking rather than a coin toss: `step5` (the cable that reaches the bottom) and
 * `step7` (squeezing from the bottom up) are what the insight is *about*, and `step2` and
 * `step6` are the plumbing. `coreInsight` reads that way because it is written by the same
 * author in the same plain register as the narration, in the same pass, so its words are
 * the words the beats actually use.
 *
 * And it changes nothing yet, which is worth writing down rather than hiding. Measured on
 * all three real lessons — both shipped ones at every preset and the cardiac lesson that
 * was rendered — **every cut this trimmer makes has exactly one candidate at the moment it
 * is made**, because `derivedFrom` forms a chain and `droppableIds` only offers the tail of
 * it. A ranking cannot choose between one thing. So the score is not where the field bites;
 * it earns its keep the first time a lesson has two independent tails, and the decision
 * `coreInsight` actually has to reach is *what may be cut at all* — see `insightArrival`.
 *
 * The objective and topic stay in the set rather than being replaced. They are weak
 * signal, not wrong signal, and on a lesson whose insight is thin they are all there is.
 * Union, not substitution: this is a tie-break getting information it never had.
 */
function stepScores(lesson: Lesson): number[] {
  const goal = new Set(keywords(`${lesson.coreInsight} ${lesson.objective} ${lesson.topic}`));
  return lesson.steps.map((s) => {
    const hit = keywords(`${s.idea} ${s.because}`).filter((w) => goal.has(w)).length;
    return hit;
  });
}

/**
 * How much of the core insight a beat has to actually say before it counts as the place
 * that insight arrives.
 *
 * A share of the insight's own content words, not a count, because the sentence varies in
 * length. The line sits where the measurement put a gap. Scoring every step of the three
 * real lessons against its own `coreInsight` — unique content words of the insight that the
 * beat's *narration* says, over the insight's content words — gives 0.00, 0.00, 0.18, 0.18
 * (gradient descent), 0.07, 0.14, 0.00 (longitude) and 0.00, 0.19, 0.25, 0.06, 0.06, 0.06,
 * 0.31 (cardiac). Thirteen of the sixteen beats are at or below 0.19 and one is at 0.31:
 * a quarter is the empty band between "uses a word the insight also uses" and "is the beat
 * the insight is made of".
 */
const INSIGHT_ARRIVAL_SHARE = 0.25;

/**
 * The one step where the core insight arrives — the beat the trimmer may not spend.
 *
 * This is the field's real consumer, and the cardiac film is why it exists. Its
 * `coreInsight` reads "…the bottom ones must squeeze all at once from the base upward", and
 * the beat that delivers exactly that — `step7`, "Starting at the bottom wrings blood
 * upward into the outflow vessels" — is the one the trimmer deleted, at **every** preset.
 * The film that shipped therefore states the second half of its own thesis nowhere: 10
 * scenes, and the only place "from the bottom up" survives is the recap, retracing a step
 * the viewer was never shown. (`recap.derivedFrom` still names `step7`, which is why the
 * canary in `remapDerivations` fires on that lesson.)
 *
 * The cut was not even a trade. Dropping `step7` bought about 16 seconds and the estimate
 * still overran: 165s against the 150s `standard` target, 149s against `square`'s 90s. So
 * the trimmer spent the payoff on a budget it missed anyway — and the dependency rule
 * guarantees it will keep doing that, because the tail of the chain is both the only thing
 * ever legal to cut and, in a lesson that builds to something, the thing the building was
 * for. Choosing the victim more cleverly cannot help; the victim is forced.
 *
 * Two properties keep this from becoming a licence to run long:
 *
 *  - **A threshold**, so a beat that merely shares a word is not promoted to the arrival.
 *  - **At most one beat**, the strongest, ties going to the *later* one — the arrival, not
 *    the setup. The teaching brief tells the author that *every* beat should serve the
 *    insight, so a rule that spared every beat serving it would disable trimming entirely
 *    on exactly the lessons that followed the brief best. Sparing one beat costs the
 *    trimmer at most one candidate, and when that leaves nothing to cut the existing
 *    "runs long" path reports it and the video runs long — which this file already argues
 *    is the right trade against a missing link.
 *
 * Judged on the author's own narration rather than the trimmed copy: `trimStep` clamps
 * narration to the preset's word budget, so asking the clamped text would let a preset
 * decide *where the lesson's thesis is*, which is not a preset's business. Beat ids are in
 * original-lesson space here for the same reason.
 */
export function insightArrival(lesson: Lesson): string | undefined {
  const insight = new Set(keywords(lesson.coreInsight));
  if (!insight.size) return undefined;

  let best = 0;
  let arrival: string | undefined;
  lesson.steps.forEach((step, i) => {
    const said = new Set(keywords(step.narration).filter((w) => insight.has(w))).size;
    if (said / insight.size < INSIGHT_ARRIVAL_SHARE) return;
    // `>=` so a tie goes to the later beat: two beats saying the same amount of the
    // insight is a build-up and a landing, and it is the landing that must survive.
    if (said >= best) {
      best = said;
      arrival = `step${i + 1}`;
    }
  });
  return arrival;
}

/**
 * Which beats it is *legal* to drop, and this is the rule that matters most in this file.
 *
 * A shipped render is the reason it exists. Claude wrote a ten-beat gradient-descent
 * lesson whose beats formed one chain — `anchor → step1 → step2 → step3 → step4 → step5`
 * — and the trimmer, fitting it to 120 seconds, deleted **step1 and step2**: the beat that
 * turns the hillside into a graph, and the beat that defines the word *slope*. It chose
 * them because it ranked beats by how many words they shared with the objective sentence,
 * and those two talk about dials and steepness while the objective says "subtracts the
 * slope". So the video went from a figure standing in fog straight to "if the slope is
 * positive, subtract it from your dial", with neither *slope* nor *dial* ever introduced.
 * Unfollowable, and correctly reported as such.
 *
 * `derivedFrom` had said so all along. The lesson schema makes every beat name what it
 * follows from, `critiqueLesson` rejects a forward reference, and then the trimmer deleted
 * antecedents without reading the field — and `remapDerivations` rewrote the survivors'
 * references so the result still *validated*. The bookkeeping was updated until the
 * deletion looked legal.
 *
 * So: a beat may be dropped only when nothing that survives derives from it.
 *
 *  - **The spine is never dropped.** The hook, the anchor, the worked example and the
 *    recap, as before.
 *  - **A `step` or the `misconception` may go**, if no surviving beat names it.
 *  - **The recap's references do not count as dependencies.** It retraces the argument and
 *    adds nothing, so a beat only the recap mentions is still droppable — otherwise
 *    almost nothing ever is, since a good recap names most of the lesson.
 *  - **The beat where the core insight arrives is spine too**, for the reason
 *    `insightArrival` measures: the dependency rule makes the tail of the chain the only
 *    legal victim, and in a lesson that builds to something the tail *is* the payoff.
 *
 * When nothing is droppable and the lesson still overruns, that is reported and the video
 * runs long. A followable lesson at 140 seconds is worth more than a 120-second one with
 * two links missing, and that is a deliberate product decision rather than a fallback.
 */
function droppableIds(lesson: Lesson, doomed: ReadonlySet<string>, spared?: string): Set<string> {
  const beats = lessonBeats(lesson).filter((b) => !doomed.has(b.id));
  /** Ids some surviving beat derives from. The recap is excluded: see above. */
  const needed = new Set<string>();
  for (const { step, role } of beats) {
    if (role === 'recap') continue;
    for (const ref of step.derivedFrom) needed.add(ref);
  }
  const out = new Set<string>();
  for (const { role, id } of beats) {
    if (role !== 'step' && role !== 'misconception') continue;
    if (needed.has(id)) continue;
    if (id === spared) continue;
    out.add(id);
  }
  return out;
}

/**
 * Whether the misconception is the thing this lesson is *for* (plan 5.1).
 *
 * The trimmer's original order — the misconception loses to every step — is right about
 * the usual case and wrong about a whole class of lesson. A misconception written as a
 * caveat ("people sometimes think X") is a footnote and should go first. A misconception
 * **derived from the worked example** is the opposite: the worked example is where
 * understanding consolidates, and a correction earned from it is the specific wrong belief
 * the film's own arithmetic just created. Cutting that leaves a video that plants an error
 * and then ends.
 *
 * Measured, on the film this rule was written for (`projects/deb81002b073`, "why do heavy
 * and light objects fall at the same time"): `misconception.from === 'derived'`,
 * `derivedFrom: ['worked']`, idea "Gravity doesn't pull equally — it pulls harder, and
 * that's the whole point." The trimmer cut it to reach 150s and QC's `stages` check then
 * reported that the film "never names the wrong belief it creates" — the worst wound in an
 * otherwise strict-clean run.
 *
 * ## Why it is not simply `from === 'derived'`
 *
 * Two reasons, and only one of them is about cache hygiene.
 *
 * The pedagogical one: `derived` alone says the beat follows from *something*, which is
 * true of almost every misconception any author writes (all three shipped lessons declare
 * it, citing steps). It does not distinguish a caveat that follows from step 1 from the
 * correction to the error the worked example just invited. Citing `worked` is what makes
 * the beat the payload rather than an aside, and it is the condition `docs/PLAN-
 * WATCHABILITY.md` 5.1 states.
 *
 * The other: `examples/lessons/*.json` all have `from: 'derived'` misconceptions citing
 * steps, so the broad reading would reorder the trim on the shipped lessons and move the
 * pinned hashes — for lessons nobody has looked at frames of under the new order. See
 * `test/pinned-hashes.test.ts` on why that bar is high.
 */
export function misconceptionIsPayload(lesson: Lesson): boolean {
  const m = lesson.misconception;
  return !!m && m.from === 'derived' && m.derivedFrom.includes('worked') && !!lesson.worked;
}

/**
 * The lead-in of the problem line `adaptLesson` reports a cut misconception with.
 *
 * Exported because the pipeline has to tell that one cut apart from every other thing on
 * the `onProblem` channel in order to give it its own blocking QC check (plan 5.1's second
 * half), and a string matched in two files is a string that drifts. Owned here, beside the
 * line it prefixes; read by `misconceptionCutProblems` and by `cast.ts` through it.
 */
export const MISCONCEPTION_CUT_PREFIX = 'the misconception beat';

/** The cut-misconception lines out of a stage's problem list, in order. */
export function misconceptionCutProblems(problems: readonly string[]): string[] {
  return problems.filter((p) => p.startsWith(MISCONCEPTION_CUT_PREFIX));
}

/**
 * The same finding, read off the artefacts instead of off the run that produced them.
 *
 * The stage channel only says anything while the storyboard stage is actually running.
 * On a resumed project it is served from cache, `adaptLesson` never runs, nothing is
 * pushed, and a blocking check that reads only that channel reports **pass** on a film
 * with its point removed. Measured 2026-08-27: the identical strict command, run twice
 * against `projects/gclose2-accum`, blocked on `misconception-cut` and then passed —
 * so re-running was a way through a strict gate. Nothing about the film changed; the
 * cache warmed.
 *
 * This is the same fix and the same reasoning as the `drawing` check's, which reads
 * `lesson.json` back rather than remembering what the lane said while it drew: a check
 * whose evidence is a side effect of a stage is a check that goes quiet exactly when the
 * stage is skipped.
 *
 * The predicate is the one the compiler already writes down — the lesson declares a
 * misconception and no scene carries `role: 'misconception'` — so it needs no second
 * copy of the trimmer's decision. `undefined` when the storyboard has no roles at all
 * (a hand-authored board, where `role` is optional and absence means nothing was
 * claimed), because a check that cannot see must not report that it looked.
 */
export function misconceptionCutInBoard(
  lesson: Pick<Lesson, 'misconception'> | undefined,
  scenes: readonly { role?: string }[],
  preset: Pick<Preset, 'maxSeconds' | 'name'>,
): string[] {
  if (!lesson?.misconception) return [];
  if (!scenes.some((s) => s.role !== undefined)) return [];
  if (scenes.some((s) => s.role === 'misconception')) return [];
  return [
    `${MISCONCEPTION_CUT_PREFIX} — "${lesson.misconception.idea}" — is not on this board, ` +
      `cut while adapting the ${preset.name} board (requested ${preset.maxSeconds}s), so this film never names ` +
      'the wrong belief it creates. Ask for shorter beats, or cast it at a longer preset.',
  ];
}

/**
 * Fit a lesson to a preset: trim each beat, then drop beats until the estimate
 * lands inside the target runtime.
 *
 * The drop order is a pedagogy decision, so it is explicit rather than "last in
 * wins": the hook, the anchor, the worked example, the recap and the beat where the
 * core insight arrives are the spine of the lesson and are never dropped. Steps that
 * do the least for that insight go first, then the misconception, and only then a
 * step that matters.
 *
 * **Unless the misconception is the payload** (plan 5.1). When it is derived from the
 * worked example it is not a caveat on the argument, it is the correction to the error
 * the argument just invited, and it goes *last* of everything droppable — every step the
 * dependency rule permits is cut before it. See `misconceptionIsPayload` for the measured
 * film this rule was written for, and for why the condition is narrower than `derived`.
 *
 * This does **not** make the anchor or the worked example droppable, which is where this
 * departs from the letter of plan 5.1's preference list. `droppableIds` refuses them for a
 * reason a shipped render paid for: a video that skips the beat turning the hillside into
 * a graph is unfollowable, and the fix was to stop cutting antecedents, not to reorder
 * which antecedent goes first. Moving the misconception to the back of the queue achieves
 * what 5.1 is actually asking for — the payload survives the trim — without reopening
 * that.
 *
 * **Every cut is now recorded, not logged** (plan item 5.3; audit S1-c). A dropped beat
 * used to be a `log.debug` line, which meant the single most consequential thing this
 * function does — deleting a link out of an argument to fit a runtime — existed for the
 * length of one terminal session. `opts.onProblem` carries it out to `qc.json`, where the
 * question "why does this film not name the misconception" has an answer a week later.
 * The misconception's line says what was lost rather than which id went, because that is
 * the one cut whose absence a viewer feels without being able to name.
 */
export function adaptLesson(lesson: Lesson, preset: Preset, opts?: StageOptions): Lesson {
  const trimmed: Lesson = {
    ...lesson,
    hook: trimStep(lesson.hook, preset, 'hook'),
    anchor: trimStep(lesson.anchor, preset),
    steps: lesson.steps.map((s) => trimStep(s, preset)),
    recap: trimStep(lesson.recap, preset),
  };
  if (lesson.worked) trimmed.worked = trimStep(lesson.worked, preset, 'worked');
  if (lesson.misconception) trimmed.misconception = trimStep(lesson.misconception, preset);

  const scores = stepScores(lesson);
  /**
   * The beat that lands the lesson's thesis, taken from the *untrimmed* lesson so a
   * preset's word budget cannot move where the thesis is.
   */
  const spared = insightArrival(lesson);
  /** Whether this lesson's misconception is the payload rather than a caveat. */
  const payload = misconceptionIsPayload(lesson);
  /** Insight score for a beat id, so one comparator covers steps and the misconception. */
  const scoreOf = (id: string): number => {
    const m = /^step(\d+)$/.exec(id);
    if (m) return scores[Number(m[1]) - 1] ?? 0;
    // The misconception normally loses to every step: it is a caveat on the argument
    // rather than a link in it, which is the order this function has always used. When it
    // is the *payload* it wins against every step instead — see `misconceptionIsPayload`.
    return payload ? Infinity : -1;
  };

  /** Ids cut so far, in original-lesson id space — `derivedFrom` refers to those. */
  const doomed = new Set<string>();
  /** The lesson as it currently stands, for measuring and for the dependency rule. */
  const withoutDoomed = (): Lesson => {
    const out: Lesson = {
      ...trimmed,
      steps: trimmed.steps.filter((_, k) => !doomed.has(`step${k + 1}`)),
    };
    if (doomed.has('misconception')) delete out.misconception;
    return out;
  };

  /**
   * Whether exceeding `maxBeats` is by itself a reason to delete a beat.
   *
   * It is normally so on an **accumulating** board, where the count looks structural:
   * every beat is a region laid on one canvas and the camera tours them, so an extra
   * beat shrinks every cell and lengthens the tour. Where that is true it is a real
   * limit on what the film can show and the trimmer has to enforce it.
   *
   * **But it is an assumption, and on `explainer` it was measured false** (2026-08-27,
   * when that preset went back to `accumulate`). The same 10-beat lesson compiled at
   * `maxBeats` 9 and 10 gave an identical 6572x2908 canvas, an identical 1.04–5.64 zoom
   * range and an identical 15% sparsest scene — nothing shrank, because the board it was
   * laid on already had the room. What the extra beat cost was 1.3 points of
   * `fillcheck`'s mean, which is the bounding-box metric this preset's own board
   * decision was reversed for reading wrongly. What the cut cost was the misconception.
   * So `explainer` carries `countBinds: false`, and any preset claiming it has to show
   * the same three numbers rather than assert them.
   *
   * It is **not** on a wiping board. `planBoard` dispatches `wipe` to `oneCardBoard`,
   * which lays one frame-shaped cell per beat and never consults `maxBeats` — so on this
   * board an extra beat costs seconds and nothing else, and seconds are already the other
   * half of this predicate. Enforcing the count as well means deleting pedagogy from a
   * film that fits its runtime, which is exactly what happened twice:
   *
   *  - `projects/df62ce29a563` clamped to 9 beats at 75.5s against a 75s target, and lost
   *    its misconception to save 0.5s of a 90s band.
   *  - `projects/c5caa09eb153` ("how does day and night happen") authored 10 beats and
   *    clamped to **62.7s** — comfortably inside the band — and still lost its
   *    misconception, because 10 > 9. Nothing about that cut bought anything.
   *
   * `maxBeats` keeps both of its other jobs on a wiping preset: `teachingBrief` states it
   * to the author as the beat ceiling, and `maxWordsPerBeat` is derived from it. What it
   * stops being is scissors. The runaway case it used to backstop — a great many tiny
   * beats — is bounded from the other side, since each beat is clamped to
   * `maxWordsPerBeat` and their sum still has to fit `maxSeconds`.
   *
   * Scoped by board mode, with a per-preset override, and that keeps the pinned storyboard
   * hashes still: `standard`, `short` and `square` all accumulate and none of them sets
   * `countBinds`, so they take the same branch they always did.
   */
  const countBinds = preset.countBinds ?? preset.board !== 'wipe';

  // Runtime fitting belongs to the reviewed script pass. A deterministic preset
  // cannot know whether a disposable-looking beat carries a necessary explanation.
  const overBudget = (l: Lesson) => countBinds && lessonBeats(l).length > preset.maxBeats;

  let shaped = withoutDoomed();
  while (overBudget(shaped)) {
    // At least one step always survives: the schema requires it, and a lesson with no
    // steps is not a lesson.
    const stepsLeft = shaped.steps.length;
    const candidates = [...droppableIds(trimmed, doomed, spared)].filter(
      (id) => !(stepsLeft <= 1 && id.startsWith('step')),
    );
    if (!candidates.length) {
      const seconds = Math.round(lessonSeconds(shaped, preset));
      // Which of the two rules ran out matters to whoever reads this: "nothing is legal to
      // cut" is a lesson to shorten, while "the only thing left is the payoff" is a
      // deliberate refusal and the author should hear it said that way.
      const held =
        spared && !doomed.has(spared) && droppableIds(trimmed, doomed).has(spared)
          ? `the only beat left to cut is ${spared}, where the lesson's core insight lands, ` +
            'so it is being kept and the video runs long instead. '
          : 'every remaining beat is one another beat derives from, so nothing more can be ' +
            'cut without breaking the chain — the video runs long instead. ';
      log.warn(
        `this lesson needs about ${seconds}s and the ${preset.name} target is ${preset.maxSeconds}s`,
        `${held}Ask the author for shorter beats if the length matters more than the argument.`,
      );
      break;
    }
    // Weakest for the insight first; among equals, the later beat, as before.
    candidates.sort((a, b) => scoreOf(a) - scoreOf(b) || b.localeCompare(a));
    const victim = candidates[0]!;
    doomed.add(victim);
    log.debug(
      `dropped ${victim} to fit ${preset.maxBeats} board regions — nothing derives from it`,
    );
    noteProblem(
      opts,
      victim === 'misconception'
        ? `${MISCONCEPTION_CUT_PREFIX} — "${lesson.misconception?.idea ?? ''}" — was cut to fit the ` +
            `${preset.maxBeats}-region ${preset.name} board, so this film never names the wrong ` +
            'belief it creates. Ask for shorter beats, or cast it at a longer preset.'
        : `beat ${victim} ("${beatIdea(lesson, victim)}") was cut to fit the ` +
            `${preset.maxBeats}-region ${preset.name} board — nothing surviving derives from it`,
    );
    shaped = withoutDoomed();
  }

  const seconds = lessonSeconds(shaped, preset);
  if (seconds > preset.maxSeconds)
    noteProblem(
      opts,
      `script-duration: ${Math.round(seconds)}s exceeds the ${preset.maxSeconds}s target; complete explanations were preserved. Rewrite the script before publishing.`,
    );
  // Ids are positional, so anything dropped above renumbered the survivors.
  remapDerivations(shaped, lesson, doomed);
  return shaped;
}

/**
 * Rewrite `derivedFrom` after beats have been dropped.
 *
 * Beat ids are positional (`step1`…`stepN`, see `lessonBeats`), so dropping a step
 * renumbers every step after it. Left alone that does not merely dangle — it silently
 * *lies*: on the shipped lesson at the `short` preset, the surviving `step3` becomes
 * `step1` and its reference to the old `step1` now points at itself. "step1 derives
 * from step1" reads as a logic bug rather than the renumbering artefact it is.
 *
 * The splice below — if B follows from A and A is cut, B now follows from whatever A
 * followed from — **should be unreachable from every beat but the recap**, and that is a
 * stronger guarantee than the splice ever was. `droppableIds` only offers beats no
 * surviving beat derives from, the recap excepted, so no reference can dangle in the
 * first place. It is kept as a canary rather than deleted: if it fires anywhere other
 * than the recap, the drop rule has been loosened and a lesson is being rewired to make a
 * broken cut validate, which is exactly the failure that shipped.
 *
 * The recap is the documented exception at both ends — `droppableIds` leaves its
 * references out of `needed` so that a lesson which retraces its whole chain still has
 * something legal to cut — so for the recap this splice is load-bearing rather than a
 * canary, and it runs silently. See `resolve`.
 *
 * Exported only so the canary can be tested in the direction that matters. Firing on a
 * non-recap beat is unreachable through `adaptLesson` by construction — that is the whole
 * guarantee `droppableIds` provides — so a test that went the long way round would be
 * asserting the drop rule again and could not tell a working canary from a disabled one.
 */
export function remapDerivations(
  shaped: Lesson,
  original: Lesson,
  doomed: ReadonlySet<string>,
): void {
  /** Antecedents of every beat in the *original* lesson, by its original id. */
  const antecedents = new Map<string, string[]>();
  for (const { step, id } of lessonBeats(original)) antecedents.set(id, step.derivedFrom);

  const rename = new Map<string, string>();
  for (const id of ['hook', 'anchor', 'worked', 'recap']) rename.set(id, id);
  if (shaped.misconception) rename.set('misconception', 'misconception');
  let next = 1;
  original.steps.forEach((_, k) => {
    if (!doomed.has(`step${k + 1}`)) rename.set(`step${k + 1}`, `step${next++}`);
  });

  /**
   * Surviving ids a reference resolves to, following dropped beats through.
   *
   * `canary` is off for the recap, and that is the one asymmetry here. `droppableIds`
   * builds its `needed` set from every surviving beat **except** the recap, on the stated
   * grounds that the recap retraces the whole chain and citing everything would leave
   * nothing droppable. So a recap reference to a dropped beat is not a loosened drop rule,
   * it is the drop rule working: the splice re-points the recap at what the cut beat
   * followed from, which is exactly what retracing a shortened chain means.
   *
   * Without this the canary fired on a legal cut — measured on
   * `projects/f6978912f741`, whose recap is the only beat citing `step5` — and announced
   * a regression that had not happened, in the words of the one that had. A canary that
   * cries wolf on the design's own intended cut is a canary the next reader learns to
   * scroll past, which costs the real signal.
   */
  const resolve = (id: string, seen: Set<string>, canary: boolean): string[] => {
    const kept = rename.get(id);
    if (kept) return [kept];
    if (seen.has(id)) return [];
    // The canary. Reaching here means a beat that something *other than the recap*
    // derives from was dropped, which `droppableIds` exists to prevent — and rewiring the
    // survivor is precisely how an incoherent cut used to end up passing validation.
    if (canary && !seen.size) {
      log.warn(
        `a beat "${id}" that another beat derives from was dropped`,
        'splicing the reference so the lesson still validates, which is the behaviour that ' +
          'shipped an unfollowable video — `droppableIds` should have refused this cut',
      );
    }
    seen.add(id);
    return (antecedents.get(id) ?? []).flatMap((ref) => resolve(ref, seen, canary));
  };

  for (const { step, id, role } of lessonBeats(shaped)) {
    if (!step.derivedFrom.length) continue;
    const mapped = new Set<string>();
    for (const ref of step.derivedFrom) {
      for (const r of resolve(ref, new Set(), role !== 'recap')) if (r !== id) mapped.add(r);
    }
    step.derivedFrom = [...mapped];
    // A beat left deriving from nothing is no longer deriving. Saying so keeps the
    // record true rather than leaving a `derived` beat with an empty antecedent list,
    // which `critiqueLesson` would rightly reject.
    if (!step.derivedFrom.length && step.from === 'derived') step.from = 'given';
  }
}

/** A beat's own one-line idea, by the id `droppableIds` names it with. */
function beatIdea(lesson: Lesson, id: string): string {
  return lessonBeats(lesson).find((b) => b.id === id)?.step.idea ?? id;
}

/** Structural problems with a lesson, measured against a preset's runtime. */
export function critiqueFor(lesson: Lesson, preset: Preset): string[] {
  return critiqueLesson(lesson, { maxSeconds: preset.maxSeconds });
}
