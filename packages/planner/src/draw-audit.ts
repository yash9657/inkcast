/**
 * What is measurably wrong with a drawing — the gate on the expensive half.
 *
 * ## Why measure at all, when the fix is a model call
 *
 * The literature is unanimous that the way to fix a composed drawing is to render it and
 * show it back to the model that composed it (`docs/research/drawing.md` §3: the paper's
 * ablation is that removing canvas feedback degrades geometry). It is also a second call
 * per picture, five to ten pictures per video. So the loop is gated: this file measures
 * what is wrong *without* a model, and only a drawing with something wrong pays.
 *
 * That makes this file the honest half of the feedback loop. It answers three questions
 * about the drawing that will actually reach the board, in the drawing's own units:
 *
 * 1. **Are two names written on top of each other?** Never intended, always unreadable.
 * 2. **Is a name written across the ink?** Not the ink it sits *inside* — a label in the
 *    middle of a heart outline is normal on a whiteboard — but ink it crosses, which is
 *    what `draw-geom.ts` exists to tell the difference between. Asked of a *traced*
 *    picture, never of a generated figure: see `underlayInk`, which is the `leader-misses`
 *    argument below applied to the check it was hiding in.
 * 3. **Will the board break a word in half?** The planner estimates text width and the
 *    renderer wraps again against the real handwriting metrics, so a word wider than its
 *    box comes out as `Cartil / age`. That is arithmetic, not judgement.
 * Plus three whole-drawing checks: ink that has run off the canvas, a label sitting far
 * enough from every mark that it names nothing, and — the one that is about the card rather
 * than about a mark — a drawing that will reach the frame as mostly paper (`thinCard`). That
 * last one is arithmetic for the same reason as the rest: under `wipe` the frame is fitted to
 * the ink, so what a card will cover is decided by the drawing's shape and how solidly its
 * marks fill it, and both are knowable before a pixel is drawn. See `cardFill`.
 *
 * ## What is deliberately not measured
 *
 * Tangled wavefronts, a crude knee joint, a picture that does not teach. Those are the
 * defects that remain in the frames and they are all judgement — a number that claimed to
 * catch them would be a number nobody could trust, and gating a fix on it would spend a
 * call on every drawing. Judgement is what the model is for; this is what arithmetic is
 * for. A defect here is a fact, and every one of them names coordinates so that the
 * sentence handed to the model is a fact too.
 *
 * **Whether a leader ends on the thing it names.** This was measured here for one session
 * as `leader-misses` and taken out again, and the reason is worth keeping because the
 * check reads as obviously correct until you measure what it can see. It compared the
 * arrow's tip to the underlay's *box*, and a box is not ink. On the traced lane a heart's
 * bounding box is mostly board, so a leader stopping on empty paper inside it scored as a
 * hit — the exact case the check was written for. On the figure lane it is worse and it is
 * structural: `figureBox()` is `{x:80,y:0,w:840,h:560}` on a 1000x560 canvas and there is
 * no trace behind it at all — a figure is never traced (`underlay.ts`) — so with the 60
 * units of slack the check allowed, only `x<20` and `x>980` could ever be reported. That
 * is 4% of the canvas, and it is narrower than the 80-unit margin the names themselves sit
 * in, so a leader that stops in the margin short of the picture reads as a hit too. Its
 * calibration — no false positives over the 62 leaders in the cached lessons — was run
 * against a 348-wide traced box, where 53% of the canvas was reportable; that is a lane
 * 2.4x narrower than `FIGURE_AREA` and the number never transferred. And the failure the
 * check cited as its reason, `underlay.ts`'s "if the picture then lands anywhere other than
 * where it was when the model looked, every leader arrow points at empty board", is not
 * visible from here in any case: this function is handed the same ink box the author was,
 * and `compile.ts`'s `buildUnderlay` places the picture through that box and through
 * `buildDrawing`'s own `Fit`, which is what makes the two line up. Bringing it back needs a
 * measurement of where the picture's ink actually is, and the lane that most needs it is
 * the one lane that has no trace to measure.
 */
