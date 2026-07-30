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
  /**
   * Which member of the lesson's `cast` this draws, and in which pose.
   *
   * This is how the pedagogy addresses the asset library. Without it a lesson can
   * only *describe* a person and hope the visuals stage matches something apt, which
   * means every character resolves to its rig's default pose — one explorer standing
   * in all three beats, which is exactly what `figures/standing` already did. Naming
   * the member makes it the same person by construction, and naming the pose is the
   * only thing that makes a rig a rig rather than a drawing.
   *
   * The pose is explicit or absent, never inferred from the beat's verb. Guessing it
   * from the narration is the mistake the lesson schema's v2 mapping removed for the
   * analogy, and it would fail the same way: the beat that says "she sat with the
   * problem for a week" is not asking for `sitting`.
   */
  character: z
    .object({
      /** A `Lesson.cast` id. An id with no cast member is a critique failure. */
      id: z.string(),
      /** A pose the rig declares, e.g. `walking`. Absent means the rig's default. */
      pose: z.string().optional(),
    })
    .optional(),
});

/**
 * Someone the lesson is about, declared once and referred to by id thereafter.
 *
 * The same argument that made `storyboard.assets[]` a top-level library rather than an
 * inline property of elements: resolve once, reuse by id. A narrative lesson that
 * re-describes its protagonist per beat gets a different protagonist per beat, which is
 * the failure competing tools ship. Declaring the cast is what lets three beats be three
 * poses of one person.
 */
export const CastMember = z.object({
  /** Stable slug, and the id `VisualIntent.character` cites. */
  id: z.string(),
  /** What to call them in narration, for the author's benefit. */
  name: z.string().default(''),
  /**
   * How they look, for the day a generator draws them.
   *
   * Unused by the composed lane — a rig is already a drawing, so there is nothing to
   * synthesise — and recorded anyway, because the moment a provider exists this is the
   * prompt that keeps them the same person across a video.
   */
  look: z.string().default(''),
});

/**
 * What kind of thing is being taught.
 *
 * The pedagogy that works is not the same for a derivation and for a story: a STEM
 * topic has to be reasoned from something the learner already accepts, while a
 * narrative one is carried by characters and scenes. Recording the kind is what
 * lets the author be held to the right standard instead of one generic one.
 */
export const LessonKind = z.enum(['stem', 'process', 'historical', 'narrative', 'abstract']);

/** How this particular explanation is built. */
export const TeachingStrategy = z.enum(['first-principles', 'analogy', 'story-driven']);

/**
 * One correspondence in the analogy: `from` is the concrete thing the anchor
 * established, `to` is the abstraction it stands for.
 *
 * This table is the reason the compiler can find the moment the abstraction arrives
 * without reading the narration for turns of phrase. An analogy whose parts do not
 * each map onto something is an analogy that will not land, which is why declaring
 * one with no correspondences is a critique failure rather than merely thin.
 */
export const AnalogyMap = z.object({
  /** The concrete side, in the anchor's own vocabulary — "the height of the hill". */
  from: z.string(),
  /** What it stands for — "how wrong the machine currently is". */
  to: z.string(),
});

export const Analogy = z.object({
  /** The everyday situation in one phrase: "walking downhill in fog". */
  concrete: z.string(),
  maps: z.array(AnalogyMap).default([]),
});

/**
 * Where a beat's claim comes from.
 *
 *  - `given` rests on what the learner already accepts, the anchor included.
 *  - `derived` follows from named earlier beats, listed in `derivedFrom`.
 *  - `asserted` is stated without being earned. Defensible in a story-driven
 *    lesson; forbidden outright in a first-principles one.
 */
export const StepGrounding = z.enum(['given', 'derived', 'asserted']);

