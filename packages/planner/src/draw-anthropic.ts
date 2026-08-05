/**
 * The drawing author: one focused model call per picture, emitting marks.
 *
 * ## The argument for a separate call
 *
 * The lesson stage is thinking about what to teach and in what order; asked to also
 * place two hundred coordinates it does both worse. A drawing gets its own call, its own
 * brief, and the model's whole attention — which is what the measurements show it needs:
 * given one subject and nothing else to do, the same model produces a labelled
 * cross-section with an ion crossing a gap and an electron turned back at it. The image
 * generator, asked for the same thing in the same run, produced two empty rectangles.
 *
 * These calls are independent, so they run together, and each one is cached by the hash
 * of its own instruction — machine-wide, exactly like the illustration lane. Two videos
 * that both want "a lithium-ion cell in cross-section" get the *same drawing*, which is
 * entity consistency arriving as a side effect of caching rather than as a feature
 * anybody had to build.
 *
 * ## What the brief has to say, and why
 *
 * Everything in `DRAW_BRIEF` below is there because of something that went wrong in a
 * measured render, and the two hardest-won lines are the ones about *structure* and
 * *labels*. A model asked to "draw a battery" draws a battery-shaped rectangle; asked to
 * draw the parts and how they relate, it draws the thing that teaches. And labels are
 * the one advantage this lane has over any image model — the board can spell — so the
 * brief spends its words on naming parts rather than on style.
 */
import type { Lesson, LessonStep, Mark, VisualIntent } from '@inkcast/core';
import { DRAW_H, DRAW_W, Mark as MarkSchema, cacheDir, hash, logger } from '@inkcast/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { anthropicClient, callTool, errorDetail } from './anthropic.js';
import { drawingJsonSchema } from './schema.js';
import type { LessonOptions } from './types.js';

const log = logger('planner:drawing:anthropic');

/**
 * Default model for the drawing stage.
 *
 * Not the lesson model. Placing marks is a bounded, well-specified task with a schema
 * and a critic, where the lesson is open-ended judgement — so this is the tier where a
 * cheaper model earns its place, and there are five to ten of these calls per video
 * against one lesson call. Override with `INKCAST_DRAW_MODEL`.
 */
export const DEFAULT_DRAW_MODEL = 'claude-sonnet-5';

const TOOL = 'emit_drawing';
/** Bump when `DRAW_BRIEF` or the mark vocabulary changes: it is part of the cache key. */
const BRIEF_VERSION = 'draw/v1';

export function drawModel(opts?: { drawModel?: string }): string {
  return opts?.drawModel ?? process.env.INKCAST_DRAW_MODEL ?? DEFAULT_DRAW_MODEL;
}

/* -------------------------------------------------------------------- brief */