import type { Lesson, LessonStep, Mark } from '@inkcast/core';
import { DRAW_H, DRAW_W } from '@inkcast/core';
import { prepareMarks } from './drawing.js';
import type { Box } from './elements.js';
import { handMeasure } from './elements.js';
import { readUnderlay } from './underlay.js';
import type { Underlay } from './draw-geom.js';
import {
  ADRIFT,
  LABEL_SIZE,
  OFF_CANVAS_SLACK,
  TYPICAL_FIT,
  cardFill,
  contentBounds,
  inkDistance,
  inkHitsBox,
  inkOf,
  labelBox,
  labelCap,
  labelFootprint,
  overlapArea,
  underlayInk,
} from './draw-geom.js';

/**
 * Bump when what counts as a defect changes: it is part of the correction's cache key.
 *
 * The audit is the *input* to a correction — the model is told these sentences and fixes
 * what they name — so a cached correction made under different rules is a correction to a
 * different question. It went to v2 when shaded regions stopped being obstacles, which is
 * the change that stopped `N` being moved out of its magnet. It went to v3 when labels
 * started being measured at the footprint the board draws them at (`labelFootprint`),
 * at the fit a beat is really laid out at rather than at unit scale (`TYPICAL_FIT`).
 * It went to v4 when `thin-card` was added: a correction made when a card covering a
 * seventh of the frame was not a defect is an answer to a question this file no longer asks.
 * It went to v5 when a figure stopped being ink (`underlayInk`) and the repair stopped
 * being allowed to push a name off the canvas (`OFF_CANVAS_SLACK`) — the first changes what
 * is reported and the second changes the marks that are audited, and a correction cached
 * under either is a correction to a drawing this file now measures differently. On the
 * figure lane it is the sharpest case the constant has had: those cached corrections are
 * answers to a list of ten defects that no longer exists.
 */
export const AUDIT_VERSION = 'audit/v5';

/** What kind of thing is wrong. Ordered by how much a viewer notices it. */
export type DefectKind =
  'label-on-label' | 'label-on-ink' | 'broken-word' | 'off-canvas' | 'label-adrift' | 'thin-card';

export type Defect = {
  kind: DefectKind;
  /** The marks involved, by their own part names. */
  ids: string[];
  /** One sentence, with coordinates, that a model can act on directly. */
  note: string;
};

/**
 * Clearance a label is allowed to keep from ink before it counts as landing on it.
 *
 * Small on purpose. The pen has width, roughjs doubles most strokes, and the label box is
 * an estimate — but a name tucked neatly against the part it labels is *good* drawing, so
 * a generous pad here would report every well-placed label as a defect.
 */
const INK_PAD = 4;

/** Two labels may share this many square units before it reads as a collision. */
const LABEL_SLOP = 60;

/**
 * The widest a label's line can be before the board wraps it, in drawing units.
 *
 * Mirrors the cap `drawing.ts` puts on a label's element: a word wider than this is a word
 * the renderer has nowhere to put, so it breaks the word itself.
 *
 * Unit scale, unlike everything else in this function, and not by inheritance — the same
 * "a drawing is authored once" argument that used to be written here is the one
 * `TYPICAL_FIT` rejects. The arithmetic is simply different for this check. It compares an
 * authoring-unit width against the board's cap divided back by the fit, and `labelCap`'s
 * 280 floor makes that quotient *smallest* at s=1: 420 authoring units at unit scale, 424
 * at `TYPICAL_FIT`, 560 at s=0.5. So unit scale is the strict end here, where for a label's
 * footprint it was the roomy one, and the failure mode this check has — a word silently
 * coming out as `Cartil / age` — is the one worth erring towards reporting.
 */
const WRAP_CAP = labelCap(1);

