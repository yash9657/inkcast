/**
 * Show the drawing to the model that drew it.
 *
 * ## Why this is the highest-value thing in the drawing lane
 *
 * An author places twenty marks by coordinate with nothing to look at, and the defects
 * that survive are exactly the ones you would expect of someone drawing blind: a name
 * lying across an arrow, two names side by side that turn out to touch, a leader that
 * reaches off the edge of the board. `docs/research/drawing.md` §3 records the finding
 * from every direction at once — the paper's own ablation is that removing canvas feedback
 * degrades *geometry*, VideoSketcher separates appearance from placement, and every
 * working Excalidraw agent renders, looks, and fixes. We have a renderer that takes 76 ms
 * a frame and a model with vision, so the loop is available for the price of one call.
 *
 * ## The two things that keep it honest
 *
 * **It is gated.** `auditDrawing` measures what is provably wrong without a model, and a
 * drawing with nothing measurably wrong never pays. Across the 41 cached drawings that is
 * about half of them, and the arithmetic in front of the gate fixes 82% of the defect
 * score for free (`markcheck.mts`). A loop that revised everything would double the cost
 * of the lane to improve the drawings that were already fine.
 *
 * **A revision cannot regress.** The model is being asked to move two labels, and a model
 * asked to move two labels will sometimes redraw a third thing worse. So the revision is
 * audited too, and it is thrown away if it measures worse than what it replaced. Without
 * that veto this would be a loop that changes drawings rather than one that improves them,
 * and nobody looking at a single frame could tell the difference. What the veto must not
 * become is a *verdict*: the score knows about labels and bounds, the model has seen the
 * whole picture, so a tie goes to the model.
 *
 * A rejected revision is still cached, because the second call would fail the same way and
 * a picture is not worth paying for twice.
 */
import type { Mark } from '@inkcast/core';
import { DRAW_H, DRAW_W, Mark as MarkSchema, logger } from '@inkcast/core';
import { z } from 'zod';
import { type Client, type Message, callTool, errorDetail, imagePart } from './anthropic.js';
import {
  AUDIT_VERSION,
  auditDrawing,
  defectLines,
  defectScore,
  defectSummary,
} from './draw-audit.js';
import { round } from './curves.js';
import { prepareMarks } from './drawing.js';
import type { Box } from './elements.js';
import type { DrawPreview } from './types.js';

const log = logger('planner:drawing:critic');

/**
 * Bump when `FIX_BRIEF` changes: it names the revision's own cache entry.
 *
 * The same discipline as the author's brief being inside its cache key. A cached revision
 * that survived a change to the instructions behind it would serve corrections made for
 * rules that no longer exist — the subtlest possible way to make a fix look like it did
 * nothing.
 */
export const FIX_VERSION = 'fix/v1';

const TOOL = 'emit_drawing';

const FIX_BRIEF = `YOU ARE LOOKING AT YOUR OWN DRAWING, rendered on the board exactly as the viewer will see it: the same pen, the same handwriting, the same wobble. This is the only chance to see it before it is drawn for real.

Below the picture are the marks that produced it, and a list of the things that are measurably wrong with it. Every item in that list is a fact — it was measured on the geometry, not judged — so each one is worth fixing.

HOW TO FIX IT
- FIX WHAT THE LIST NAMES, and look at the picture for anything else that is plainly wrong: a name that reads as belonging to the wrong part, ink that crosses ink and should not, a shape that came out unrecognisable.
- CHANGE AS LITTLE AS POSSIBLE. Keep every id. Keep every part. Keep the coordinates of everything you are not fixing, exactly. This is a correction, not a second attempt: the drawing was good enough to be worth repairing.
- MOVE THE WORDS, NOT THE PICTURE. A label in the wrong place is almost always fixed by moving the label into nearby empty space — and if the part is small or crowded, by adding a short arrow from the words to the part. Redrawing the structure to make room for a name is the wrong trade.
- A NAME HAS TO STAY WITH WHAT IT NAMES. Moving it a little is a fix; moving it somewhere it now sits beside a different part is worse than the problem it solved, and moving it off the picture altogether is worst of all. If the only clear space is far away, leave the words near their part and draw an arrow instead.
- The canvas is still ${DRAW_W} wide and ${DRAW_H} tall and everything must be inside it.
- STILL NO TITLE. No name for the picture as a whole. Labels name parts.

Emit the COMPLETE corrected drawing — every mark, not just the ones you changed — by calling the ${TOOL} tool exactly once.`;

/**
 * The revision cache tag: changes whenever anything a revision was made under does.
 *
 * Both halves matter. The brief is *how* to correct, and the audit is *what* to correct —
 * a cached correction made when shaded regions still counted as obstacles was an answer to
 * a question nobody asks any more.
 */
export function fixTag(): string {
  // Cheap and stable: both are fixed at build time, so a version plus the brief's length is
  // enough to separate one generation of corrections from the next.
  const audit = AUDIT_VERSION.replace(/\W+/g, '');
  return `${FIX_VERSION.replace(/\W+/g, '')}${audit}-${FIX_BRIEF.length}`;
}

const RevisionSchema = z.object({
  elements: z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, z.array(MarkSchema).min(3).max(40)),
});

export type Revision = {
  /** The drawing to use: the corrected one, or the original when the correction lost. */
  marks: Mark[];
  /** Defect score before and after, for the log and for the cache. */
  before: number;
  after: number;
  kept: boolean;
};