const DRAW_BRIEF = `You are drawing on a whiteboard, in a hand-drawn explainer video, by placing every mark yourself. You are not describing a picture for someone else to draw and you are not writing a caption: what you emit is exactly and only what appears on the board.

THE CANVAS is ${DRAW_W} wide and ${DRAW_H} tall. x grows right, y grows DOWN, origin top-left. Fill it — the drawing is scaled to the space it gets, so use the whole canvas with a small margin and keep everything inside it.

THE MARKS, and there are only these eight:
- rect {x,y,w,h} — a box. x,y is the TOP-LEFT corner.
- ellipse {x,y,w,h} — the ellipse inscribed in that box.
- line {points:[[x1,y1],[x2,y2]]} — one straight segment.
- stroke {points:[[x,y],…], smooth?, closed?} — a freehand line through those points, and YOUR MAIN TOOL: every outline, silhouette, curve, zigzag or shape that is not a box or an ellipse is a stroke. \`smooth: true\` curves through the points (an organic outline, a wire, a wave); leave it false for anything angular (a zigzag, a polygon, a bracket). \`closed: true\` joins the last point back to the first. 5–20 points is a good shape.
- arrow {points:[[x,y],…]} — a line with a head on the LAST point. Two points is straight; three bends it through the middle one.
- label {x,y,text,size} — real handwriting, drawn by the board itself. x,y is the CENTRE of the words. size is cap height: 26–34 for a part name, 40+ for the one thing the drawing is about.
- hatch {x,y,w,h,angle} — parallel shading filling that box, at that angle in degrees. A material, a solid, a filled region, a shaded area.
- dots {x,y,w,h,count} — count small filled dots scattered in that box. Particles, charges, molecules, grain.

WHAT MAKES A DRAWING TEACH, in the order it matters
1. DRAW THE STRUCTURE AND THE RELATION, NOT THE OBJECT. A photograph of a battery teaches nothing; two electrode stacks facing each other across a gap, with one thing crossing the gap and another turned back at it, is the whole idea. Ask what the learner has to SEE to believe the beat, and draw exactly that. If two things are compared, put them side by side. If something is inside something else, its coordinates have to be inside. If two things face each other across a gap, make the gap wide enough to see.
2. NAME THE PARTS. You can spell and the board writes in the same hand as everything else, so label what matters — 2 to 5 labels is usual. Put each label in empty space beside the thing it names, never on top of ink, and use an arrow from the label to the part when the part is small or crowded. Labels are the single biggest advantage this lane has: use them, but do not caption the picture with a sentence.
3. ONE DRAWING, ONE IDEA. 10 to 25 marks. Under 8 is too crude to teach; over 30 is a mess nobody reads. Leave out anything the beat does not need — no ground line, no background, no scenery, no decorative frame, no title unless the drawing is the title.
4. ID EVERY MARK BY WHAT IT IS. \`left-stack\`, \`damp-gap\`, \`ion-1\`, \`wire\`, \`bulb\` — the part, not the shape. That id is how a later beat highlights this part, moves it, or draws it again, so a mark called \`rect-3\` is a mark nobody can ever refer to.
5. DRAW IN THE ORDER A PERSON WOULD. Big containing shapes first, then the parts inside them, then connectors and arrows, then labels last. The board reveals your marks in the order you list them, so this order is what the viewer watches being drawn.

Emit the drawing by calling the ${TOOL} tool exactly once.`;

/* ------------------------------------------------------------------- schema */

/**
 * A drawing, tolerant of the one shape the model reliably gets wrong.
 *
 * `elements` comes back as a *JSON string* often enough to matter — twice in eighteen
 * calls, and the retry only fixed one of them, because it is not a mistake the model
 * recognises when shown. It is also completely recoverable: the content is right and
 * the encoding is off by one `JSON.parse`. Rejecting it would throw away a good drawing
 * over a quoting convention.
 */
const DrawingSchema = z.object({
  elements: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, z.array(MarkSchema).min(3).max(40)),
});

/* ------------------------------------------------------------------ caching */

/**
 * The cache key for a drawing: what was asked for, and nothing about who asked.
 *
 * Deliberately not scoped to the lesson or the project. The same instruction is the same
 * picture, so a second video about batteries reuses the first one's cross-section — free,
 * instant, and identical, which is the entity-consistency problem solving itself.
 */
export function drawKey(instruction: string): string {
  // The brief itself is in the key, not just its version number. Every word of it
  // changes what comes back — the canvas dimensions most of all — and a cache that
  // survived a brief change would serve drawings composed for a canvas that no longer
  // exists, which is the subtlest possible way to make a fix look like it did nothing.
  return hash(BRIEF_VERSION, DRAW_BRIEF, instruction.trim().toLowerCase()).slice(0, 16);
}