const round = (n: number): number => Math.round(n);
const at = (b: Box): string => `(${round(b.x + b.w / 2)},${round(b.y + b.h / 2)})`;

/**
 * Everything measurably wrong with these marks, worst first.
 *
 * Expects the marks that will actually be drawn — `prepareMarks` output, not raw author
 * output. Auditing raw marks would report collisions the free repair pass is about to fix
 * and then spend a model call on them.
 *
 * `scale` is the beat's fit, and it must be the same one the repair was given or the two
 * take turns undoing each other — the failure `draw-geom.ts`'s header exists to prevent.
 * Nothing in the drawing stage knows the cell (`planBoard` has not run), so the default is
 * `TYPICAL_FIT`, the middle of the range beats are really laid out at, and every caller
 * gets it without opting in. It was 1 for one session, which is the roomy end of that
 * range: measured against each beat's own fit, that read 10 of the 41 dirty beats in
 * `projects/` as clean — under-reporting, in a gate whose whole job is to notice.
 */
export function auditDrawing(marks: Mark[], underlay?: Underlay, scale = TYPICAL_FIT): Defect[] {
  const out: Defect[] = [];
  const labels = marks.filter((m) => m.kind === 'label');
  // The words' real footprint, not `labelBox`'s one unwrapped line. Measuring the wrong
  // box is how `cardiac8` shipped "spark starts here" typed through "atria (spark spreads
  // sideways)" with the audit reporting nothing — see `labelFootprint`.
  const boxes = new Map(labels.map((m) => [m.id, labelFootprint(m, scale)] as const));
  // The hybrid lane's generated picture is ink the audit has to know about, or a name
  // written across the middle of a traced heart measures perfectly clean. It is also what
  // stops `label-adrift` firing on the names this lane deliberately puts out at the sides:
  // they are near the picture, which is the thing they name. A *figure* is in this list
  // for the second reason and not the first — it is an unmeasured box, not ink. See
  // `underlayInk`, which is where the two lanes part.
  const ink = [...(underlay ? [underlayInk(underlay)] : []), ...inkOf(marks)];

  // 1. Labels on each other.
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i] as Mark;
      const b = labels[j] as Mark;
      const ba = boxes.get(a.id) as Box;
      const bb = boxes.get(b.id) as Box;
      const shared = overlapArea(ba, bb);
      if (shared <= LABEL_SLOP) continue;
      out.push({
        kind: 'label-on-label',
        ids: [a.id, b.id],
        note: `the labels "${a.text ?? a.id}" ${at(ba)} and "${b.text ?? b.id}" ${at(bb)} are written on top of each other — move them apart`,
      });
    }
  }

  // 2. Labels across ink. Reported once per label, naming what it crosses, because a
  //    label lying along an arrow crosses it in several places and that is one problem.
  for (const label of labels) {
    const box = boxes.get(label.id) as Box;
    const hit = ink.filter((k) => k.id !== label.id && inkHitsBox(k, box, INK_PAD));
    if (!hit.length) continue;
    out.push({
      kind: 'label-on-ink',
      ids: [label.id, ...hit.map((k) => k.id)],
      note: `the label "${label.text ?? label.id}" ${at(box)} is written across ${hit
        .map((k) => `${k.id} (${k.kind})`)
        .join(', ')} — move the words into empty space, or add a short arrow from them to the part`,
    });
  }

  // 3. Words the board will break in half. Measured with the real advance table —
  //    the check must measure what the renderer draws (plan item 2.1).
  for (const label of labels) {
    const size = label.size ?? LABEL_SIZE;
    const words = (label.text ?? '').split(/\s+/).filter(Boolean);
    const longest = words.reduce((m, w) => (handMeasure(w, 1) > handMeasure(m, 1) ? w : m), '');
    const width = handMeasure(longest, size);
    if (width <= WRAP_CAP) continue;
    // The cap height at which this word would just fit on one line, with 5% headroom.
    const fitsAt = Math.max(16, round((WRAP_CAP / handMeasure(longest, 1)) * 0.95));
    out.push({
      kind: 'broken-word',
      ids: [label.id],
      note: `"${longest}" is too long to fit one line at size ${round(size)} and the board will break the word in half — shorten it, or drop size to about ${fitsAt}`,
    });
  }

  // 4. Ink off the canvas. The drawing is fitted by its content, so this does not clip
  //    anything — it shrinks everything else to make room, which is how one stray mark
  //    turns a good drawing into a small one in the corner of a cell.
  const content = contentBounds(marks);
  if (content) {
    const slack = OFF_CANVAS_SLACK;
    const over: string[] = [];
    if (content.x < -slack) over.push(`${round(-content.x)} left of x=0`);
    if (content.y < -slack) over.push(`${round(-content.y)} above y=0`);
    if (content.x + content.w > DRAW_W + slack)
      over.push(`${round(content.x + content.w - DRAW_W)} past x=${DRAW_W}`);
    if (content.y + content.h > DRAW_H + slack)
      over.push(`${round(content.y + content.h - DRAW_H)} below y=${DRAW_H}`);
    if (over.length) {
      const outside = marks
        .filter((m) => {
          // `labelBox`, not `labelFootprint`, and deliberately: this list names the marks
          // responsible for the `contentBounds` overrun reported just above, and
          // `contentBounds` measures a label as `markBounds` does — one unwrapped line at
          // the author's own cap height. Measuring the culprits in the other space would
          // report a drawing as running off the canvas and then name no mark that does.
          const b = m.kind === 'label' ? labelBox(m) : undefined;
          const bb = b ?? contentBounds([m]);
          return (
            bb !== undefined &&
            (bb.x < -slack ||
              bb.y < -slack ||
              bb.x + bb.w > DRAW_W + slack ||
              bb.y + bb.h > DRAW_H + slack)
          );
        })
        .map((m) => m.id);
      out.push({
        kind: 'off-canvas',
        ids: outside,
        note: `the drawing runs ${over.join(' and ')} — the canvas is ${DRAW_W}x${DRAW_H} and everything has to be inside it; bring ${outside.join(', ') || 'it'} in`,
      });
    }
  }

  // 5. A label out on its own, naming nothing. Only when there is something to be near:
  //    a drawing that is all words has no mark for a name to be beside, and reporting
  //    every label as "Infinity units from the nearest mark" is a sentence no model can act
  //    on. `repairLabels` carries the same guard, for the same reason.
  for (const label of ink.length ? labels : []) {
    const box = boxes.get(label.id) as Box;
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const near = ink.reduce((m, k) => Math.min(m, inkDistance(k, centre)), Infinity);
    if (near <= ADRIFT) continue;
    out.push({
      kind: 'label-adrift',
      ids: [label.id],
      note: `the label "${label.text ?? label.id}" ${at(box)} is ${round(near)} units from the nearest mark, so it does not read as naming anything — move it beside the part it names, or draw an arrow from it to the part`,
    });
  }

  // 6. A card that will reach the frame as mostly paper. Last, because it is the one
  //    defect here about the drawing as a whole rather than about a mark, and a model
  //    given a list fixes the top of it first.
  const thin = thinCard(marks, underlay, scale);
  if (thin) out.push(thin);

  const rank: Record<DefectKind, number> = {
    'label-on-label': 0,
    'label-on-ink': 1,
    'broken-word': 2,
    'off-canvas': 3,
    'label-adrift': 4,
    'thin-card': 5,
  };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/**
 * The share of the frame below which a card reads as an empty board with marks on it.
 *
 * Not a fresh opinion: `reportFill` in `core/src/camera.ts` already calls a film whose mean
 * content fill is under 25% "mostly whitespace", and counts a scene under 14% as empty. This
 * sits between them, and it is the per-card statement of the same standard.
 *
 * Calibrated on the 217 drawings in the machine cache (2026-08-26): predicted fill runs p25
 * 17%, p50 27%, p75 38%, so this reports 79 of them — a third, which is the same order as
 * the label defects the audit already reports and well short of a check that fires on
 * everything. The good end of that corpus reaches 50–67%, which is what says the lane can
 * draw a full card when it draws one; the acceptance film's five blank-board beats came in
 * at 10–17% and all five are reported.
 */
