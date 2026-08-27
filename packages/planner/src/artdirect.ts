/**
 * The art director: which beats get a generated picture, decided by a pass rather
 * than asked for in a brief.
 *
 * ## Four attempts at persuasion, and why this is not the fifth
 *
 * `STAGE_CODE_VERSION.lesson` records versions 10, 11 and 12 as three successive
 * rewrites of the lesson brief, each meant to make the author ask for an underlay:
 * moving the advice into the `draw` bullet, giving `underlay` a `kind`, moving the
 * advice to the *opening* of the bullet because "the first answer is the one a model
 * keeps". `projects/deb81002b073` is the fourth data point. It is a lesson about
 * bowling balls, apples, feathers, hammers, balance scales and vacuum tubes — six
 * objects a learner would recognise on sight — and it came back with **nine `draw`
 * intents, one `plot`, and zero underlays**. The bowling ball is an 80-unit ellipse.
 * The apple is a 40-unit ellipse with an 8-unit stem.
 *
 * `docs/PLAN-FIGURE-LANE.md` item 6 is right about the *test* and wrong about the
 * mechanism: it proposes a brief. A rule stated in a brief is a suggestion competing
 * with two thousand words of other suggestions, and it loses — reproducibly, four
 * times. A router is a pass. It runs after the lesson exists, it looks at one
 * question, and it writes the answer into the lesson.
 *
 * ## The one test that generalises
 *
 * From item 6, and it has held across every subject checked:
 *
 * > **Does the thing have a form a learner would recognise, and does that form carry
 * > meaning?**
 *
 * A heart, a kidney, a neuron, a jet engine, a beetle, a bowling ball — yes. A
 * relation, a quantity, a change over time, a comparison, a process, a hierarchy —
 * no, and the ink lane is right, because composed marks can draw all three things an
 * image model cannot: a relation, a label, and an arrow that means something.
 *
 * A table of subjects cannot be completed, which is why this is a judgement made per
 * lesson by a model rather than a lookup. What makes it a *router* rather than more
 * persuasion is that the judgement is the only thing being asked for: one call, one
 * question, and the answer is applied.
 *
 * ## What it costs, and what it is allowed to spend
 *
 * One cheap call per lesson (~$0.02), and at most `MAX_FIGURES` figures per film at
 * about $0.04 each. The budget is not a cost control so much as a composition rule:
 * a film in which every beat is a generated picture is a slideshow, and the beats
 * that earn one are the hook and the worked example — where the learner is meeting
 * the thing, and where they are watching it do something.
 *
 * ## Never fatal
 *
 * No key, no image provider, a refused call, a malformed answer: the lesson is
 * returned exactly as it arrived and every beat is drawn the way it has always been
 * drawn. This lane needs a paid key, and a lesson that only works with one is not
 * the lesson this project ships.
 */
import { lessonBeats, logger, noteSpend } from '@inkcast/core';
import type { Lesson, LessonStep, VisualIntent } from '@inkcast/core';
import { z } from 'zod';

import { anthropicClient, callTool, errorDetail } from './anthropic.js';
import { figureRouteJsonSchema } from './schema.js';
import type { LessonOptions } from './types.js';

const log = logger('planner:artdirect');

/**
 * The most generated figures one film may carry.
 *
 * Four, and the number is a composition rule before it is a budget. A board where
 * every beat is a rendered picture is a slideshow with narration; what makes the
 * ink lane worth having is the contrast — the beat that is *drawn* lands harder next
 * to the beat that is shown. Four also happens to be about $0.16, which is inside the
 * envelope `docs/PLAN-WATCHABILITY.md` sets for a film.
 */
export const MAX_FIGURES = 4;

/** The model that makes the call. Cheap: this is one judgement, not an essay. */
export const DEFAULT_ROUTER_MODEL = 'claude-sonnet-5';

export function routerModel(opts: { routerModel?: string } = {}): string {
  return opts.routerModel || process.env.INKCAST_ROUTER_MODEL || DEFAULT_ROUTER_MODEL;
}

/** Which lane a beat's picture belongs in. */
export type Route = 'figure' | 'form' | 'marks';

/** One beat's verdict, as the router returns it and as the tests read it. */
export type BeatRoute = {
  id: string;
  route: Route;
  /** The generator prompt, for `figure` and `form`. Absent for `marks`. */
  prompt?: string;
  /** One clause of reasoning, kept for the log and for `lanecheck`. */
  why?: string;
};

