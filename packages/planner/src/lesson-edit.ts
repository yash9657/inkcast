import { textProvider } from '@inkcast/core';
/**
 * Revising the teaching, not just the drawing.
 *
 * `editStoryboard` can change how a video looks. It cannot fix a video that
 * explains the wrong thing, because by then the explanation has already been
 * compiled into boxes. `editLesson` operates one stage earlier, where "spend
 * longer on why the minus sign is there" is a change you can actually make.
 *
 * With a key, Claude patches the lesson under the same teaching brief it was
 * written with, so an edit cannot quietly introduce an unjustified claim. Without
 * one, the mechanical edits — pacing, silence, dropping a beat, reordering steps,
 * jargon budget, objective, audience, refitting to a vertical short — are all
 * handled locally, and anything needing new prose is reported rather than ignored.
 */
import type { Lesson, LessonStep, VisualIntent } from '@inkcast/core';
import { Lesson as LessonSchema, critiqueLesson, logger } from '@inkcast/core';
import { anthropicLessonEdit } from './lesson-anthropic.js';
import { PRESETS, adaptLesson, clampNarration, lessonSeconds, resolvePreset } from './presets.js';
import { wordCount } from './text.js';
import type { LessonEditReport, LessonOptions } from './types.js';

const log = logger('planner:lesson:edit');

/** Instructions that plainly require a model to write something new. */
const NEEDS_MODEL =
  /\b(rewrite|reword|rephrase|explain|expand|add (?:a )?(?:step|beat|example)|new step|split|merge|funnier|friendlier|simpler|more formal|translate|different (?:anchor|analogy|hook|example)|better (?:hook|anchor|analogy)|mention|say instead|justify|derive)\b/i;

/**
 * The kinds a plain-language edit may switch a beat to.
 *
 * `draw` is absent because "draw X" is how half of these instructions are phrased, and
 * `code` is absent for a different reason: the code lane needs the listing itself, which
 * an instruction like "show the code" does not carry. Switching a beat to it from here
 * would route it to a lane that can only warn and hand the beat back. A listing arrives by
 * being written into `code`, or in a fenced block — see `codeListing` in `./compile.ts`.
 */
const KINDS: VisualIntent['kind'][] = [
  'plot',
  'path',
  'illustration',
  'diagram',
  'icon',
  'text',
  'motion',
];

type Applied = { note: string } | undefined;

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  last: -1,
};

