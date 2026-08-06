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
import type { Message } from './anthropic.js';
import { anthropicClient, callTool, errorDetail, imagePart } from './anthropic.js';
import { auditDrawing } from './draw-audit.js';
import { fixTag, reviseDrawing } from './draw-critic.js';
import { prepareMarks } from './drawing.js';
import type { Box } from './elements.js';
import { readInkBox } from './underlay.js';
import { drawingJsonSchema } from './schema.js';
import type { DrawPreview, LessonOptions } from './types.js';

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
const BRIEF_VERSION = 'draw/v2';

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

Every mark also takes \`tone\`, which is the ink it is drawn in. See COLOUR below. Leave it out and the mark is drawn in the ordinary dark ink, which is right for almost everything.

WHAT MAKES A DRAWING TEACH, in the order it matters
1. DRAW THE STRUCTURE AND THE RELATION, NOT THE OBJECT. A photograph of a battery teaches nothing; two electrode stacks facing each other across a gap, with one thing crossing the gap and another turned back at it, is the whole idea. Ask what the learner has to SEE to believe the beat, and draw exactly that. If two things are compared, put them side by side. If something is inside something else, its coordinates have to be inside. If two things face each other across a gap, make the gap wide enough to see.
2. NAME THE PARTS. You can spell and the board writes in the same hand as everything else, so label what matters — 2 to 5 labels is usual. Put each label in empty space beside the thing it names, never on top of ink, and use an arrow from the label to the part when the part is small or crowded. Labels are the single biggest advantage this lane has: use them, but do not caption the picture with a sentence.
3. ONE DRAWING, ONE IDEA. 10 to 25 marks. Under 8 is too crude to teach; over 30 is a mess nobody reads. Leave out anything the beat does not need — no ground line, no background, no scenery, no decorative frame.
   **NEVER TITLE THE DRAWING.** No "Matrix Multiplication" across the top, no "Binary Search", no name for the picture as a whole. The board already writes the beat's own sentence above your drawing, so a title is a second caption on one panel — and being the biggest thing you drew, it is the one that lands across everything else. Labels name PARTS. A title is dropped before it reaches the board.
4. ID EVERY MARK BY WHAT IT IS. \`left-stack\`, \`damp-gap\`, \`ion-1\`, \`wire\`, \`bulb\` — the part, not the shape. That id is how a later beat highlights this part, moves it, or draws it again, so a mark called \`rect-3\` is a mark nobody can ever refer to.
5. DRAW IN THE ORDER A PERSON WOULD. Big containing shapes first, then the parts inside them, then connectors and arrows, then labels last. The board reveals your marks in the order you list them, so this order is what the viewer watches being drawn.

LEGIBILITY IS PART OF BEING CORRECT
A drawing where everything is in the right place and nothing can be told apart has failed. This is the most common way an intricate subject — an orbital diagram, charges moving between layers, a cell in cross-section, two interfering waves — comes out unreadable: not because a mark is wrong, but because every mark is on top of every other one. The picture is in there and nobody can see it.

- **SPREAD OUT. USE THE WHOLE CANVAS.** It is ${DRAW_W}x${DRAW_H} and it will be shown large. The commonest mistake by far is drawing a detailed structure inside a small part of it and leaving three quarters empty. If you have six things to show, they get a sixth of the canvas each — not a corner each, with the middle empty.
- **NOTHING OVERLAPS UNLESS IT MEANS "INSIDE".** Two parts sharing coordinates is a claim that one contains the other. If that is not what you mean, move them apart. Leave a real channel of blank canvas between separate parts — 30 units at the very least, and more between the big ones.
- **A GAP THAT MATTERS IS DRAWN WIDE.** If the beat is about something crossing a gap, that gap needs to be 100+ units, not 15. The learner has to see the crossing, and a 15-unit gap with an arrow through it is one thick line.
- **HATCHING IS DENSE. NEVER WRITE INSIDE IT.** A name written on top of shading is unreadable — this is a measured defect, seen on \`electron stuck\`, \`cathode\` and \`graphite\` in a shipped film. Put the label in clear canvas OUTSIDE the shaded region and run an arrow to it. Do not hatch a strip narrower than about 70 units and then try to name it from within.
- **LINES THAT RUN TOGETHER MUST SEPARATE.** Two paths crossing the same space — one charge going one way, another coming back — are a tangle in one ink. Give them different \`tone\`s, and route them so they only cross where the crossing is the point.
- **FEWER MARKS, DRAWN BIGGER, EVERY TIME.** If the picture is getting crowded, the answer is never smaller marks. Cut a part the beat can do without. Eight legible parts teach; twenty illegible ones teach nothing, and the beat only has one sentence to spend on them anyway.

COLOUR — \`tone\`, and it has exactly one job
The board is drawn in one dark ink for a reason: colour that means nothing is noise, and a rainbow diagram is harder to read than a plain one, not easier. So \`tone\` is not styling and there is no palette to pick from. There are four values and you use one only when a *distinction the beat depends on* cannot be made any other way.
- \`ink\` — the default. Structure, containers, outlines, most parts. Leave \`tone\` out entirely for these.
- \`accent\` — the one thing this beat is about. What moves, what changes, what the narration is pointing at. Usually 1 to 4 marks, and often a path and the dots travelling along it.
- \`contrast\` — the thing that must not be confused with the accent, and nothing else. The second path, the opposite charge, the "before" against the "after". Use it ONLY when \`accent\` is already in use and the two would otherwise be indistinguishable.
- \`muted\` — context already explained, so the eye goes past it to what is new. The apparatus around the thing being discussed.

The test to apply, and it is strict: **if the drawing reads correctly in one ink, use one ink.** Colour earns its place only where a learner would otherwise follow the wrong line. Electrons looping one way through a wire while ions cross the other way through a liquid is the case it exists for — make the electrons \`accent\` and the ions \`contrast\`, put a label on each in its own tone, and the whole picture resolves. A box drawn in \`accent\` because it looked plain is the failure this is guarded against.

Emit the drawing by calling the ${TOOL} tool exactly once.`;

