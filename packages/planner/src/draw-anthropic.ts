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
import type { Lesson, LessonStep, Mark, OnProblem, OnSpend, VisualIntent } from '@inkcast/core';
import {
  DRAW_H,
  DRAW_W,
  Mark as MarkSchema,
  cacheDir,
  hash,
  logger,
  noteSpend,
} from '@inkcast/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Message } from './anthropic.js';
import { anthropicClient, callTool, errorDetail, imagePart } from './anthropic.js';
import { auditDrawing } from './draw-audit.js';
import { fixTag, reviseDrawing } from './draw-critic.js';
import { prepareMarks } from './drawing.js';
import type { Box } from './elements.js';
import { figureBox, readInkBox } from './underlay.js';
import { drawingJsonSchema } from './schema.js';
import type { DrawFigure, DrawPreview, LessonOptions } from './types.js';

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
/**
 * Bump when `DRAW_BRIEF` or the mark vocabulary changes: it is part of the cache key.
 *
 * It has not moved for `FIGURE_BRIEF`, and deliberately. Every brief is hashed into the
 * key *by its text* (see `drawKey`), so a brief that did not exist before invalidates
 * nothing that did — the machine's cached blank-board and form drawings are still every
 * bit of work they always were. Bumping this would throw them all away to ship a lane
 * that never used any of them.
 *
 * It did **not** move for the two lines `DRAW_BRIEF` gained about how full a card has to be,
 * and the reason is the same argument from the other side. This constant is hashed for all
 * three lanes at once (`drawKey`), so bumping it would throw away the form and figure
 * drawings as well — and those briefs did not change. The blank-board drawings *are* thrown
 * away, by the only thing that should throw them away: their own brief's text, which is in
 * the key — `packages/planner/test/draw-anthropic.test.ts` pins both halves of that. Bump
 * this one only for something no brief says out loud, such as the mark vocabulary the
 * schema accepts.
 */
const BRIEF_VERSION = 'draw/v2';

export function drawModel(opts?: { drawModel?: string }): string {
  return opts?.drawModel ?? process.env.INKCAST_DRAW_MODEL ?? DEFAULT_DRAW_MODEL;
}

/* -------------------------------------------------------------------- brief */