const THIN_CARD = 0.22;

/**
 * The fewest marks a drawing must have before its fill is worth a sentence.
 *
 * A two-mark drawing is a stub or a fixture, not a card, and "your three marks cover a fifth
 * of their box" is a sentence about the beat rather than about the drawing — the brief's own
 * answer to it is that under eight marks is too crude to teach at all. Every real drawing in
 * the cache is above this; every fixture in `draw-audit.test.ts` is below it.
 */
const CARD_MARKS = 5;

/**
 * What the two factors reach on a card that does fill its frame, so the note can name the
 * one that is short. From the same 217-drawing corpus: `cover` runs a median of 44% and an
 * upper quartile of 62%, and the drawings that predict 50–67% of the frame are the ones
 * above a half. `GOOD_SHAPE` is a span within a third of the board's own proportions —
 * 1.2:1 to 2.4:1 — which is as far as a drawing can wander from 16:9 and still be framed
 * without a quarter of the shot going to paper.
 */
const GOOD_COVER = 0.5;
const GOOD_SHAPE = 0.75;

/**
 * The card that will reach the frame as mostly paper, and which of its two factors is thin.
 *
 * Reported as one defect and not two, for the reason `whyThin` gives on the board's own
 * version of this number: fill is a product, and naming the smaller factor is the difference
 * between "draw the parts bigger", which is a fix, and "fill the frame", which is a wish.
 *
 * **Not reported on a drawing composed over a picture.** `FIGURE_BRIEF` asks that lane for
 * names and the leaders that reach them and for nothing else, so its marks are *meant* to be
 * a tenth of the card; the picture underneath is what fills it, and it is not measurable from
 * here. Reporting those would spend a correction call asking a model to undo its own brief.
 */
