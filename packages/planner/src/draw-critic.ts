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
 * of the lane to improve the drawings that were already fine. One defect is deliberately
 * **not** allowed through that gate — a thin card, which a third of the corpus has and
 * which the first eight measured attempts made worse rather than better; see the note at
 * the top of `reviseDrawing`.
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
import type { Mark, OnProblem, OnSpend } from '@inkcast/core';
import {
  DRAW_H,
  DRAW_W,
  Mark as MarkSchema,
  hash,
  logger,
  noteProblem,
  noteSpend,
} from '@inkcast/core';
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
import { geometryConstraintProblems } from './geometry-constraints.js';
import { labelTargetProblems } from './label-anchors.js';
import type { Box } from './elements.js';
import type { DrawPreview } from './types.js';
import { isTraced } from './underlay.js';

const log = logger('planner:drawing:critic');

/**
 * Bump when `FIX_BRIEF` changes: it names the revision's own cache entry.
 *
 * The same discipline as the author's brief being inside its cache key. A cached revision
 * that survived a change to the instructions behind it would serve corrections made for
 * rules that no longer exist — the subtlest possible way to make a fix look like it did
 * nothing.
 */
export const FIX_VERSION = 'fix/v2';

const TOOL = 'emit_drawing';

const FIX_BRIEF = `YOU ARE LOOKING AT YOUR OWN DRAWING, rendered on the board exactly as the viewer will see it: the same pen, the same handwriting, the same wobble. This is the only chance to see it before it is drawn for real.

Below the picture are the marks that produced it, and a list of the things that are measurably wrong with it. Every item in that list is a fact — it was measured on the geometry, not judged — so each one is worth fixing.

HOW TO FIX IT
- FIX WHAT THE LIST NAMES, and look at the picture for anything else that is plainly wrong: a name that reads as belonging to the wrong part, ink that crosses ink and should not, a shape that came out unrecognisable.
- CHANGE AS LITTLE AS POSSIBLE. Keep every id. Keep every part. Keep the coordinates of everything you are not fixing, exactly. This is a correction, not a second attempt: the drawing was good enough to be worth repairing.
- PRESERVE SEMANTICS. Keep every cue, target and circleThrough unchanged. They bind a mark to the spoken words and geometric referent. Moving a label must not change when it appears or what it names.
- MOVE THE WORDS, NOT THE PICTURE. A label in the wrong place is almost always fixed by moving the label into nearby empty space — and if the part is small or crowded, by adding a short arrow from the words to the part. Redrawing the structure to make room for a name is the wrong trade.
- A NAME HAS TO STAY WITH WHAT IT NAMES. Moving it a little is a fix; moving it somewhere it now sits beside a different part is worse than the problem it solved, and moving it off the picture altogether is worst of all. If the only clear space is far away, leave the words near their part and draw an arrow instead.
- IF THE LIST SAYS THE CARD IS THIN, that is the one item where the answer is to change the picture, and it is the one thing "change as little as possible" does not cover. Grow the parts where they stand — every shape bigger, until the ink fills the space between the parts — and keep every id, every part and every relation. Scaling the whole drawing up is not a fix and changes nothing: the board fits your drawing to the card either way, so what counts is the size of the parts against the gaps between them. Do not add parts to fill space, and never stretch: a stretched drawing of anything looks wrong in a way a viewer cannot name but can always see.
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
  return hash(FIX_VERSION, AUDIT_VERSION, FIX_BRIEF).slice(0, 16);
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
   *
   * `kind` was missing from this type until 2026-08-27 while `drawOne` was passing it
   * through all along, so the critic audited a figure as though it were a traced form —
   * which is how it came to be told, on the acceptance film, to move ten names out of the
   * only place `FIGURE_BRIEF` says they can go. See `underlayInk`.
   */
  underlay?: { png: Uint8Array; box: Box; kind?: 'form' | 'figure' };
  /**
   * Look at the drawing even when nothing was measured wrong (`INKCAST_DRAW_FIX=all`).
   * The gate is arithmetic and geometry is not arithmetic — see `revisesEverything`.
   */
  always?: boolean;
  /**
   * Where an outcome that is not "corrected and kept" is recorded (plan item 3.4).
   *
   * Three of this function's four exits leave the board with a picture the pass was
   * meant to fix and did not: no preview to look at, a call that failed, a revision
   * that measured worse than the original. All three were `log.warn` at best, inside a
   * keyed run nobody re-reads, and the film shipped with the defect. Routed here they
   * reach `qc.json`. See `OnProblem` in `@inkcast/core`.
   */
  onProblem?: OnProblem;
  /** Where this call's tokens are recorded, as the `drawing-fix` lane (plan 3.5). */
  onSpend?: OnSpend;
};

/**
 * One correction pass over a drawing that has something measurably wrong with it.
 *
 * Returns `undefined` when there was nothing to fix, when the call could not be made, or
 * when no preview could be rendered — all of which mean "use what you already have". The
 * last case is deliberate: the whole argument for this pass is that the model can *see*
 * what it drew, so with no render the correction is skipped loudly rather than attempted
 * blind (audit S9-c). Never throws.
 */
export async function reviseDrawing(
  marks: Mark[],
  opts: CriticOptions,
): Promise<Revision | undefined> {
  // The marks that will actually be drawn, not the ones the author placed: the free
  // repair pass has already moved what it could, and a correction call spent on a defect
  // that no longer exists is a call spent on nothing.
  const under = opts.underlay && { box: opts.underlay.box, traced: isTraced(opts.underlay.kind) };
  const shown = prepareMarks(marks, under);
  const defects = auditDrawing(shown, under);
  // **A thin card is told, never bought.** It rides along on a call some other defect has
  // already paid for — the list handed to the model includes it, and the veto below lets a
  // fuller card through — but it does not open the gate on its own, and that is a measured
  // decision rather than a cautious one. The first run under `thin-card` (2026-08-26, eight
  // subjects through `drawsheet.mts`) bought two calls that nothing else would have: the knee
  // joint came back at 8 against 2 and the neuron at 4 against 2, both rejected, both paid
  // for. Nothing was improved by a call this check created. If a later `FIX_BRIEF` earns
  // those calls, the way to find out is `INKCAST_DRAW_FIX=all` on the sheet, not a gate that
  // spends on every third drawing in the corpus.
  const buys = defects.filter((d) => d.kind !== 'thin-card');
  if (!buys.length && !opts.always) return undefined;

  const before = defectScore(defects);
  const short = opts.instruction.slice(0, 60);
  // Rendered in the same coordinate space as the underlay when there is one, so the two
  // pictures the model is shown can be read against each other rather than guessed at.
  const png = opts.preview
    ? await opts.preview(shown, under ? { underlay: true } : {}).catch(() => undefined)
    : undefined;
  if (!png) {
    // Skip rather than revise blind. The whole argument for this pass is that the
    // model can see what it drew; without the render it would be fixing coordinates
    // from a list, which is weaker and is not what the literature measured — and at
    // debug level the degradation was nearly invisible (audit S9-c, X-e). The
    // measured defects are named here so the skip is a recorded fact, not a silence;
    // Phase 3's qc.json will carry them per project.
    if (defects.length) {
      const note =
        `drawing "${short}" has ${defects.length} measured defect(s) but no preview could ` +
        `be rendered — skipping the correction rather than revising blind. ` +
        `Standing: ${defectSummary(defects)}`;
      log.warn(note);
      noteProblem(opts, note);
    } else {
      log.debug(`no preview for "${short}" and nothing measured wrong — skipping the look`);
    }
    return undefined;
  }

  const body = [
    `THE DRAWING WAS ASKED TO BE: ${opts.instruction}`,
    'The picture above is that drawing, rendered.',
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

  // A render always exists past the gate above, so the model is always shown one.
  const content: Message['content'] = [
    imagePart(png),
    ...(opts.underlay ? [imagePart(opts.underlay.png)] : []),
    { type: 'text' as const, text: body },
  ];
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
      opts.onSpend
        ? (u) =>
            noteSpend(opts, {
              lane: 'drawing-fix',
              provider: opts.client.provider ?? 'anthropic',
              ...u,
            })
        : undefined,
    );
  } catch (err) {
    log.warn(`could not revise "${short}"`, errorDetail(err));
    noteProblem(
      opts,
      `the correction call for drawing "${short}" failed, so it keeps its ` +
        `${defects.length} measured defect(s): ${defectSummary(defects)}`,
    );
    return undefined;
  }

  const parsed = RevisionSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn(`the revision did not validate: "${short}"`, errorDetail(parsed.error));
    noteProblem(
      opts,
      `the correction for drawing "${short}" did not validate, so it keeps its ` +
        `${defects.length} measured defect(s): ${defectSummary(defects)}`,
    );
    return undefined;
  }

  const revised = preserveMarkBindings(marks, parsed.data.elements);
  const bindingProblems = [...geometryConstraintProblems(revised), ...labelTargetProblems(revised)];
  if (bindingProblems.length) {
    noteProblem(opts, `Drawing correction broke semantic bindings: ${bindingProblems.join('; ')}`);
    return undefined;
  }
  const after = defectScore(auditDrawing(prepareMarks(revised, under), under));
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
  // Only the rejection is recorded, and deliberately: a kept correction is the lane
  // working, and whatever it *failed* to fix is still measurable in the marks on disk
  // — `lessonDrawingDefects` recomputes that from `lesson.json` on every run, so the
  // standing defect is reported whether or not this call happened. What cannot be
  // recovered later is that a model looked at this picture, drew it again, and made it
  // worse; that is a fact about the lane rather than about the film, and it is the one
  // that has to be said now or never.
  if (!kept) {
    noteProblem(
      opts,
      `the correction for drawing "${short}" was rejected — it measured ${after} against ` +
        `the original's ${before}, so the original ships with ${defectSummary(defects)}`,
    );
  }
  return { marks: kept ? revised : marks, before, after, kept };
}

/** A visual layout revision cannot silently erase narration or geometry bindings. */
export function preserveMarkBindings(original: readonly Mark[], revised: readonly Mark[]): Mark[] {
  const byId = new Map(original.map((m) => [m.id, m]));
  return revised.map((m) => {
    const before = byId.get(m.id);
    if (!before) return m;
    return {
      ...m,
      ...(before.cue ? { cue: before.cue } : {}),
      ...(before.target ? { target: before.target } : {}),
      ...(before.circleThrough ? { circleThrough: before.circleThrough } : {}),
    };
  });
}