/** Which step an instruction names: "step 2", "the third step", "the last step". */
function stepIndex(text: string, count: number): number | undefined {
  const numeric = text.match(/\bstep\s*#?(\d{1,2})\b/i);
  if (numeric?.[1]) {
    const n = Number(numeric[1]) - 1;
    return n >= 0 && n < count ? n : undefined;
  }
  for (const [word, ord] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\s+step\\b`, 'i').test(text)) {
      const n = ord === -1 ? count - 1 : ord - 1;
      return n >= 0 && n < count ? n : undefined;
    }
  }
  return undefined;
}

function eachStep(lesson: Lesson, fn: (step: LessonStep) => void): void {
  fn(lesson.hook);
  fn(lesson.anchor);
  lesson.steps.forEach(fn);
  if (lesson.worked) fn(lesson.worked);
  if (lesson.misconception) fn(lesson.misconception);
  fn(lesson.recap);
}

function applyOne(lesson: Lesson, raw: string, opts: LessonOptions): Applied {
  const s = raw.trim();
  const lower = s.toLowerCase();

  /* --- topic --- */
  const title =
    s.match(
      /\b(?:retitle|rename|call it)\b[^"'\w]*(?:it|this)?\s*(?:to|as)?\s*["“']([^"”']+)["”']/i,
    ) ??
    s.match(/\b(?:retitle|rename)\b(?:\s+(?:it|this))?\s+(?:to|as)\s+(.+)$/i) ??
    s.match(/^\s*topic\s*[:=]\s*(.+)$/i);
  if (title?.[1]) {
    lesson.topic = title[1].trim().replace(/[.]$/, '');
    return { note: `topic set to "${lesson.topic}"` };
  }

  /* --- objective: the acceptance test for the whole video --- */
  const objective =
    s.match(/\bobjective\s*[:=]\s*(.+)$/i) ??
    s.match(/\b(?:they|the learner|viewers?) should be able to\s+(.+)$/i) ??
    s.match(/\bmake sure they can\s+(.+)$/i);
  if (objective?.[1]) {
    lesson.objective = objective[1].trim().replace(/[.]$/, '');
    return { note: `objective set to "${lesson.objective}"` };
  }

  /* --- audience --- */
  const audience =
    s.match(/\baudience\s*[:=]\s*(.+)$/i) ??
    s.match(/\b(?:aim|pitch|target|write) (?:it |this )?(?:at|for)\s+(.+)$/i);
  if (audience?.[1]) {
    lesson.audience = audience[1].trim().replace(/[.]$/, '');
    return {
      note: `audience set to "${lesson.audience}" — re-run the lesson stage with a key to rewrite the narration for them`,
    };
  }

  /* --- jargon budget --- */
  const jargon =
    s.match(
      /\b(?:avoid|don'?t use|no|ban|without)\s+(?:the )?(?:words?|terms?|jargon)\s*[:]?\s*(.+)$/i,
    ) ?? s.match(/\bjargon\s*(?:budget)?\s*[:=]\s*(.+)$/i);
  if (jargon?.[1]) {
    const terms = jargon[1]
      .split(/[,;]|\band\b/i)
      .map((t) => t.trim().replace(/^["'“]|["'”.]$/g, ''))
      .filter((t) => t.length > 1 && wordCount(t) <= 4);
    if (terms.length) {
      lesson.jargonBudget = [...new Set([...lesson.jargonBudget, ...terms])];
      return { note: `jargon budget now: ${lesson.jargonBudget.join(', ')}` };
    }
  }

  /* --- vertical refit --- */
  if (/\b(9:16|vertical|portrait|tiktok|reels?|shorts?)\b/i.test(lower)) {
    const short = adaptLesson(lesson, PRESETS.short);
    Object.assign(lesson, short);
    return { note: `refitted for a vertical short: ${lesson.steps.length} steps` };
  }

  /* --- runtime target --- */
  const seconds = s.match(/\b(?:under|about|to|in)\s*(\d{2,3})\s*(?:s|sec|secs|seconds)\b/i);
  if (seconds?.[1] || /\b(?:make it )?(?:much )?shorter|cut it down|tighten\b/i.test(lower)) {
    const target = seconds?.[1]
      ? Number(seconds[1])
      : Math.max(30, Math.round(lessonSeconds(lesson) * 0.7));
    const preset = { ...resolvePreset(opts), maxSeconds: target };
    // Trimming happens sentence by sentence: a truncated clause is worse than
    // saying less, which is the whole reason `clampNarration` exists.
    const budget = Math.max(14, Math.round(preset.maxWordsPerBeat * 0.8));
    eachStep(lesson, (step) => {
      step.narration = clampNarration(step.narration, budget);
    });
    while (lessonSeconds(lesson, preset.wordsPerSecond) > target && lesson.steps.length > 1) {
      lesson.steps = lesson.steps.slice(0, -1);
    }
    return { note: `trimmed towards ${target}s (now ~${Math.round(lessonSeconds(lesson))}s)` };
  }

  /* --- pacing and silence --- */
  const pace = lower.match(
    /\b(slower|faster|slow down|speed up|more (?:pause|silence)|less (?:pause|silence))\b/,
  );
  if (pace) {
    const slower = /slower|slow down|more/.test(pace[1] ?? '');
    const factor = slower ? 1.6 : 0.6;
    eachStep(lesson, (step) => {
      step.hold = Math.round(Math.min(3, Math.max(0, step.hold * factor)) * 100) / 100;
    });
    if (slower) lesson.hook.hold = Math.max(lesson.hook.hold, 1.4);
    return { note: `${slower ? 'lengthened' : 'shortened'} the silence after every beat` };
  }

  /* --- drop a beat --- */
  if (/\b(?:drop|remove|delete|cut)\b.*\bmisconception\b/i.test(lower)) {
    if (!lesson.misconception) return undefined;
    delete lesson.misconception;
    return { note: 'removed the misconception beat' };
  }
  if (/\b(?:drop|remove|delete|cut)\b.*\bworked\b/i.test(lower)) {
    if (!lesson.worked) return undefined;
    delete lesson.worked;
    return { note: 'removed the worked example — the lesson is weaker without it' };
  }
  if (/\b(?:drop|remove|delete|cut)\b.*\bstep\b/i.test(lower)) {
    const i = stepIndex(s, lesson.steps.length);
    if (i === undefined || lesson.steps.length <= 1) return undefined;
    const gone = lesson.steps[i]!;
    lesson.steps.splice(i, 1);
    return { note: `removed step ${i + 1} ("${gone.idea}")` };
  }

  /* --- reorder --- */
  const swap = s.match(/\bswap\b.*?\bsteps?\s*#?(\d{1,2})\b.*?\b(\d{1,2})\b/i);
  if (swap?.[1] && swap[2]) {
    const a = Number(swap[1]) - 1;
    const b = Number(swap[2]) - 1;
    if (a < 0 || b < 0 || a >= lesson.steps.length || b >= lesson.steps.length) return undefined;
    const tmp = lesson.steps[a]!;
    lesson.steps[a] = lesson.steps[b]!;
    lesson.steps[b] = tmp;
    return { note: `swapped steps ${a + 1} and ${b + 1} — check nothing now forward-references` };
  }

  /* --- change what a beat draws --- */
  const kind = KINDS.find((k) =>
    new RegExp(`\\b(?:use|draw|make it|show)\\b.*\\b${k}\\b`, 'i').test(s),
  );
  if (kind) {
    const i = stepIndex(s, lesson.steps.length);
    const targets: LessonStep[] =
      i !== undefined
        ? [lesson.steps[i]!]
        : /\b(?:every|all|each)\b/i.test(lower)
          ? lesson.steps
          : [];
    if (!targets.length) return undefined;
    for (const step of targets) {
      step.visuals = step.visuals.length
        ? step.visuals.map((v, k) => (k === 0 ? { ...v, kind } : v))
        : [{ describe: step.idea, kind }];
    }
    return {
      note: `${targets.length === 1 ? `step ${(i ?? 0) + 1}` : 'every step'} now draws a ${kind}`,
    };
  }

  return undefined;
}

/** Split a multi-part instruction into single actions. */
export function splitLessonInstructions(instruction: string): string[] {
  return instruction
    .split(/[;\n]+|\band then\b|\balso,\s*/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * Apply `instruction` to `lesson`, returning the updated lesson and a report of
 * what actually happened. Never throws for an instruction it cannot carry out —
 * it says so, which is the difference between degrading and lying.
 */
export async function editLessonDetailed(
  lesson: Lesson,
  instruction: string,
  opts: LessonOptions = {},
): Promise<{ lesson: Lesson; report: LessonEditReport }> {
  const preset = resolvePreset(opts);
  const adapter = textProvider(process.env, opts.adapter);

  if (adapter !== 'heuristic') {
    const patched = await anthropicLessonEdit(lesson, instruction, opts, preset.maxSeconds);
    if (patched) {
      const problems = critiqueLesson(patched, { maxSeconds: preset.maxSeconds });
      if (problems.length) log.warn(`the edited lesson has problems: ${problems.join(' | ')}`);
      return {
        lesson: patched,
        report: { applied: [instruction], needsKey: [], unsupported: [], problems },
      };
    }
    log.warn('the Anthropic lesson edit did not succeed — trying the deterministic editor');
  }

  const draft: Lesson = structuredClone(lesson);
  const report: LessonEditReport = { applied: [], needsKey: [], unsupported: [], problems: [] };
  for (const part of splitLessonInstructions(instruction)) {
    const result = applyOne(draft, part, opts);
    if (result) {
      report.applied.push(result.note);
      continue;
    }
    if (NEEDS_MODEL.test(part)) report.needsKey.push(part);
    else report.unsupported.push(part);
  }

  if (report.needsKey.length) {
    log.warn(
      `set FIREWORKS_API_KEY or ANTHROPIC_API_KEY to apply: ${report.needsKey.join(' | ')} — these need a model to write new teaching`,
    );
  }
  if (report.unsupported.length) log.warn(`did not understand: ${report.unsupported.join(' | ')}`);
  if (report.applied.length) log.info(`applied: ${report.applied.join('; ')}`);

  const out = LessonSchema.parse(draft);
  report.problems = critiqueLesson(out, { maxSeconds: preset.maxSeconds });
  if (report.problems.length) {
    log.warn(`the edited lesson still has problems: ${report.problems.join(' | ')}`);
  }
  return { lesson: out, report };
}

/** Apply a natural-language edit to a lesson and return the updated lesson. */
export async function editLesson(
  lesson: Lesson,
  instruction: string,
  opts: LessonOptions = {},
): Promise<Lesson> {
  const { lesson: next } = await editLessonDetailed(lesson, instruction, opts);
  return next;
}