async function readCached(key: string): Promise<Mark[] | undefined> {
  try {
    const raw = await readFile(path.join(cacheDir('drawings'), `${key}.json`), 'utf8');
    const parsed = z.array(MarkSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function writeCached(key: string, marks: Mark[]): Promise<void> {
  try {
    const dir = cacheDir('drawings');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${key}.json`), `${JSON.stringify(marks)}\n`, 'utf8');
  } catch (err) {
    log.debug('could not cache the drawing', err);
  }
}

/* -------------------------------------------------------------------- calls */

/** Draw one instruction. `undefined` when there is no client, no schema, or no answer. */
export async function drawOne(
  instruction: string,
  opts: { model?: string; context?: string } = {},
): Promise<Mark[] | undefined> {
  const key = drawKey(instruction);
  const cached = await readCached(key);
  if (cached?.length) {
    log.debug(`drawing served from the cache: "${instruction.slice(0, 60)}"`);
    return cached;
  }

  const c = await anthropicClient();
  const schema = await drawingJsonSchema();
  if (!c || !schema) return undefined;

  const ask = opts.context
    ? `DRAW: ${instruction}\n\nThe beat this belongs to says: "${opts.context}"\nDraw only what the instruction asks for; the sentence is context for what matters in it.`
    : `DRAW: ${instruction}`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: ask },
  ];
  const short = instruction.slice(0, 60);

  // Two attempts, because the one failure mode seen in practice is a shape failure the
  // model can fix when it is shown: nine drawings, one of which came back with
  // `elements` as a string. Losing a whole picture to that is not worth saving a call.
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await callTool(
        c,
        opts.model ?? drawModel(),
        DRAW_BRIEF,
        messages,
        schema,
        { name: TOOL, description: 'Emit the finished drawing as a list of marks.' },
        8000,
      );
    } catch (err) {
      log.warn(`could not draw "${short}"`, errorDetail(err));
      return undefined;
    }
    const parsed = DrawingSchema.safeParse(raw);
    if (parsed.success) {
      await writeCached(key, parsed.data.elements);
      return parsed.data.elements;
    }
    const detail = errorDetail(parsed.error);
    log.warn(`the drawing did not validate (attempt ${attempt + 1}): "${short}"`, detail);
    if (attempt >= 1) return undefined;
    messages.push(
      { role: 'assistant', content: JSON.stringify(raw).slice(0, 20_000) },
      {
        role: 'user',
        content: `That drawing failed validation:\n${detail}\n\nCall ${TOOL} again with the whole drawing, corrected. \`elements\` is an array of mark objects.`,
      },
    );
  }
  return undefined;
}

/** Beats in the order the lesson tells them, paired with the intents that want ink. */
function drawable(lesson: Lesson): { step: LessonStep; intent: VisualIntent }[] {
  const steps: LessonStep[] = [
    lesson.hook,
    lesson.anchor,
    ...lesson.steps,
    lesson.worked,
    lesson.misconception,
    lesson.recap,
  ].filter(Boolean) as LessonStep[];
  const out: { step: LessonStep; intent: VisualIntent }[] = [];
  for (const step of steps) {
    for (const intent of step.visuals) {
      if (intent.kind !== 'draw') continue;
      if (intent.marks?.length) continue;
      if (intent.character) continue;
      out.push({ step, intent });
    }
  }
  return out;
}

/** How many drawings are in flight at once. Politeness, not a rate limit. */
const CONCURRENCY = 4;

/**
 * Fill in every `draw` intent's marks, in place, in parallel.
 *
 * Mutating the lesson is deliberate: the marks belong *in* `lesson.json`, so the file on
 * disk is a complete description of the video and re-rendering it needs no model, no key
 * and no network. An intent whose drawing fails keeps `kind: 'draw'` with no marks, and
 * the compiler falls back to the lanes that need nothing.
 */
export async function drawLesson(lesson: Lesson, opts: LessonOptions = {}): Promise<number> {
  const work = drawable(lesson);
  if (!work.length) return 0;
  const model = drawModel(opts as { drawModel?: string });
  log.info(`drawing ${work.length} picture${work.length === 1 ? '' : 's'} with ${model}`);

  let done = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const job = work[i];
      if (!job) return;
      const marks = await drawOne(job.intent.describe, {
        model,
        context: job.step.narration,
      });
      if (marks?.length) {
        job.intent.marks = marks;
        done += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
  log.info(`${done}/${work.length} drawings composed`);
  return done;
}