const DRAW_BRIEF = `You are drawing on a whiteboard, in a hand-drawn explainer video, by placing every mark yourself. You are not describing a picture for someone else to draw and you are not writing a caption: what you emit is exactly and only what appears on the board.

THE CANVAS is ${DRAW_W} wide and ${DRAW_H} tall. x grows right, y grows DOWN, origin top-left. Fill it — the drawing is scaled to the space it gets, so use the whole canvas with a small margin and keep everything inside it.

THE MARKS, and there are only these nine:
- rect {x,y,w,h} — a box. x,y is the TOP-LEFT corner.
- ellipse {x,y,w,h} — the ellipse inscribed in that box.
- line {points:[[x1,y1],[x2,y2]]} — one straight segment.
- stroke {points:[[x,y],…], smooth?, closed?} — a freehand line through those points, and YOUR MAIN TOOL: every outline, silhouette, curve, zigzag or shape that is not a box or an ellipse is a stroke. \`smooth: true\` curves through the points (an organic outline, a wire, a wave); leave it false for anything angular (a zigzag, a polygon, a bracket). \`closed: true\` joins the last point back to the first. 5–20 points is a good shape.
- arrow {points:[[x,y],…]} — a line with a head on the LAST point. Two points is straight; three bends it through the middle one.
- label {x,y,text,size} — real handwriting, drawn by the board itself. x,y is the CENTRE of the words. size is cap height: 26–34 for a part name, 40+ for the one thing the drawing is about. Plain words ONLY — a label cannot typeset anything, so no TeX, no Greek, no subscripts, no |0⟩. Notation goes in a \`math\` mark.
- hatch {x,y,w,h,angle} — parallel shading filling that box, at that angle in degrees. A material, a solid, a filled region, a shaded area.
- dots {x,y,w,h,count} — count small filled dots scattered in that box. Particles, charges, molecules, grain.
- math {x,y,w,h,tex,size} — one line of REAL TYPESET MATHEMATICS, drawn glyph by glyph in the board's ink. \`tex\` is TeX source with no delimiters: \\frac{dv}{dt} = -\\frac{g}{L}\\theta, not $...$. Use it for ANY notation a label cannot spell — fractions, Greek letters, subscripts and superscripts, |0⟩, operators. x,y,w,h reserve the box the notation is fitted into (aspect preserved, never stretched); give w/h room and keep other marks out of it, or omit them and the box is derived from \`size\` and the length of the TeX.

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

- **SPREAD OUT. USE THE WHOLE CANVAS.** It is ${DRAW_W}x${DRAW_H} and it will be shown large. The commonest mistake by far is drawing a detailed structure inside a small part of it and leaving three quarters empty. If you have six things to show, they get a sixth of the canvas each — not a corner each, with the middle empty. The canvas is the shape of the screen, so a drawing that comes out square, or a thin strip across the middle, is one the film has to frame with paper down the sides: end up spanning most of the ${DRAW_W} AND most of the ${DRAW_H}.
- **DRAW EVERY PART BIG.** Spreading small marks apart is not the same as filling the canvas, and this is the failure measured most often on this lane: cards whose marks span the whole board and cover a fifth of it, which read as an empty board with specks on it. It is the *ratio* that matters and not the size you draw at — the board scales your drawing to the space it gets either way, so a picture of small parts far apart stays a picture of small parts far apart. Size each part as though it were the only thing on the board and then make room for the others: a ball 200 across and not 60, a box 300 wide, a figure 400 tall, an arrow that spans the gap it crosses. Two things compared get a third of the width each.
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

THE MARKS, and there are only these nine:
- rect {x,y,w,h} — a box. x,y is the TOP-LEFT corner.
- ellipse {x,y,w,h} — the ellipse inscribed in that box. A node, a site, a region: draw it where it is.
- line {points:[[x1,y1],[x2,y2]]} — one straight segment.
- stroke {points:[[x,y],…], smooth?, closed?} — a freehand line through those points, and your main tool for a pathway that follows the shape of the thing. \`smooth: true\` curves through the points; leave it false for anything angular.
- arrow {points:[[x,y],…]} — a line with a head on the LAST point. Two points is straight; three bends it through the middle one. This is your leader: from the name, to the thing.
- label {x,y,text,size} — real handwriting. x,y is the CENTRE of the words. size 26–34. Plain words ONLY — no TeX, no Greek, no subscripts. Notation goes in a \`math\` mark.
- hatch {x,y,w,h,angle} — parallel shading filling that box, at that angle in degrees.
- dots {x,y,w,h,count} — count small filled dots scattered in that box.
- math {x,y,w,h,tex,size} — one line of real typeset mathematics. \`tex\` is TeX source with no delimiters. Use it for any notation a label cannot spell; x,y,w,h reserve the box the notation is fitted into.

Every mark also takes \`tone\`: \`accent\` for the one thing this beat is about, \`contrast\` for the thing that must not be confused with it, \`muted\` for context. Leave it out for everything else — and if the drawing reads correctly in one ink, use one ink.

NAMES GO IN THE CLEAR SPACE. The subject does not fill the board; there is empty canvas to the left and to the right of it. Put every label there and run an arrow from the label to the structure it names. A name written across the drawing is unreadable, whatever it says, and it hides the picture underneath it.

ID EVERY MARK BY WHAT IT IS — \`av-node\`, \`left-bundle-branch\`, \`apex\` — the part, not the shape. That id is how the narration finds this mark and draws it on the words that name it, so a mark called \`ellipse-3\` is a mark nobody can cue.

DRAW IN THE ORDER A PERSON WOULD: the pathway or structure first, then the parts along it, then the leaders, then the names.

10 to 20 marks. Fewer marks drawn bigger, every time. Emit the drawing by calling the ${TOOL} tool exactly once.`;