export type CriticOptions = {
  client: Client;
  model: string;
  schema: Record<string, unknown>;
  /** Renders a drawing as the board would draw it. Without it, the model works blind. */
  preview?: DrawPreview;
  /** What the drawing was asked to be, so a correction knows what it is looking at. */
  instruction: string;
  /**
   * The picture these marks are drawn on top of, when this is a hybrid drawing.
   *
   * Two things depend on it and both are silent failures without it. The audit has to
   * count the generated picture as ink, or a name written across the middle of a traced
   * heart measures perfectly clean and is never corrected. And the model has to be shown
   * it, or it is being asked to move marks off an obstacle it cannot see — the render it
   * is handed carries the marks alone, because that is all the drawing lane draws.
   */
  underlay?: { png: Uint8Array; box: Box };
  /**
   * Look at the drawing even when nothing was measured wrong (`INKCAST_DRAW_FIX=all`).
   * The gate is arithmetic and geometry is not arithmetic — see `revisesEverything`.
   */
  always?: boolean;
};

/**
 * One correction pass over a drawing that has something measurably wrong with it.
 *
 * Returns `undefined` when there was nothing to fix, or when the call could not be made —
 * both of which mean "use what you already have". Never throws.
 */
export async function reviseDrawing(
  marks: Mark[],
  opts: CriticOptions,
): Promise<Revision | undefined> {
  // The marks that will actually be drawn, not the ones the author placed: the free
  // repair pass has already moved what it could, and a correction call spent on a defect
  // that no longer exists is a call spent on nothing.
  const under = opts.underlay?.box;
  const shown = prepareMarks(marks, under);
  const defects = auditDrawing(shown, under);
  if (!defects.length && !opts.always) return undefined;

  const before = defectScore(defects);
  const short = opts.instruction.slice(0, 60);
  // Rendered in the same coordinate space as the underlay when there is one, so the two
  // pictures the model is shown can be read against each other rather than guessed at.
  const png = opts.preview
    ? await opts.preview(shown, under ? { underlay: true } : {}).catch(() => undefined)
    : undefined;
  if (!png) {
    // Worth saying out loud. The whole argument for this pass is that the model can see
    // what it drew; without the render it is being asked to fix coordinates from a list,
    // which is weaker and is not what the literature measured.
    log.debug(`revising "${short}" without a render — no preview available`);
  }

  const body = [
    `THE DRAWING WAS ASKED TO BE: ${opts.instruction}`,
    png
      ? 'The picture above is that drawing, rendered.'
      : 'No render is available this time, so work from the marks and the measurements alone.',
    '',
    ...(opts.underlay
      ? [
          '',
          `THERE IS ALREADY A PICTURE ON THIS BOARD, and the second image is it: a drawing of the subject occupying x=${round(opts.underlay.box.x)}..${round(opts.underlay.box.x + opts.underlay.box.w)}, y=${round(opts.underlay.box.y)}..${round(opts.underlay.box.y + opts.underlay.box.h)}. Your marks annotate it. Do NOT redraw it, do not write a name anywhere inside that box, and keep every arrow pointing at the structure it names in that picture. Both images are the same ${DRAW_W}x${DRAW_H} board at the same scale.`,
        ]
      : []),
    '',
    `THE MARKS THAT DREW IT:\n${JSON.stringify(shown)}`,
    '',
    defects.length
      ? `WHAT IS MEASURABLY WRONG (${defects.length}):\n${defectLines(defects)}`
      : 'NOTHING MEASURED WRONG: no label lands on ink or on another label, nothing runs off ' +
        'the canvas, no word is too long for its line. So the only things left are the ones a ' +
        'measurement cannot see — look at the picture and ask whether it draws what it was ' +
        'asked for. If it does, emit it back unchanged.',
  ].join('\n');

  const content: Message['content'] = png
    ? [
        imagePart(png),
        ...(opts.underlay ? [imagePart(opts.underlay.png)] : []),
        { type: 'text' as const, text: body },
      ]
    : body;
  const messages: Message[] = [{ role: 'user', content }];

  let raw: unknown;
  try {
    raw = await callTool(
      opts.client,
      opts.model,
      FIX_BRIEF,
      messages,
      opts.schema,
      { name: TOOL, description: 'Emit the complete corrected drawing as a list of marks.' },
      8000,
    );
  } catch (err) {
    log.warn(`could not revise "${short}"`, errorDetail(err));
    return undefined;
  }

  const parsed = RevisionSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn(`the revision did not validate: "${short}"`, errorDetail(parsed.error));
    return undefined;
  }

  const after = defectScore(auditDrawing(prepareMarks(parsed.data.elements, under), under));
  // **The score vetoes a regression; it does not adjudicate the drawing.** A revision is
  // kept unless it measures worse than what it replaced.
  //
  // The first version of this demanded a strictly better score, and the twelve-subject
  // sheet showed what that costs. The heart came back scoring exactly the same, so the
  // correction was thrown away — and the original, which is the one we then kept, has its
  // septum labelled inside the right ventricle and its blood-flow arrows sweeping diagonally
  // across every chamber. None of that is in the score, because none of it is arithmetic.
  // The model had looked at the render and this file had not, so a tie has to go to the
  // model. The knee, meanwhile, came back at 7 against 6 and is still rejected, which is
  // the case the veto exists for.
  const kept = after <= before;
  log.info(
    `revised "${short}": ${defectSummary(defects)} scored ${before} -> ${after}` +
      (kept ? ' (kept)' : ' (rejected, the original was better)'),
  );
  return { marks: kept ? parsed.data.elements : marks, before, after, kept };
}