function thinCard(
  marks: Mark[],
  underlay: Underlay | undefined,
  scale: number,
): Defect | undefined {
  if (underlay || marks.length < CARD_MARKS) return undefined;
  const card = cardFill(marks, scale);
  if (!card || card.fill >= THIN_CARD) return undefined;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const span = `${round(card.span.w)}x${round(card.span.h)}`;
  const head =
    `this card will carry about ${pct(card.fill)} of the frame: the marks cover ${pct(card.cover)} ` +
    `of the ${span} box they span, and a ${span} box holds ${pct(card.shape)} of a ${DRAW_W}x${DRAW_H} board`;
  // Which factor to name, and it cannot be decided by comparing them: they are shares of
  // different things. A card of the board's own shape scores 1 where a good `cover` is about
  // a half — the cache's median is 44% and its upper quartile 62% — so each is measured
  // against what a card that fills its frame actually reaches, and when both fall short the
  // note says both, because fixing either one alone would leave this card thin.
  const thinCover = card.cover < GOOD_COVER;
  const wrongShape = card.shape < GOOD_SHAPE;
  const grow =
    `draw every part bigger where it stands until the ink fills the space between the parts — ` +
    `scaling the whole drawing up changes nothing, because the board fits it to the card either way`;
  const spread =
    `use the whole ${DRAW_W}x${DRAW_H} canvas, so the drawing comes out the shape of the board ` +
    `rather than a ${card.span.w > card.span.h * 2 ? 'strip across it' : 'block in the middle of it'}`;
  const advice = thinCover && wrongShape ? `${grow}; and ${spread}` : wrongShape ? spread : grow;
  return {
    kind: 'thin-card',
    ids: marks.map((m) => m.id).slice(0, 4),
    note: `${head} — ${advice}`,
  };
}