/**
 * The brief for a drawing composed **on top of a picture that is already there**.
 *
 * A different job from `DRAW_BRIEF`, not a variation on it. There the author invents a
 * picture; here it is looking at one and adding what the picture cannot contain — internal
 * structure, pathways, and above all names, which no image generator can put on a diagram
 * because the prompt that makes an image traceable has to say "no text".
 *
 * ## The one sentence that does the work
 *
 * The attached image is the canvas. Not a reference, not a crop to be mapped through some
 * ratio the model has to derive: the picture it is shown is the board, at the board's own
 * dimensions, with the subject already drawn on it. Every coordinate it emits is therefore
 * a coordinate it can *read off the picture*, which is what turned "the SA node is high in
 * the right atrium" from a guess into an observation — measured, and it landed on the right
 * atrium at the caval junction, anatomically correct and correctly aimed.
 *
 * The experiment that proved it (`pipeline/src/underlaysheet.mts`) briefed the box
 * arithmetic instead — "the image occupies x=220..780, so a feature a fraction fx across is
 * at 220 + fx*560" — and aim was already good. What that version got wrong was *range*: 8
 * of 22 marks fell outside the canvas, the bundle branches running to y=720 on a board 560
 * tall, because the model reasons in fractions and scales them wrong. Handing it the canvas
 * itself removes the arithmetic that produced the error, and the bound is then stated twice
 * more below, plainly, in units.
 */
