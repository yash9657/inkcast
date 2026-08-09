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
 */
import type { BoardMode, StoryboardMeta, TextElement } from '@inkcast/core';
import type { Lesson, LessonStep, VisualIntent } from '@inkcast/core';
import { critiqueLesson, lessonBeats, logger } from '@inkcast/core';
import { keywords, sentences, wordCount } from './text.js';

const log = logger('planner:presets');

export type PresetName = 'standard' | 'short' | 'square';

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
   * `accumulate` on every preset, because the two shipped lessons are pinned to
   * compile byte-identically and a new default would move both. `Preset` is never
   * serialised, so a required field here costs no bytes downstream; what reaches the
   * storyboard is `meta.board`, and only when it is `wipe`.
   */
  board: BoardMode;
};

/**
 * Words a second a finished render actually delivers.
 *
 * Measured, not chosen: 272 words across 122.5s of narration audio in
 * `projects/f70a4904eb30`, at the standard preset with the default local voice. The
 * teaching *rate* is 140–160 wpm (see `CADENCE`), and this is lower than all of it because
 * it also carries the gap the voice stage puts after every sentence. Re-measure it with
 * `vocabcheck`-style arithmetic over any project's `audio/*.timing.json` if the phrase
 * gaps or the cadence rates change.
 */
export const DELIVERED_WPS = 2.2;

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
};