/**
 * Where a figure sits, resolved once so the brief and the box handed to the author cannot
 * disagree. Pure arithmetic over `FIGURE_AREA`, so it is safe at module scope.
 */
const FIGURE_BOX = figureBox();

/**
 * The brief for marks composed on top of a **finished colour figure**.
 *
 * A third job, not a variation on the second. `UNDERLAY_BRIEF` annotates a *form*: a traced
 * outline whose whole mechanism is still missing, so the marks carry the pathway, the parts
 * and their relation, and the picture only supplies the shape. A figure arrives with the
 * mechanism already in it — a cutaway, a cross-section, arrows in hue — and the one thing it
 * cannot have is words, because the prompt that makes an image legible has to say "no text".
 * So the marks shrink to almost nothing: names, and the leaders that reach them.
 *
 * ## What composing blind actually produced
 *
 * Until now this lane sent the author no picture at all, so it fell through to `DRAW_BRIEF`
 * — "fill the canvas", "draw the structure and the relation", "10 to 25 marks" — and the
 * compiler laid the result over a picture the author had never seen. Measured on
 * `projects/cardiac8f`, across its three figure beats: 45 marks, of which **23 are a
 * structure the figure already draws**. A 17-point `closed: true` `heart-outline` spanning
 * x=290..710, drawn on a colour cutaway of a heart. Four `rect`s and two `hatch`es covering
 * x=110..870, y=60..510 of another. Two ellipses over the atria and two closed strokes over
 * the ventricles on a beat whose instruction, in full, was "Name the two upper chambers with
 * a leader line to the word atria, and the two lower chambers with a leader to the word
 * ventricles" — it was asked for four marks and it drew ten.
 *
 * Every prohibition below therefore names a mark that was really emitted, and the positive
 * half of the brief is short because on this lane there is very little left to say.
 *
 * ## The margin is not where the names go, and this brief has to say so
 *
 * `UNDERLAY_BRIEF` can send every name to the clear board either side, because a form is
 * given 620 of the canvas's 1000 units and leaves 190 on each flank. A figure claims 840, so
 * the flanks are 80 units — narrower than one word at label size. Repeating the form's
 * instruction here would send every name somewhere it cannot fit. What the figure has
 * instead is its own white paper: these rasters are drawn on
 * white, the board composites them with `multiply`, and white multiplied by the paper is the
 * paper — so the pale regions of the picture *are* clear board, and the author can see
 * exactly where they are. That is a place only a model looking at the picture can find,
 * which is one more reason this lane could never have worked unseen.
 */