const RouteAnswer = z.object({
  beats: z.array(
    z.object({
      /** The beat id, exactly as it was given: `hook`, `anchor`, `step3`, `worked`… */
      id: z.string(),
      route: z.enum(['figure', 'form', 'marks']),
      /**
       * The picture, as an image generator should be asked for it. Required for
       * `figure` and `form`, ignored for `marks`.
       *
       * `nullish`, not `optional`, and it is the difference between the lane working
       * and the lane silently not existing. A model told a field is optional answers a
       * `marks` beat either by leaving it out or by writing `null`, and both mean the
       * same thing — but `z.string().optional()` rejects the second. The parse is
       * all-or-nothing, so one `null` in a field this code goes on to ignore threw away
       * every verdict in the answer and dropped the whole film back to marks. Measured
       * on `projects/df62ce29a563`, cast 2026-08-27: "beats.2.prompt: Expected string,
       * received null", 0 figures where the same prompt had produced 3, gate 7 failed,
       * and the only trace was one `warn` line in a 300-line log.
       */
      prompt: z.string().nullish(),
      /** Why, in one clause. Nullish for the reason `prompt` is. */
      why: z.string().nullish(),
    }),
  ),
});

const TOOL = 'route_pictures';

const BRIEF = `You are the art director of a hand-drawn explainer video. A lesson has already been written; you decide, for each beat, WHICH LANE draws its picture. You are not writing the lesson, not rewording it, and not adding beats.

THE THREE LANES

- \`figure\` — a generated colour teaching picture. The beat's whole diagram: the view, the internal structures, the state, the arrows. It arrives as a picture and is never traced, so it can carry colour and interior detail that marks cannot.
- \`form\` — a generated line drawing of the OBJECT alone, traced into the board's own ink, with hand-drawn marks and names composed on top of it. Choose it when the learner needs the object's real outline but the *mechanism* is annotation.
- \`marks\` — drawn entirely in hand-drawn marks: boxes, arrows, curves, labels. Free, instant, and the only lane that can draw a relation, name a part, or point at something.

THE TEST, AND IT IS ONE QUESTION

**Does the thing have a form a learner would recognise, and does that form carry meaning?**

- Yes: a heart, a kidney, a neuron, a jet engine, a cathedral, a beetle, a bowling ball, a feather, a vacuum tube, a violin. Route it \`figure\` when the picture itself teaches (a cutaway, a labelled interior, a scene of the thing doing something), and \`form\` when the outline is the point and the names carry the rest.
- No: a relation, a quantity, a change over time, a comparison, a process, a hierarchy, an equation, a trade-off, an abstraction. Route it \`marks\`. The ink lane is genuinely better at all of these, and an image model asked for one returns a decorative picture of nothing.

The commonest mistake is routing everything \`marks\` because the *idea* is abstract. The idea is always abstract — that is what a lesson is. Ask about the THING IN THE PICTURE. "Heavy and light objects fall at the same rate" is an abstract idea whose picture is a person holding a bowling ball and an apple, and that is a figure.

The second commonest is being talked out of a picture by \`wants\`. That line is the lesson author's own sketch of the beat, and the lesson author has only ever had the mark lane — so it describes a beat about two vacuum tubes as "two labelled rectangles with arrows", because rectangles are what it knows how to ask for. Read it for what the beat is ABOUT and ignore how it proposes to draw it. You are the one deciding that.

The third is routing a comparison \`figure\` because the things compared are objects. Two boxes with arrows between them is a relation; draw it in marks.

**Do not reason your way to a picture and then write \`marks\`.** If your own \`why\` says the beat is a scene, a demonstration, or worth a figure, the route is \`figure\`. A verdict that disagrees with its own reasoning is the failure this pass replaced a brief to avoid.

WRITING THE PROMPT (\`figure\` and \`form\`)

Name what is in the picture, as a picture, in one sentence.

- **\`figure\`**: the beat's whole teaching figure — the view, the internal structures, the state, the arrows. "A person holding a bowling ball in one hand and an apple in the other at shoulder height, both about to be released, side view." "Two tall glass vacuum tubes side by side, one with a feather falling inside, one with a hammer, both at the same height."
- **\`form\`**: the object alone, plainly. "A human heart, anatomical, external front view, whole organ with great vessels."
- **Never ask for text.** No labels, no lettering, no numbers, no arrows carrying words. Names are the mark layer's job and it is much better at them.
- Do not restate the lesson's idea. Do not say "an illustration of" or "a diagram showing".

BUDGET — A TARGET, NOT ONLY A CEILING

**Spend at least two and at most ${MAX_FIGURES} \`figure\` beats.** Two is a floor because a film with one picture in it is a film that did not use the lane; ${MAX_FIGURES} is a ceiling because a film where every beat is a rendered picture is a slideshow, and what makes the drawn beats land is the contrast.

Spend them where the learner is MEETING the thing or WATCHING IT DO SOMETHING — usually the hook, and the beat that demonstrates. If more than ${MAX_FIGURES} beats qualify, keep the ${MAX_FIGURES} where the picture teaches most and route the rest \`marks\`. If fewer than two qualify on the one-question test, say so by routing what you have: an honest one beats an invented one.

Answer for EVERY beat you are given, using its id exactly as written.`;