export const LessonStep = z.object({
  /** The single new idea, in one sentence. If it needs two, split the step. */
  idea: z.string(),
  /**
   * WHY it is true, from what the learner already knows. An explanation that
   * asserts is a definition; an explanation that derives is teaching. Never
   * leave this empty.
   */
  because: z.string(),
  /**
   * Where the claim comes from. Defaults to `given` so a lesson written before this
   * field existed still parses, and still passes critique.
   */
  from: StepGrounding.default('given'),
  /**
   * The beats this one is derived from, required when `from` is `derived` and
   * restricted to beats that come earlier. Ids are structural — `hook`, `anchor`,
   * `step1`…`stepN`, `worked`, `misconception`, `recap` — so no author has to invent
   * a name or keep it unique. See `lessonBeats`.
   */
  derivedFrom: z.array(z.string()).default([]),
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
  /**
   * What kind of topic this is, and how it is being taught. Both default to the
   * strictest reading — a STEM topic reasoned from first principles — so a lesson
   * written before these existed is held to the highest standard rather than
   * quietly exempted from all of them.
   */
  kind: LessonKind.default('stem'),
  strategy: TeachingStrategy.default('first-principles'),
  /**
   * The one thing that, once seen, makes the rest follow. Not a summary and not the
   * topic restated: the sentence the whole video exists to install. Every beat
   * should be serving it, and a beat that serves nothing else is a beat to cut.
   */
  coreInsight: z.string().default(''),
  /** Terms deliberately avoided, or introduced only after being earned. */
  jargonBudget: z.array(z.string()).default([]),
  /**
   * Who is in this lesson, for a `narrative` one that is carried by people.
   *
   * Defaulted to empty so every `lesson.json` written before this field existed still
   * parses — the same reason `version` stays at 1 and the cache invalidates through the
   * stage version instead. An empty cast is the normal case: a derivation has no cast,
   * and a lesson that describes a person without declaring one still resolves through
   * the library's alias table, just without identity across beats.
   */
  cast: z.array(CastMember).default([]),

  /** A concrete question or surprise in the first five seconds. Never a definition. */
  hook: LessonStep,
  /**
   * What maps onto what, between the anchor and the abstraction. Optional, because
   * not every lesson teaches by analogy — but a lesson whose `strategy` is `analogy`
   * has to record one, and the storyboard compiler uses it to decide where the
   * abstraction arrives on the board.
   */
  analogy: Analogy.optional(),
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
export type CastMember = z.infer<typeof CastMember>;
export type LessonKind = z.infer<typeof LessonKind>;
export type TeachingStrategy = z.infer<typeof TeachingStrategy>;
export type AnalogyMap = z.infer<typeof AnalogyMap>;
export type Analogy = z.infer<typeof Analogy>;
export type StepGrounding = z.infer<typeof StepGrounding>;

/**
 * The part a beat plays in the explanation.
 *
 * Not exported: `@inkcast/planner` already exports a `BeatRole` derived from the
 * `Scene` enum, and a second exported name for the same six strings is how the two
 * drift apart.
 */
type BeatRole = 'hook' | 'anchor' | 'step' | 'worked' | 'misconception' | 'recap';

/** A beat, its role, and the id other beats cite it by. */
export type LessonBeat = { step: LessonStep; role: BeatRole; id: string };

/**
 * Every beat in running order, tagged with the role it plays and with the id
 * `derivedFrom` refers to it by.
 *
 * Ids are positional rather than authored: a `steps` entry is `step1`, `step2` and so
 * on, one-based, and every other role is its own name. Nothing has to mint an id or
 * keep it unique, and an old lesson gains ids without being rewritten. The trade is
 * that ids are only stable for a given lesson — see `adaptLesson`, which drops steps
 * to fit a budget and therefore renumbers them.
 */
export function lessonBeats(l: Lesson): LessonBeat[] {
  const beats: LessonBeat[] = [
    { step: l.hook, role: 'hook', id: 'hook' },
    { step: l.anchor, role: 'anchor', id: 'anchor' },
    ...l.steps.map((step, i) => ({ step, role: 'step' as const, id: `step${i + 1}` })),
  ];
  if (l.worked) beats.push({ step: l.worked, role: 'worked', id: 'worked' });
  if (l.misconception)
    beats.push({ step: l.misconception, role: 'misconception', id: 'misconception' });
  beats.push({ step: l.recap, role: 'recap', id: 'recap' });
  return beats;
}

/**
 * Structural critique of a lesson, used to reject weak plans before they cost a
 * render. Returns human-readable problems; empty means it passes.
 */
export function critiqueLesson(l: Lesson, opts: { maxSeconds?: number } = {}): string[] {
  const problems: string[] = [];
  const beats = lessonBeats(l);
  const allIds = new Set(beats.map((b) => b.id));
  /** Ids already passed, so a `derivedFrom` cannot point forwards. */
  const earlier = new Set<string>();
  const castIds = new Set(l.cast.map((c) => c.id));

  for (const { step, role, id } of beats) {
    if (!step.because.trim() && role !== 'recap' && role !== 'hook') {
      problems.push(`${role} "${step.idea}" asserts without justifying it`);
    }
    if (step.narration.split(/\s+/).length > 60) {
      problems.push(`${role} narration is too long for one beat`);
    }
    if (!step.visuals.length && role !== 'recap') {
      problems.push(`${role} "${step.idea}" has nothing to look at`);
    }
    // A character reference resolves to a library path, so a dangling one draws
    // nothing rather than drawing the wrong thing. Same class as a `derivedFrom`
    // naming no beat, and worth catching before it costs a render.
    for (const v of step.visuals) {
      if (v.character && !castIds.has(v.character.id)) {
        problems.push(
          `${role} "${step.idea}" draws character "${v.character.id}", who is not in the cast`,
        );
      }
    }
    // A first-principles lesson that asserts is not one. This is the rule the
    // `from` field exists for, and it is deliberately absolute: there is no
    // beat-count or budget under which asserting becomes acceptable here.
    if (l.strategy === 'first-principles' && step.from === 'asserted') {
      problems.push(
        `${role} "${step.idea}" is asserted, and a first-principles lesson has to derive every claim`,
      );
    }
    if (step.from === 'derived') {
      if (!step.derivedFrom.length) {
        problems.push(
          `${role} "${step.idea}" says it is derived but names nothing it derives from`,
        );
      }
      for (const ref of step.derivedFrom) {
        if (earlier.has(ref)) continue;
        problems.push(
          allIds.has(ref)
            ? `${role} "${step.idea}" derives from "${ref}", which comes later — nothing may forward-reference`
            : `${role} "${step.idea}" derives from "${ref}", which is not a beat in this lesson`,
        );
      }
    }
    earlier.add(id);
  }

  if (!l.coreInsight.trim()) {
    problems.push('the lesson does not name the one insight it exists to install');
  }
  // An analogy is a set of correspondences or it is decoration: without them the
  // learner is told two things are alike and left to guess in what respect, and the
  // compiler has nothing to locate the abstraction's arrival with.
  if (l.analogy && !l.analogy.maps.length) {
    problems.push(
      `the analogy "${l.analogy.concrete}" names no correspondences, so nothing maps onto the abstraction`,
    );
  }
  if (l.strategy === 'analogy' && !l.analogy) {
    problems.push('the lesson says it teaches by analogy but does not record one');
  }
  // `kind` was accepted, prompted for, and then read by nothing. This is the first
  // thing that branches on it, and it is the same rule as the analogy one above: a
  // lesson that declares itself carried by characters and names none is not one.
  if (l.kind === 'narrative' && !l.cast.length) {
    problems.push('the lesson says it is carried by characters but declares no cast');
  }

  if (/^\s*(in this video|today we|let'?s (talk|discuss)|welcome)/i.test(l.hook.narration)) {
    problems.push('hook opens with a preamble instead of a concrete question or surprise');
  }
  for (const term of l.jargonBudget) {
    const firstUse = beats.findIndex((b) =>
      b.step.narration.toLowerCase().includes(term.toLowerCase()),
    );
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