const FIGURE_BRIEF = `You are putting NAMES on a finished colour figure that is already on the board.

THE ATTACHED IMAGE IS THE BOARD ITSELF, at exactly the size you are drawing on: ${DRAW_W} wide and ${DRAW_H} tall, x right, y DOWN, origin top-left. The figure occupies x=${Math.round(FIGURE_BOX.x)}..${Math.round(FIGURE_BOX.x + FIGURE_BOX.w)}, y=${Math.round(FIGURE_BOX.y)}..${Math.round(FIGURE_BOX.y + FIGURE_BOX.h)} of it. What you see at a point in that image is at that point on your canvas — so read every coordinate off the picture instead of deciding where a structure ought to be.

STAY ON THE BOARD. Every x you emit is between 0 and ${DRAW_W}. Every y you emit is between 0 and ${DRAW_H}. **${DRAW_H}, not 1000** — the board is much wider than it is tall, and the commonest mistake here by far is running a leader or a name off the bottom. That includes every point of an arrow and the whole extent of a name, not just where it starts.

THE FIGURE ALREADY TEACHES, and that is the whole difference between this job and drawing on a blank board. It is a cutaway, a cross-section, a system in colour: the chambers, the layers, the pathway, the flow arrows and the state are drawn already, in hue, at a fidelity marks cannot reach. What it does not have is a single word on it — the prompt that makes a figure legible has to say "no text" — so **you are the words**.

SO DRAW ALMOST NOTHING. 3 to 8 marks, and most of them a name with its leader. Two or three names is a good figure. If the instruction you are given describes something the picture already shows — shading, a wave front, arrows through a valve, chambers in colour — then it is already shown: name it, do not draw it a second time.

NEVER REDRAW THE SUBJECT. Its outline, its chambers, its layers, its internal pathway and its arrows are in the picture in front of you, drawn better than marks can draw them, and a mark that repeats one lands as ink across the thing it repeats. This is measured, not cautionary: on three beats of one shipped lesson, 23 of 45 marks were a second picture laid over the first, including a closed heart outline drawn on top of a heart.

NEVER RING A STRUCTURE. A closed stroke or an ellipse drawn around a part of a colour figure is a loop across the picture, not a highlight — the ink is opaque and the part it circles is the part it hides. Point at a part with a short arrow coming in from outside it. An \`ellipse\` is only right when the part is one small feature sitting on pale paper and the ellipse is the size of that feature.

NEVER SHADE. \`hatch\`, \`dots\` and a plain \`rect\` belong to a drawing composed from nothing. Over a picture that is already in colour they read as a grid drawn on top of it, which is exactly what four boxes and two hatched blocks over an anatomical cutaway looked like.

THE MARKS YOU USE, and there are five:
- label {x,y,text,size} — real handwriting, in the same hand as the rest of the board. x,y is the CENTRE of the words. size 26–32. One or two words: a phrase is a caption, and the beat already has a sentence written above the picture.
- arrow {points:[[x,y],…]} — a line with a head on the LAST point. This is your leader: from the name, to the thing. Two points is straight; three bends it through the middle one.
- line {points:[[x1,y1],[x2,y2]]} — one straight segment, for a leader that should not carry a head.
- ellipse {x,y,w,h} — the ellipse inscribed in that box. For marking one small feature, at the size of that feature.
- stroke {points:[[x,y],…], smooth?, closed?} — only for a pathway the figure does not already draw. If the figure draws it, leave it alone.

Every mark also takes \`tone\`. The figure carries its own colour, so a mark in a third colour beside it is noise: leave \`tone\` out unless one mark genuinely has to be told apart from the others, and then \`accent\` for the one thing this beat is about.

WHERE THE NAMES GO. There are only ${Math.round(FIGURE_BOX.x)} units of bare board on each side of the figure, which is narrower than one word — so the flanks are not where the names live. Look at the attached image and find the PALE PAPER inside the picture. Every one of these figures is drawn on white and the board multiplies the white away, so the light parts of the picture are clear board you can write on. Put each name on the palest space nearest the part it names and run a short leader in. Never write across the coloured structures themselves, and never write across another name.

ID EVERY MARK BY WHAT IT IS — \`av-node\`, \`left-bundle-branch\`, \`apex\` — the part, not the shape. That id is how the narration finds this mark and writes it on the words that name it, so a mark called \`label-3\` is a mark nobody can cue.

DRAW IN THE ORDER A PERSON WOULD: one part at a time, the leader and then the name it carries.

Emit the drawing by calling the ${TOOL} tool exactly once.`;

/**
 * Which half of the hybrid lane a picture belongs to: a traced outline, or a colour figure.
 *
 * The same two words `Lesson`'s `underlay.kind` uses, because they have to mean the same
 * thing on both sides of the stage — the author's choice travels from `lesson.json` to the
 * brief the marks are composed under, and a lane that renamed it here would silently
 * compose a form's marks for a figure.
 */
export type UnderlayKind = 'form' | 'figure';