/**
 * A single number for "how wrong is this drawing", so a revision can be compared.
 *
 * Weighted by how badly a viewer is served, not by how easy it is to fix, and used for
 * exactly one decision: keep the revision only if it scores lower. A model asked to fix
 * two labels will sometimes redraw a third thing worse, and without a comparison there is
 * no way to notice.
 */
export function defectScore(defects: Defect[]): number {
  const weight: Record<DefectKind, number> = {
    'label-on-label': 5,
    'label-on-ink': 4,
    'broken-word': 3,
    'off-canvas': 2,
    // Deliberately light, and it is the veto in `draw-critic.ts` that decides how light.
    // A revision that fills the card and writes one name across an arrow must lose, because
    // an unreadable name is worse than an airy board; a revision that fixes the name and
    // leaves the card as thin as it found it must win. At 2 against `label-on-ink`'s 4 both
    // of those fall out of the arithmetic.
    'thin-card': 2,
    'label-adrift': 1,
  };
  return defects.reduce((n, d) => n + weight[d.kind], 0);
}

/** The defect list as the lines handed to the model. */
export function defectLines(defects: Defect[]): string {
  return defects.map((d, i) => `${i + 1}. ${d.note}`).join('\n');
}

/**
 * Every drawing in a finished lesson that still has something measurably wrong
 * with it, one line each (plan item 3.4; audit X-e).
 *
 * Derived from `lesson.json` rather than remembered from the run that made it, and
 * that is the whole point. The drawing lane's own tally — "9/9 drawings composed, 2
 * still measurably imperfect" — is a log line inside a keyed run, and the runs that
 * follow serve the lesson from cache, never call the lane, and print nothing at all.
 * So a project's pictures were known to be flawed exactly once, on the day they were
 * drawn. The marks are on disk; the audit is arithmetic; recomputing it is free.
 *
 * The *kept-or-rejected* half of the critic's decision cannot be recovered this way
 * and does not need to be: what survives in the film is the standing defect, and that
 * is what this reports. A correction that fixed everything leaves nothing here, which
 * is the correct record of it having worked.
 */
/** Required generated pictures that never acquired geometry. Characters use a local rig. */
export function missingLessonDrawings(lesson: Lesson): string[] {
  const steps = [
    lesson.hook,
    lesson.anchor,
    ...lesson.steps,
    lesson.worked,
    lesson.misconception,
    lesson.recap,
  ];
  return steps.flatMap((step) =>
    (step?.visuals ?? [])
      .filter((intent) => intent.kind === 'draw' && !intent.character && !intent.marks?.length)
      .map((intent) => `Missing drawing: ${intent.describe.slice(0, 160)}`),
  );
}

export function lessonDrawingDefects(lesson: Lesson): string[] {
  const steps: LessonStep[] = [
    lesson.hook,
    lesson.anchor,
    ...lesson.steps,
    lesson.worked,
    lesson.misconception,
    lesson.recap,
  ].filter(Boolean) as LessonStep[];
  const out: string[] = [];
  for (const step of steps) {
    for (const intent of step.visuals) {
      if (intent.kind !== 'draw' || !intent.marks?.length) continue;
      const under = readUnderlay(intent.underlay);
      const defects = auditDrawing(prepareMarks(intent.marks, under), under);
      if (!defects.length) continue;
      out.push(
        `the drawing "${intent.describe.slice(0, 60)}" has ${defects.length} standing ` +
          `defect${defects.length === 1 ? '' : 's'} (${defectSummary(defects)}): ` +
          defects.map((d) => d.note).join(' · '),
      );
    }
  }
  return out;
}

/** A one-line count per kind, for logs and for the breadth sheet. */
export function defectSummary(defects: Defect[]): string {
  if (!defects.length) return 'clean';
  const counts = new Map<DefectKind, number>();
  for (const d of defects) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k}×${n}`).join(' ');
}