const UNDERLAY_BRIEF = `You are annotating a drawing that is ALREADY ON THE BOARD.

THE ATTACHED IMAGE IS THE BOARD ITSELF, at exactly the size you are drawing on: ${DRAW_W} wide and ${DRAW_H} tall, x right, y DOWN, origin top-left. The subject has already been drawn on it. What you see at a point in that image is at that point on your canvas — if a structure looks like it is a third of the way across and halfway down the picture, it is at x=${Math.round(DRAW_W / 3)}, y=${Math.round(DRAW_H / 2)}. Read your coordinates off the picture.

STAY ON THE BOARD. Every x you emit is between 0 and ${DRAW_W}. Every y you emit is between 0 and ${DRAW_H}. **${DRAW_H}, not 1000** — the board is much wider than it is tall, and the commonest mistake here by far is running a line or a label off the bottom. That includes every point of a stroke or an arrow, and the whole extent of a box or a name, not just where it starts.

DO NOT REDRAW THE SUBJECT. Its outline, its body, its overall form are already drawn and you cannot improve them. You are adding only what the image does not have and cannot have: internal structure, pathways, the relation between parts, and NAMES.

AIM. An arrow pointing at a structure must point at where that structure IS in the picture in front of you, not where you would have put it. A mark that lands on blank board beside the subject is worse than no mark at all — it looks like a mistake, because it is one.

THE MARKS, and there are only these eight:
- rect {x,y,w,h} — a box. x,y is the TOP-LEFT corner.
- ellipse {x,y,w,h} — the ellipse inscribed in that box. A node, a site, a region: draw it where it is.
- line {points:[[x1,y1],[x2,y2]]} — one straight segment.
- stroke {points:[[x,y],…], smooth?, closed?} — a freehand line through those points, and your main tool for a pathway that follows the shape of the thing. \`smooth: true\` curves through the points; leave it false for anything angular.
- arrow {points:[[x,y],…]} — a line with a head on the LAST point. Two points is straight; three bends it through the middle one. This is your leader: from the name, to the thing.
- label {x,y,text,size} — real handwriting. x,y is the CENTRE of the words. size 26–34.
- hatch {x,y,w,h,angle} — parallel shading filling that box, at that angle in degrees.
- dots {x,y,w,h,count} — count small filled dots scattered in that box.

Every mark also takes \`tone\`: \`accent\` for the one thing this beat is about, \`contrast\` for the thing that must not be confused with it, \`muted\` for context. Leave it out for everything else — and if the drawing reads correctly in one ink, use one ink.

NAMES GO IN THE CLEAR SPACE. The subject does not fill the board; there is empty canvas to the left and to the right of it. Put every label there and run an arrow from the label to the structure it names. A name written across the drawing is unreadable, whatever it says, and it hides the picture underneath it.

ID EVERY MARK BY WHAT IT IS — \`av-node\`, \`left-bundle-branch\`, \`apex\` — the part, not the shape. That id is how the narration finds this mark and draws it on the words that name it, so a mark called \`ellipse-3\` is a mark nobody can cue.

DRAW IN THE ORDER A PERSON WOULD: the pathway or structure first, then the parts along it, then the leaders, then the names.

10 to 20 marks. Fewer marks drawn bigger, every time. Emit the drawing by calling the ${TOOL} tool exactly once.`;

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
export function drawKey(instruction: string, underlay?: Uint8Array): string {
  // The brief itself is in the key, not just its version number. Every word of it
  // changes what comes back — the canvas dimensions most of all — and a cache that
  // survived a brief change would serve drawings composed for a canvas that no longer
  // exists, which is the subtlest possible way to make a fix look like it did nothing.
  //
  // And when there is an underlay, **the picture is in the key too, not just its prompt**.
  // These marks were aimed at one specific image: a leader arrow reaching the septum is a
  // true statement about that heart and a false one about the next heart the generator
  // returns for the same words. Keying on the prompt alone would serve marks annotating a
  // picture nobody can see any more — which on the board looks exactly like the model being
  // bad at aiming, and is the one failure that would be diagnosed wrong.
  return hash(
    BRIEF_VERSION,
    underlay ? UNDERLAY_BRIEF : DRAW_BRIEF,
    instruction.trim().toLowerCase(),
    underlay ? hash(Buffer.from(underlay).toString('base64')) : '',
  ).slice(0, 16);
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

/**
 * The corrected drawing, cached beside the original rather than over it.
 *
 * Two files per drawing, on purpose. The author's own attempt keeps the name it has always
 * had — so a cache built before the correction pass existed is still every bit of work it
 * always was, and improving the critic costs one call per picture rather than two. And a
 * *rejected* correction is written here too, holding the original's marks: the second call
 * would fail the same way as the first, and a picture is not worth paying for twice.
 *
 * The name carries `fixTag()`, so changing the instructions a correction is made under
 * invalidates the corrections and nothing else — and it carries the mode, so the
 * `INKCAST_DRAW_FIX=all` experiment and the gated default never read each other's answers.
 */
function fixFile(key: string): string {
  const mode = revisesEverything() ? '-all' : '';
  return path.join(cacheDir('drawings'), `${key}.${fixTag()}${mode}.json`);
}

async function readFix(key: string): Promise<Mark[] | undefined> {
  try {
    const parsed = z.array(MarkSchema).safeParse(JSON.parse(await readFile(fixFile(key), 'utf8')));
    return parsed.success && parsed.data.length ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function writeFix(key: string, marks: Mark[]): Promise<void> {
  try {
    await mkdir(cacheDir('drawings'), { recursive: true });
    await writeFile(fixFile(key), `${JSON.stringify(marks)}\n`, 'utf8');
  } catch (err) {
    log.debug('could not cache the corrected drawing', err);
  }
}

/* -------------------------------------------------------------------- calls */

/** Options for one drawing. `preview` is what makes the correction pass a visual one. */
export type DrawOneOptions = {
  model?: string;
  context?: string;
  preview?: DrawPreview;
  /**
   * The board this drawing is composed on top of: `png` is the generated subject already
   * drawn, at canvas size, and `box` is where its ink sits in canvas units. Switches the
   * author to `UNDERLAY_BRIEF`, sends the picture ahead of the instruction, and makes the
   * picture an obstacle every name has to keep off. See `./underlay.ts`.
   */
  underlay?: { png: Uint8Array; box: Box };
  /** Default `true`. `INKCAST_DRAW_FIX=0` turns the correction pass off for a whole run. */
  revise?: boolean;
};

function revisionEnabled(opts: DrawOneOptions): boolean {
  if (process.env.INKCAST_DRAW_FIX === '0') return false;
  return opts.revise !== false;
}

/**
 * Whether a drawing is looked at even when nothing is measurably wrong with it.
 *
 * Off by default, and the default is a deliberate trade rather than a shortcut. The gate is
 * arithmetic, so it sees the defects arithmetic can see — labels, bounds, wrapping — and it
 * is blind to the ones it cannot: the benzene ring whose double bonds were drawn as chords
 * across the middle audits perfectly clean. The literature's ablation is about *geometry*,
 * which is exactly what the gate cannot measure, so an unconditional pass would find more.
 * It would also double the cost of the lane on every video, including the drawings that
 * were already right.
 *
 * `INKCAST_DRAW_FIX=all` is that experiment, one environment variable away: run the sheet
 * both ways and compare the frames before deciding this should be the default.
 */
function revisesEverything(): boolean {
  return process.env.INKCAST_DRAW_FIX === 'all';
}

/**
 * Draw one instruction, then look at it and correct it.
 *
 * `undefined` when there is no client, no schema, or no answer. The correction pass can
 * only ever improve the result or leave it alone (see `draw-critic.ts`), so a drawing that
 * cannot be corrected is still the drawing that was composed.
 */
export async function drawOne(
  instruction: string,
  opts: DrawOneOptions = {},
): Promise<Mark[] | undefined> {
  const key = drawKey(instruction, opts.underlay?.png);
  const short = instruction.slice(0, 60);

  // Only when corrections are wanted. `revise: false` means "the drawing as it was
  // composed", so serving a cached correction would answer a different question — and it
  // would quietly break the one tool that shows what the correction pass is worth, which
  // compares the two by asking for each in turn (`pipeline/src/drawsheet.mts`).
  const fixed = revisionEnabled(opts) ? await readFix(key) : undefined;
  if (fixed) {
    log.debug(`corrected drawing served from the cache: "${short}"`);
    return fixed;
  }

  let marks = await readCached(key);
  if (marks?.length) log.debug(`drawing served from the cache: "${short}"`);
  else marks = await compose(instruction, key, opts);
  if (!marks?.length) return undefined;

  return (await correct(marks, instruction, key, opts)) ?? marks;
}

/**
 * The correction pass, gated twice: on something being measurably wrong (inside
 * `reviseDrawing`) and on a client being available at all.
 */
async function correct(
  marks: Mark[],
  instruction: string,
  key: string,
  opts: DrawOneOptions,
): Promise<Mark[] | undefined> {
  if (!revisionEnabled(opts)) return undefined;
  const under = opts.underlay?.box;
  if (!revisesEverything() && !auditDrawing(prepareMarks(marks, under), under).length)
    return undefined;
  const c = await anthropicClient();
  const schema = await drawingJsonSchema();
  if (!c || !schema) return undefined;
  const revision = await reviseDrawing(marks, {
    client: c,
    model: opts.model ?? drawModel(),
    schema,
    ...(opts.preview ? { preview: opts.preview } : {}),
    ...(opts.underlay ? { underlay: opts.underlay } : {}),
    instruction,
    ...(revisesEverything() ? { always: true } : {}),
  });
  if (!revision) return undefined;
  await writeFix(key, revision.marks);
  return revision.marks;
}

/** One drawing, composed from nothing. Cached under the author's own key. */
async function compose(
  instruction: string,
  key: string,
  opts: DrawOneOptions,
): Promise<Mark[] | undefined> {
  const c = await anthropicClient();
  const schema = await drawingJsonSchema();
  if (!c || !schema) return undefined;

  const ask = opts.underlay
    ? `ANNOTATE THE ATTACHED BOARD: ${instruction}` +
      (opts.context
        ? `\n\nThe beat this belongs to says: "${opts.context}"\nAdd only what the instruction asks for; the sentence is context for what matters in it.`
        : '')
    : opts.context
      ? `DRAW: ${instruction}\n\nThe beat this belongs to says: "${opts.context}"\nDraw only what the instruction asks for; the sentence is context for what matters in it.`
      : `DRAW: ${instruction}`;

  // The picture goes ahead of the instruction, the same message shape the critic already
  // uses (`draw-critic.ts`): the model has to have looked before it reads what to do.
  const first: Message = opts.underlay
    ? { role: 'user', content: [imagePart(opts.underlay.png), { type: 'text', text: ask }] }
    : { role: 'user', content: ask };
  const messages: Message[] = [first];
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
        opts.underlay ? UNDERLAY_BRIEF : DRAW_BRIEF,
        messages,
        schema,
        { name: TOOL, description: 'Emit the finished drawing as a list of marks.' },
        8000,
      );
    } catch (err) {
      log.warn(`could not draw "${short}"`, errorDetail(err));
      return undefined;
    }
    const parsed = DrawingSchema.safeParse(repairElements(raw));
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

/**
 * Repair the one corruption of `elements` that a re-ask cannot fix.
 *
 * `elements` arrives as a JSON *string* often enough that `DrawingSchema` parses rather
 * than rejects it. On the underlay experiment it arrived as a string **and malformed** —
 * `{"x":565,y":300}`, one opening quote missing — and showing that back to the model does
 * not help, because it does not recognise it as an error: what it emitted, as it
 * understands the emission, was correct. So the one corruption that actually occurs is
 * repaired here and everything else still goes round the re-ask loop.
 *
 * Untouched unless it is both a string and unparseable, so a well-formed answer never goes
 * near this.
 */
function repairElements(raw: unknown): unknown {
  const list = (raw as { elements?: unknown } | undefined)?.elements;
  if (typeof list !== 'string') return raw;
  try {
    JSON.parse(list);
    return raw;
  } catch {
    /* the case this function is for */
  }
  const mended = list.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1"$2":');
  try {
    JSON.parse(mended);
  } catch {
    return raw;
  }
  log.debug('repaired a key that lost its opening quote in the emitted drawing');
  return { ...(raw as object), elements: mended };
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

/**
 * The picture this intent is to be drawn on top of, generated, and recorded where it lands.
 *
 * `inkBox` is written back onto the intent — so `lesson.json` carries the geometry the
 * marks were composed against and the compiler can put the image back exactly there with
 * no key and no network — and it is *cleared first*, unconditionally, for every intent that
 * asks for an underlay. The field is stage-owned and pruned from the lesson author's tool
 * schema, but a lesson can also arrive from disk or from a hand edit, and a box left over
 * from a picture this run did not generate would place an image the marks never saw.
 *
 * Everything about this is non-fatal. No image provider, no vectoriser, a failed
 * generation: the intent keeps its marks and is drawn the way every drawing has always been
 * drawn. That matters more than it looks — this lane is the one that needs a paid key, and
 * a lesson that only works with one is not the lesson this project ships.
 */
async function underlayFor(
  intent: VisualIntent,
  opts: LessonOptions,
): Promise<{ png: Uint8Array; box: Box } | undefined> {
  const prompt = intent.underlay?.prompt?.trim();
  if (!intent.underlay) return undefined;
  delete intent.underlay.inkBox;
  if (!prompt || !opts.drawUnderlay) return undefined;
  let made: Awaited<ReturnType<NonNullable<LessonOptions['drawUnderlay']>>>;
  try {
    made = await opts.drawUnderlay(prompt);
  } catch (err) {
    log.warn(`could not generate the underlay "${prompt.slice(0, 60)}"`, errorDetail(err));
    return undefined;
  }
  if (!made) {
    log.info(`no underlay for "${prompt.slice(0, 60)}" — drawing it in marks alone`);
    return undefined;
  }
  const box = readInkBox(made.inkBox);
  if (!box) {
    log.warn(`the underlay for "${prompt.slice(0, 60)}" came back without a usable box`);
    return undefined;
  }
  intent.underlay.inkBox = made.inkBox;
  return { png: made.png, box };
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
  const model = drawModel(opts);
  log.info(`drawing ${work.length} picture${work.length === 1 ? '' : 's'} with ${model}`);

  let done = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const job = work[i];
      if (!job) return;
      const underlay = await underlayFor(job.intent, opts);
      const marks = await drawOne(job.intent.describe, {
        model,
        context: job.step.narration,
        ...(underlay ? { underlay } : {}),
        ...(opts.drawPreview ? { preview: opts.drawPreview } : {}),
        ...(opts.reviseDrawings === undefined ? {} : { revise: opts.reviseDrawings }),
      });
      if (marks?.length) {
        job.intent.marks = marks;
        done += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
  const wrong = work.filter((job) => {
    if (!job.intent.marks?.length) return false;
    const under = readInkBox(job.intent.underlay?.inkBox);
    return auditDrawing(prepareMarks(job.intent.marks, under), under).length > 0;
  }).length;
  log.info(
    `${done}/${work.length} drawings composed` +
      (wrong ? `, ${wrong} still measurably imperfect` : ', none measurably wrong'),
  );
  return done;
}
