/**
 * The Lesson IR — what to teach, before deciding how to draw it.
 *
 *   ingest -> lesson -> storyboard -> voice -> visuals -> render
 *
 * The MVP went straight from document to storyboard, which made the planner a
 * summarizer: it chopped prose into beats and read them aloud. Summarizing is not
 * teaching, and no amount of visual polish fixes a video that never builds an
 * idea. This stage exists to force the difference.
 *
 * A Lesson is deliberately NOT a document outline. Its required shape encodes
 * how understanding is actually constructed: anchor an abstraction in something
 * concrete, introduce one idea at a time, justify rather than assert, consolidate
 * with real numbers, then name the wrong belief the learner has probably formed.
 */
import { z } from 'zod';

/** A visual intent, resolved into concrete elements by the storyboard compiler. */
export const VisualIntent = z.object({
  /**
   * What the learner should SEE. Written as a drawing instruction, not a
   * caption — "a bowl-shaped curve with a ball high on the left slope", not
   * "gradient descent finds the minimum".
   */
  describe: z.string(),
  /**
   * Which primitive expresses it. `plot` and `path` are local and free;
   * `illustration` calls a text-to-image provider and needs a key.
   */
  kind: z
    .enum(['plot', 'path', 'illustration', 'diagram', 'icon', 'text', 'motion'])
    .default('plot'),
  /** Phrase from the narration this visual must land on. */
  cue: z.string().optional(),
});

export const LessonStep = z.object({
  /** The single new idea, in one sentence. If it needs two, split the step. */
  idea: z.string(),
  /**
   * WHY it is true, from what the learner already knows. An explanation that
   * asserts is a definition; an explanation that derives is teaching. Never
   * leave this empty.
   */
  because: z.string(),
  /** Spoken narration for this beat, 140-160 wpm, whole sentences only. */
  narration: z.string(),
  visuals: z.array(VisualIntent).default([]),
  /** Seconds of silence after this beat, so the idea can land. */
  hold: z.number().min(0).default(0.4),
});

export const Lesson = z.object({
  version: z.literal(1),
  topic: z.string(),
  /** Who this is pitched at; drives vocabulary and how much is assumed. */
  audience: z.string().default('a curious beginner with no background'),
  /**
   * What the learner must be able to DO afterwards. Concrete and checkable —
   * "explain why the update has a minus sign", not "understand gradient descent".
   * This is the acceptance test for the whole video.
   */
  objective: z.string(),
  /** Terms deliberately avoided, or introduced only after being earned. */
  jargonBudget: z.array(z.string()).default([]),

  /** A concrete question or surprise in the first five seconds. Never a definition. */
  hook: LessonStep,
  /**
   * An everyday situation the learner already understands, which every later
   * abstraction maps back onto. Walking downhill in fog, for gradient descent.
   */
  anchor: LessonStep,
  /** One new idea each, ordered so nothing forward-references. */
  steps: z.array(LessonStep).min(1),
  /** A walkthrough with real numbers. Where understanding consolidates. */
  worked: LessonStep.optional(),
  /** The specific wrong belief formed here, named and refuted. */
  misconception: LessonStep.optional(),
  /** The chain of ideas retraced against the finished board. */
  recap: LessonStep,
});

export type Lesson = z.infer<typeof Lesson>;
export type LessonStep = z.infer<typeof LessonStep>;
export type VisualIntent = z.infer<typeof VisualIntent>;

/** Every beat in running order, tagged with the role it plays. */
export function lessonBeats(
  l: Lesson,
): Array<{ step: LessonStep; role: 'hook' | 'anchor' | 'step' | 'worked' | 'misconception' | 'recap' }> {
  const beats: Array<{ step: LessonStep; role: 'hook' | 'anchor' | 'step' | 'worked' | 'misconception' | 'recap' }> = [
    { step: l.hook, role: 'hook' },
    { step: l.anchor, role: 'anchor' },
    ...l.steps.map((step) => ({ step, role: 'step' as const })),
  ];
  if (l.worked) beats.push({ step: l.worked, role: 'worked' });
  if (l.misconception) beats.push({ step: l.misconception, role: 'misconception' });
  beats.push({ step: l.recap, role: 'recap' });
  return beats;
}

/**
 * Structural critique of a lesson, used to reject weak plans before they cost a
 * render. Returns human-readable problems; empty means it passes.
 */
export function critiqueLesson(l: Lesson, opts: { maxSeconds?: number } = {}): string[] {
  const problems: string[] = [];
  const beats = lessonBeats(l);

  for (const { step, role } of beats) {
    if (!step.because.trim() && role !== 'recap' && role !== 'hook') {
      problems.push(`${role} "${step.idea}" asserts without justifying it`);
    }
    if (step.narration.split(/\s+/).length > 60) {
      problems.push(`${role} narration is too long for one beat`);
    }
    if (!step.visuals.length && role !== 'recap') {
      problems.push(`${role} "${step.idea}" has nothing to look at`);
    }
  }

  if (/^\s*(in this video|today we|let'?s (talk|discuss)|welcome)/i.test(l.hook.narration)) {
    problems.push('hook opens with a preamble instead of a concrete question or surprise');
  }
  for (const term of l.jargonBudget) {
    const firstUse = beats.findIndex((b) => b.step.narration.toLowerCase().includes(term.toLowerCase()));
    if (firstUse === 0) problems.push(`jargon "${term}" appears in the hook before being earned`);
  }
  if (opts.maxSeconds) {
    const words = beats.reduce((n, b) => n + b.step.narration.split(/\s+/).length, 0);
    const estimate = (words / 150) * 60 + beats.reduce((n, b) => n + b.step.hold, 0);
    if (estimate > opts.maxSeconds * 1.25) {
      problems.push(`estimated ${Math.round(estimate)}s exceeds the ${opts.maxSeconds}s target`);
    }
  }
  return problems;
}