/** The brief marks are composed under, given what is already on the board. */
function briefFor(underlay: boolean, kind: UnderlayKind | undefined): string {
  if (!underlay) return DRAW_BRIEF;
  return kind === 'figure' ? FIGURE_BRIEF : UNDERLAY_BRIEF;
}

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
export function drawKey(instruction: string, underlay?: Uint8Array, kind?: UnderlayKind): string {
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
  //
  // `briefFor` rather than a two-way choice, and hashing the brief's *text* is what makes
  // the third lane free: `form` and the blank board resolve to the exact strings they
  // always did, so every drawing already on this machine stays cached, and only a figure —
  // which never had a picture in its key at all, because it was never shown one — gets a
  // key it has not seen before.
  return hash(
    BRIEF_VERSION,
    briefFor(Boolean(underlay), kind),
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
   * drawn, at canvas size, and `box` is where it sits in canvas units. Sends the picture
   * ahead of the instruction and makes it an obstacle every name has to keep off. See
   * `./underlay.ts`.
   *
   * `kind` chooses the brief, and the two are different jobs rather than two settings —
   * `form` marks carry the mechanism a traced outline lacks, `figure` marks carry only the
   * names a finished colour picture cannot have. Absent means `form`, which is what keeps
   * every drawing already cached on this machine cached: see `drawKey`. `box` is the
   * measured ink box for a form and `figureBox()` for a figure, and either way it is the
   * box the compiler will really place the picture at, because the author's aim and the
   * picture's position are one number and not two.
   */
  underlay?: { png: Uint8Array; box: Box; kind?: UnderlayKind };
  /** Default `true`. `INKCAST_DRAW_FIX=0` turns the correction pass off for a whole run. */
  revise?: boolean;
  /** Where the critic's non-kept outcomes are recorded (plan 3.4). See `OnProblem`. */
  onProblem?: OnProblem;
  /**
   * Where this lane's model calls are recorded (plan 3.5). See `ModelSpend`.
   *
   * Two lanes report through it and they are separated on purpose: `drawing` is the
   * author composing a picture, `drawing-fix` is the critic looking at one it has
   * already been shown. Told apart, the report answers the question the correction pass
   * exists to argue about — what does looking at the render cost, per film.
   */
  onSpend?: OnSpend;
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
  const key = drawKey(instruction, opts.underlay?.png, opts.underlay?.kind);
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
    ...(opts.onProblem ? { onProblem: opts.onProblem } : {}),
    ...(opts.onSpend ? { onSpend: opts.onSpend } : {}),
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

  // A figure's instruction is the one place the lesson author reliably over-asks: it writes
  // `describe` as the whole picture ("both upper chambers shaded with a spreading wave
  // front, arrows pointing down through the open valves") because that is also roughly the
  // sentence that generated the figure. Read as an order it is an order to redraw the
  // figure, and read blind that is exactly what happened. So the ask says plainly which
  // half of it is still to do, and the brief says it again.
  const ask = opts.underlay
    ? (opts.underlay.kind === 'figure'
        ? `NAME THE PARTS OF THE ATTACHED FIGURE: ${instruction}\n\nWhatever of that the figure already shows is already shown — put names on it, do not draw it again.`
        : `ANNOTATE THE ATTACHED BOARD: ${instruction}`) +
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
        briefFor(Boolean(opts.underlay), opts.underlay?.kind),
        messages,
        schema,
        { name: TOOL, description: 'Emit the finished drawing as a list of marks.' },
        8000,
        opts.onSpend
          ? (u) => noteSpend(opts, { lane: 'drawing', provider: 'anthropic', ...u })
          : undefined,
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
 * How the figure a drawing annotates is made visible to the author who annotates it.
 *
 * A separate seam from `DrawUnderlay`, because the box travels the other way. A form's box
 * is an *answer*: the picture is generated, traced, and the box measured from wherever its
 * ink turned out to be, so the seam is the only thing that can report it. A figure is never
 * traced, so there is nothing to measure and nothing to report — `figureBox()` decides the
 * box here and hands it *in*, and all that comes back is the board as the author will see
 * it. Folding this into `DrawUnderlay` would mean returning a number the caller had just
 * supplied, which is how the two sides of this lane begin disagreeing about one number.
 *
 * The raster behind that board has to be the one the visuals stage will resolve for this
 * asset — same id, same prompt, same seed, same aspect, generated as a figure and not as a
 * line-art form — or the marks annotate a picture the film never shows. `drawKey` hashes
 * the picture into the drawing's key for the same reason.
 */
/**
 * The figure seam, which `@inkcast/pipeline` supplies.
 *
 * Re-exported from `types.ts` rather than declared here, and that is the change: it
 * used to be read off the options bag through a widening — `(opts as … & { drawFigure?
 * }).drawFigure` — because nothing supplied it, and declaring a field no caller fills
 * in is a promise the surface cannot keep. `openDrawUnderlay` supplies it now, so the
 * field is declared beside `drawUnderlay` where it belongs and the cast goes. A caller
 * that still passes nothing composes the marks unseen, and `underlayFor` says so.
 */
export type { DrawFigure } from './types.js';

function figureSeam(opts: LessonOptions): DrawFigure | undefined {
  return opts.drawFigure;
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
 *
 * Exported for its own test, as `compile.ts`'s `findReuse` is: the seam it reaches for and
 * the box it records are the two facts the whole hybrid lane rests on, and both are
 * checkable without a model, a key or a browser.
 */
export async function underlayFor(
  intent: VisualIntent,
  opts: LessonOptions,
): Promise<{ png: Uint8Array; box: Box; kind: UnderlayKind } | undefined> {
  const prompt = intent.underlay?.prompt?.trim();
  if (!intent.underlay) return undefined;
  delete intent.underlay.inkBox;
  if (!prompt) return undefined;

  // A figure is never traced — a binary trace erases the hues that carry its teaching, and
  // `visuals/src/image.ts` has the picture of what that does to an orange arrow — so there
  // is no ink to measure and none needs measuring. It simply claims its box, which is what
  // makes the compiler emit it, and everything below, which exists to find out where a
  // *traced* subject's ink actually landed, does not apply.
  //
  // What does not follow from that, and was assumed here anyway, is that there is nothing
  // to *show* the mark author either. Never traced is not never seen. Composing blind, the
  // author has no picture, falls through to `DRAW_BRIEF` — "fill the canvas", "draw the
  // structure and the relation", 10 to 25 marks — and the compiler lays the result over a
  // picture it was never shown. Measured on `projects/cardiac8f`: 23 of the 45 marks across
  // its three figure beats redraw something the figure already has, one of them a closed
  // 17-point heart outline on a colour cutaway of a heart. See `FIGURE_BRIEF`.
  //
  // So the figure is handed to the author the way a form is: the raster, drawn at the box it
  // will really occupy, on a canvas of exactly the size the marks are composed on, sent
  // ahead of the instruction and hashed into the drawing's cache key. The box is recorded on
  // the intent *before* the picture is asked for, so it is recorded whether or not one can
  // be had and the compiler's behaviour is identical either way — a run with no figure seam
  // composes exactly the drawings it composed yesterday.
  if (intent.underlay.kind === 'figure') {
    const box = figureBox();
    intent.underlay.inkBox = [box.x, box.y, box.w, box.h];
    const seam = figureSeam(opts);
    if (!seam) {
      log.info(
        `no figure board for "${prompt.slice(0, 60)}" — composing its marks without ` +
          'showing the author the picture they annotate',
      );
      return undefined;
    }
    let png: Uint8Array | undefined;
    try {
      png = await seam(prompt, box);
    } catch (err) {
      log.warn(`could not draw the figure board for "${prompt.slice(0, 60)}"`, errorDetail(err));
      return undefined;
    }
    if (!png) {
      log.info(`no figure came back for "${prompt.slice(0, 60)}" — composing its marks unseen`);
      return undefined;
    }
    return { png, box, kind: 'figure' };
  }

  if (!opts.drawUnderlay) return undefined;
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
  // Named rather than left to the default, and it costs nothing to say: `briefFor` maps
  // `form` and `undefined` to the same string, so this key is byte-identical to the one
  // every form drawing on this machine was cached under.
  return { png: made.png, box, kind: 'form' };
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
        ...(opts.onProblem ? { onProblem: opts.onProblem } : {}),
        ...(opts.onSpend ? { onSpend: opts.onSpend } : {}),
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
