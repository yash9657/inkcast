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
import type { StoryboardMeta, TextElement } from '@inkcast/core';
import type { Lesson, LessonStep, VisualIntent } from '@inkcast/core';
import { critiqueLesson, lessonBeats } from '@inkcast/core';
import { keywords, sentences, wordCount } from './text.js';

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
  /** Narration pace. 2.5 w/s ≈ 150 wpm — teaching pace, not summarising pace. */
  wordsPerSecond: number;
};

export const PRESETS: Record<PresetName, Preset> = {
  standard: {
    name: 'standard',
    aspect: '16:9',
    maxSeconds: 120,
    maxPerRegion: 4,
    visualsPerBeat: 3,
    maxBeats: 14,
    maxWordsPerBeat: 46,
    captionRole: 'label',
    captionWords: 9,
    vertical: false,
    holdBonus: 0.15,
    wordsPerSecond: 2.5,
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
    wordsPerSecond: 2.5,
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
    wordsPerSecond: 2.5,
  },
};

export type PresetInput = {
  preset?: PresetName;
  aspect?: StoryboardMeta['aspect'];
  maxSeconds?: number;
  wordsPerSecond?: number;
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
  return preset;
}

/* ---------------------------------------------------------------- narration */

/** Estimated wall-clock length of a lesson: speech plus deliberate silence. */
export function lessonSeconds(lesson: Lesson, wordsPerSecond = 2.5): number {
  return lessonBeats(lesson).reduce(
    (t, b) => t + wordCount(b.step.narration) / wordsPerSecond + b.step.hold,
    0,
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
      case 'plot':
        return 0;
      case 'path':
        return 1;
      case 'illustration':
        return 2;
      case 'diagram':
        return 3;
      case 'motion':
        return 4;
      case 'icon':
        return 5;
      default:
        return 6;
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
 * Fit a lesson to a preset: trim each beat, then drop beats until the estimate
 * lands inside the target runtime.
 *
 * The drop order is a pedagogy decision, so it is explicit rather than "last in
 * wins": the hook, the anchor, the worked example and the recap are the spine of
 * the lesson and are never dropped. Steps that do the least for the stated
 * objective go first, then the misconception, and only then a step that matters.
 */
export function adaptLesson(lesson: Lesson, preset: Preset): Lesson {
  const shaped: Lesson = {
    ...lesson,
    hook: trimStep(lesson.hook, preset, 'hook'),
    anchor: trimStep(lesson.anchor, preset),
    steps: lesson.steps.map((s) => trimStep(s, preset)),
    recap: trimStep(lesson.recap, preset),
  };
  if (lesson.worked) shaped.worked = trimStep(lesson.worked, preset, 'worked');
  if (lesson.misconception) shaped.misconception = trimStep(lesson.misconception, preset);

  const scores = stepScores(lesson);
  const order = shaped.steps
    .map((_, i) => i)
    .sort((a, b) => (scores[a] ?? 0) - (scores[b] ?? 0) || b - a);

  const overBudget = () =>
    lessonBeats(shaped).length > preset.maxBeats ||
    lessonSeconds(shaped, preset.wordsPerSecond) > preset.maxSeconds;

  // Steps first, weakest for the objective first, but always keep at least one.
  const doomed = new Set<number>();
  for (const i of order) {
    if (!overBudget()) break;
    if (shaped.steps.length - doomed.size <= 1) break;
    doomed.add(i);
    shaped.steps = lesson.steps.map((s) => trimStep(s, preset)).filter((_, k) => !doomed.has(k));
  }
  if (overBudget() && shaped.misconception) delete shaped.misconception;
  if (overBudget() && shaped.worked && shaped.steps.length > 1) {
    // A worked example is worth more than one more step, so sacrifice the step.
    // `doomed` indexes the *original* steps, so the survivor list has to be
    // recomputed rather than indexed off the already-filtered array.
    const survivors = lesson.steps.map((_, k) => k).filter((k) => !doomed.has(k));
    const last = survivors[survivors.length - 1];
    if (last !== undefined) {
      doomed.add(last);
      shaped.steps = lesson.steps.map((s) => trimStep(s, preset)).filter((_, k) => !doomed.has(k));
    }
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
 * A dropped beat is spliced out rather than forgotten: if B follows from A and A is
 * cut, B now follows from whatever A followed from. That keeps the chain honest at
 * whatever length the budget allows, which is the whole point of dropping by pedagogy
 * rather than by position.
 */
function remapDerivations(shaped: Lesson, original: Lesson, doomed: Set<number>): void {
  /** Antecedents of every beat in the *original* lesson, by its original id. */
  const antecedents = new Map<string, string[]>();
  for (const { step, id } of lessonBeats(original)) antecedents.set(id, step.derivedFrom);

  const rename = new Map<string, string>();
  for (const id of ['hook', 'anchor', 'worked', 'recap']) rename.set(id, id);
  if (shaped.misconception) rename.set('misconception', 'misconception');
  let next = 1;
  original.steps.forEach((_, k) => {
    if (!doomed.has(k)) rename.set(`step${k + 1}`, `step${next++}`);
  });

  /** Surviving ids a reference resolves to, following dropped beats through. */
  const resolve = (id: string, seen: Set<string>): string[] => {
    const kept = rename.get(id);
    if (kept) return [kept];
    if (seen.has(id)) return [];
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