/** The preset an option bag selects: explicit name first, then the aspect. */
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
  if (opts.wordsPerSecond) preset.wordsPerSecond = opts.wordsPerSecond;
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
  return (
    outro +
    lessonBeats(lesson).reduce((t, b) => t + wordCount(b.step.narration) / wps + b.step.hold, 0)
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
 * Two beats get a longer leash when a lesson is squeezed.
 *
 * The hook is usually a question, and a question cut off before the question mark
 * is not a hook. The worked example is where the numbers are, and a worked example
 * trimmed to "you are at three, the slope is plus four" has thrown away the only
 * thing it was for. Everything else can lose a sentence without losing its job.
 */
function wordBudget(preset: Preset, role: 'hook' | 'worked' | 'other'): number {
  return role === 'other' ? preset.maxWordsPerBeat : Math.round(preset.maxWordsPerBeat * 1.6);
}

function trimStep(
  step: LessonStep,
  preset: Preset,
  role: 'hook' | 'worked' | 'other' = 'other',
): LessonStep {
  const visuals = pickVisuals(step.visuals, preset.visualsPerBeat);
  return {
    ...step,
    narration: clampNarration(step.narration, wordBudget(preset, role)),
    visuals,
    hold: preset.vertical ? Math.min(step.hold, role === 'hook' ? 1.2 : 0.5) : step.hold,
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

/** Steps ranked by how much they serve the objective — used only when cutting. */
function stepScores(lesson: Lesson): number[] {
  const goal = new Set(keywords(`${lesson.objective} ${lesson.topic}`));
  return lesson.steps.map((s) => {
    const hit = keywords(`${s.idea} ${s.because}`).filter((w) => goal.has(w)).length;
    return hit;
  });
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
 *
 * When nothing is droppable and the lesson still overruns, that is reported and the video
 * runs long. A followable lesson at 140 seconds is worth more than a 120-second one with
 * two links missing, and that is a deliberate product decision rather than a fallback.
 */
function droppableIds(lesson: Lesson, doomed: ReadonlySet<string>): Set<string> {
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
    out.add(id);
  }
  return out;
}

/**
 * Fit a lesson to a preset: trim each beat, then drop beats until the estimate
 * lands inside the target runtime.
 *
 * The drop order is a pedagogy decision, so it is explicit rather than "last in
 * wins": the hook, the anchor, the worked example and the recap are the spine of
 * the lesson and are never dropped. Steps that do the least for the stated
 * objective go first, then the misconception, and only then a step that matters.
 */
export function adaptLesson(lesson: Lesson, preset: Preset): Lesson {
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
  /** Objective score for a beat id, so one comparator covers steps and the misconception. */
  const scoreOf = (id: string): number => {
    const m = /^step(\d+)$/.exec(id);
    // The misconception loses to every step: it is a caveat on the argument rather than a
    // link in it, which is the same order the previous implementation used.
    return m ? (scores[Number(m[1]) - 1] ?? 0) : -1;
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

  const overBudget = (l: Lesson) =>
    lessonBeats(l).length > preset.maxBeats || lessonSeconds(l, preset) > preset.maxSeconds;

  let shaped = withoutDoomed();
  while (overBudget(shaped)) {
    // At least one step always survives: the schema requires it, and a lesson with no
    // steps is not a lesson.
    const stepsLeft = shaped.steps.length;
    const candidates = [...droppableIds(trimmed, doomed)].filter(
      (id) => !(stepsLeft <= 1 && id.startsWith('step')),
    );
    if (!candidates.length) {
      const seconds = Math.round(lessonSeconds(shaped, preset));
      log.warn(
        `this lesson needs about ${seconds}s and the ${preset.name} target is ${preset.maxSeconds}s`,
        'every remaining beat is one another beat derives from, so nothing more can be cut ' +
          'without breaking the chain — the video runs long instead. Ask the author for ' +
          'shorter beats if the length matters more than the argument.',
      );
      break;
    }
    // Weakest for the objective first; among equals, the later beat, as before.
    candidates.sort((a, b) => scoreOf(a) - scoreOf(b) || b.localeCompare(a));
    const victim = candidates[0]!;
    doomed.add(victim);
    log.debug(`dropped ${victim} to fit ${preset.maxSeconds}s — nothing derives from it`);
    shaped = withoutDoomed();
  }

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
 * followed from — **should now be unreachable**, and that is a stronger guarantee than
 * the splice ever was. `droppableIds` only offers beats no surviving beat derives from,
 * so no reference can dangle in the first place. It is kept as a canary rather than
 * deleted: if it ever fires, the drop rule has been loosened and a lesson is being
 * rewired to make a broken cut validate, which is exactly the failure that shipped.
 */
function remapDerivations(shaped: Lesson, original: Lesson, doomed: ReadonlySet<string>): void {
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

  /** Surviving ids a reference resolves to, following dropped beats through. */
  const resolve = (id: string, seen: Set<string>): string[] => {
    const kept = rename.get(id);
    if (kept) return [kept];
    if (seen.has(id)) return [];
    // The canary. Reaching here means a beat that something derives from was dropped,
    // which `droppableIds` exists to prevent — and rewiring the survivor is precisely how
    // an incoherent cut used to end up passing validation.
    if (!seen.size) {
      log.warn(
        `a beat "${id}" that another beat derives from was dropped`,
        'splicing the reference so the lesson still validates, which is the behaviour that ' +
          'shipped an unfollowable video — `droppableIds` should have refused this cut',
      );
    }
    seen.add(id);
    return (antecedents.get(id) ?? []).flatMap((ref) => resolve(ref, seen));
  };

  for (const { step, id } of lessonBeats(shaped)) {
    if (!step.derivedFrom.length) continue;
    const mapped = new Set<string>();
    for (const ref of step.derivedFrom) {
      for (const r of resolve(ref, new Set())) if (r !== id) mapped.add(r);
    }
    step.derivedFrom = [...mapped];
    // A beat left deriving from nothing is no longer deriving. Saying so keeps the
    // record true rather than leaving a `derived` beat with an empty antecedent list,
    // which `critiqueLesson` would rightly reject.
    if (!step.derivedFrom.length && step.from === 'derived') step.from = 'given';
  }
}

/** Structural problems with a lesson, measured against a preset's runtime. */
export function critiqueFor(lesson: Lesson, preset: Preset): string[] {
  return critiqueLesson(lesson, { maxSeconds: preset.maxSeconds });
}