/** Beats worth asking about: the ones whose picture is still a description. */
function routable(lesson: Lesson): { id: string; step: LessonStep; intent: VisualIntent }[] {
  const out: { id: string; step: LessonStep; intent: VisualIntent }[] = [];
  for (const beat of lessonBeats(lesson)) {
    for (const intent of beat.step.visuals) {
      // A `plot` is a real chart of real numbers and a `code` intent is a listing:
      // both are lanes that already know exactly what they are drawing, and neither
      // has a form to generate. `motion` is a movement, not a picture. What is left
      // is the two lanes that mean "a picture of a thing", which is the choice.
      if (intent.kind !== 'draw' && intent.kind !== 'illustration') continue;
      // Already drawn — a lesson from disk, or a hand edit. The marks were composed
      // against whatever this beat had, and changing the lane underneath them would
      // aim every leader arrow at a picture that is no longer there.
      if (intent.marks?.length) continue;
      if (intent.character) continue;
      out.push({ id: beat.id, step: beat.step, intent });
      // One picture per beat is the decision being made; a beat with three visuals
      // gets its first one routed and the rest keep whatever they asked for.
      break;
    }
  }
  return out;
}

/** What the model is shown: the beat, its idea, and what it said it wanted drawn. */
function beatBrief(entry: { id: string; step: LessonStep; intent: VisualIntent }): string {
  return [
    `id: ${entry.id}`,
    `idea: ${entry.step.idea}`,
    `wants: ${entry.intent.describe}`,
    entry.intent.underlay?.prompt
      ? `author already asked for: ${entry.intent.underlay.prompt}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Decide the lane for each of a lesson's pictures, and write the decision in.
 *
 * Mutates `lesson` in place, the way `drawLesson` does and for the same reason: the
 * decision belongs *in* `lesson.json`, so the file on disk is a complete description
 * of the video and re-rendering it needs no model, no key and no network.
 *
 * Returns what it decided, which is what the tests read and what the log prints.
 * An empty array means the pass did not run — no key, no image provider, nothing to
 * route — and is not distinguishable from "it routed nothing", deliberately: both
 * mean every beat is drawn the way it always was.
 */
export async function routeFigures(lesson: Lesson, opts: LessonOptions = {}): Promise<BeatRoute[]> {
  // No image provider, no lane to route to. Asking anyway would spend a model call to
  // write a prompt nothing can generate, and then compose marks against a picture
  // that never arrives — which is worse than not asking, not merely wasteful.
  if (!opts.illustrations) return [];

  const work = routable(lesson);
  if (!work.length) return [];

  const c = await anthropicClient();
  if (!c) return [];
  const schema = await figureRouteJsonSchema();
  if (!schema) return [];

  const model = routerModel(opts as { routerModel?: string });
  let raw: unknown;
  try {
    raw = await callTool(
      c,
      model,
      BRIEF,
      [
        {
          role: 'user',
          content: `TOPIC: ${lesson.topic}\n\nBEATS:\n\n${work.map(beatBrief).join('\n\n')}`,
        },
      ],
      schema,
      { name: TOOL, description: 'Choose the drawing lane for each beat.' },
      2000,
      opts.onSpend
        ? (u) => noteSpend(opts, { lane: 'art-director', provider: 'anthropic', ...u })
        : undefined,
    );
  } catch (err) {
    log.warn(
      'the art director could not be reached — every beat keeps its own lane',
      errorDetail(err),
    );
    return [];
  }

  const verdicts = readVerdicts(raw);
  if (!verdicts) return [];
  return applyRoutes(work, verdicts, opts);
}

/**
 * The model's answer as verdicts, or `undefined` if it cannot be read at all.
 *
 * Exported because this is where the lane was lost once and no test could see it: the
 * budget rule below is driven directly by the tests, and the *parse* in front of it was
 * only ever exercised by a paid call. `undefined` and an empty array are the same thing
 * to the caller — every beat keeps its own lane — but they are not the same thing to
 * read, so this returns the first and `routeFigures` turns it into the second.
 *
 * Nulls become absent here rather than downstream: `applyRoutes` should be handed the
 * same values a lesson on disk would carry.
 */
export function readVerdicts(raw: unknown): BeatRoute[] | undefined {
  const parsed = RouteAnswer.safeParse(raw);
  if (!parsed.success) {
    log.warn('the art director answered in a shape this cannot read', errorDetail(parsed.error));
    return undefined;
  }
  return parsed.data.beats.map((b) => ({
    id: b.id,
    route: b.route,
    ...(b.prompt ? { prompt: b.prompt } : {}),
    ...(b.why ? { why: b.why } : {}),
  }));
}

/**
 * Write the verdicts onto the intents, inside the budget.
 *
 * Split out because the budget rule is the part worth testing without a model: which
 * four beats get a picture when six were nominated is a composition decision, and it
 * has to be deterministic.
 */
export function applyRoutes(
  work: { id: string; step: LessonStep; intent: VisualIntent }[],
  verdicts: readonly BeatRoute[],
  opts: { onProblem?: (p: string) => void } = {},
): BeatRoute[] {
  const byId = new Map(work.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const decided: BeatRoute[] = [];

  // Hook and worked example first, then the order the lesson is told in. These are
  // the two beats a figure is worth most on: the hook is where the learner meets the
  // thing, and the worked example is where they watch it do something.
  const priority = (id: string): number => (id === 'hook' ? 0 : id === 'worked' ? 1 : 2);
  const order = verdicts
    .map((v, i) => ({ v, i }))
    .sort((a, b) => priority(a.v.id) - priority(b.v.id) || a.i - b.i);

  let figures = 0;
  for (const { v } of order) {
    const entry = byId.get(v.id);
    if (!entry || seen.has(v.id)) continue;
    seen.add(v.id);

    // A picture lane with no prompt is not a decision, it is a half-formed one. Fall
    // back to marks rather than minting an asset whose prompt is the beat's idea.
    const prompt = v.prompt?.trim();
    if ((v.route === 'figure' || v.route === 'form') && !prompt) {
      decided.push({ id: v.id, route: 'marks', ...(v.why ? { why: v.why } : {}) });
      continue;
    }

    if (v.route === 'figure' && figures >= MAX_FIGURES) {
      // Over budget. `form` rather than `marks`: the router said this thing has a
      // recognisable shape, and that judgement is still true — what it has run out of
      // is the expensive lane, not the reason for wanting a picture.
      const line =
        `${v.id} was routed to a figure but the film already has ${MAX_FIGURES} — ` +
        'drawing its form in ink instead';
      opts.onProblem?.(line);
      log.info(line);
      entry.intent.kind = 'draw';
      entry.intent.underlay = { prompt: prompt as string, kind: 'form' };
      decided.push({ id: v.id, route: 'form', prompt: prompt as string });
      continue;
    }

    if (v.route === 'figure' || v.route === 'form') {
      // The author's consent is not required, which is the whole of this pass: the
      // brief has asked four times and been ignored four times.
      entry.intent.kind = 'draw';
      entry.intent.underlay = { prompt: prompt as string, kind: v.route };
      if (v.route === 'figure') figures += 1;
    }
    // `marks` is left alone rather than cleared: an underlay the author wrote for a
    // beat the router does not want a picture on is still the author's decision, and
    // this pass exists to add pictures that were missing, not to remove them.
    decided.push({
      id: v.id,
      route: v.route,
      ...(prompt ? { prompt } : {}),
      ...(v.why ? { why: v.why } : {}),
    });
  }

  const counts = decided.reduce<Record<string, number>>((acc, d) => {
    acc[d.route] = (acc[d.route] ?? 0) + 1;
    return acc;
  }, {});
  log.info(
    `art direction: ${decided.length} beat${decided.length === 1 ? '' : 's'} routed` +
      ` · ${Object.entries(counts)
        .map(([route, n]) => `${n} ${route}`)
        .join(', ')}`,
  );
  return decided;
}
