/**
 * From "what the learner should see" to a real plot.
 *
 * This is the craft of the lesson compiler. A `VisualIntent` says things like
 * "a bowl-shaped loss curve with a tangent at the ball, sloping up to the right";
 * this module turns that into a `PlotElement` with a sensible domain, the right
 * named function, and overlays that serve the specific idea — a tangent where
 * slope is being explained, real descent steps where descent is being shown, a
 * second shallower well where local minima are, three panels where the learning
 * rate is.
 *
 * Two rules keep it honest:
 *
 * 1. **Numbers in the intent become the numbers on the board.** "w = 3, slope
 *    = +4, lr = 0.1" derives a parabola whose slope at w really is +4, and the
 *    drawn steps are produced by running gradient descent on that curve. If the
 *    narration says the next value is 2.6, the ball lands on 2.6 because the
 *    arithmetic says so, not because someone drew it there.
 * 2. **No recipe is generic.** A miss falls back to a labelled bowl, which is
 *    still a real plot with real axes — never a caption in a rectangle.
 */
import type { Curve, Element, PlotElement, PlotOverlay, VisualIntent } from '@inkcast/core';
import { curveY, dataToCanvas, descend, fitYDomain, round, slopeAt, stepPath } from './curves.js';
import type { Box, Point } from './elements.js';
import { makeArrow } from './elements.js';
import { ballPath, chevronPath } from './figures.js';

/* ----------------------------------------------------------- numeric hints */

export type PlotHints = {
  /** Starting parameter value: "w = 3", "start at 1.7". */
  start?: number;
  /** Slope stated at the starting point: "slope = +4". */
  slope?: number;
  /** Learning rate / step size: "lr = 0.1", "learning rate of 0.05". */
  lr?: number;
  /** Where the minimum sits, if the intent says so. */
  min?: number;
  /** The value after one update, used to sanity-check the drawn step. */
  next?: number;
  /** How many steps to draw. */
  steps?: number;
  numbers: number[];
};

const NUM = String.raw`([+-]?\d+(?:\.\d+)?)`;

function firstNumber(text: string, patterns: RegExp[]): number | undefined {
  for (const re of patterns) {
    const m = text.match(re);
    const raw = m?.[1];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Pull the teaching numbers out of a drawing instruction (and its narration). */
export function plotHints(...texts: string[]): PlotHints {
  const text = texts.filter(Boolean).join(' ');
  const numbers = [...text.matchAll(new RegExp(NUM, 'g'))]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
  const hints: PlotHints = { numbers };
  const start = firstNumber(text, [
    new RegExp(String.raw`\bw\s*(?:=|is|of)\s*${NUM}`, 'i'),
    new RegExp(String.raw`\bx\s*(?:=|is|of)\s*${NUM}`, 'i'),
    new RegExp(String.raw`\bstart(?:s|ing)?\s*(?:at|from|on)?\s*(?:w\s*=\s*)?${NUM}`, 'i'),
    new RegExp(String.raw`\bball\s+(?:at|on)\s*${NUM}`, 'i'),
  ]);
  const slope = firstNumber(text, [
    new RegExp(String.raw`\bslope\s*(?:=|is|of)\s*${NUM}`, 'i'),
    new RegExp(String.raw`\bgradient\s*(?:=|is|of)\s*${NUM}`, 'i'),
  ]);
  const lr = firstNumber(text, [
    new RegExp(String.raw`\b(?:lr|learning[- ]rate|step size|rate)\s*(?:=|is|of)?\s*${NUM}`, 'i'),
  ]);
  const min = firstNumber(text, [
    new RegExp(String.raw`\bminimum\s*(?:at|=|is)\s*${NUM}`, 'i'),
    new RegExp(String.raw`\bbottom\s*(?:at|=|is)\s*${NUM}`, 'i'),
  ]);
  const next = firstNumber(text, [
    new RegExp(String.raw`\b(?:becomes|gives|lands on|to)\s*${NUM}`, 'i'),
  ]);
  const steps = firstNumber(text, [new RegExp(String.raw`${NUM}\s*steps\b`, 'i')]);
  if (start !== undefined) hints.start = start;
  if (slope !== undefined) hints.slope = slope;
  if (lr !== undefined && lr > 0 && lr < 10) hints.lr = lr;
  if (min !== undefined) hints.min = min;
  if (next !== undefined) hints.next = next;
  if (steps !== undefined && steps >= 2 && steps <= 12) hints.steps = Math.round(steps);
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  if (hints.steps === undefined) {
    for (const [word, n] of Object.entries(words)) {
      if (new RegExp(`\\b${word}\\s+steps?\\b`, 'i').test(text)) {
        hints.steps = n;
        break;
      }
    }
  }
  return hints;
}

/**
 * A bowl consistent with the stated numbers.
 *
 * With `w` and `slope` both given, the vertex is placed so that the coefficient
 * is exactly 1 — the drawn curve is then `(w − h)²`, its slope is `2(w − h)`, and
 * a learner can verify the number the narrator says out loud against the picture.
 * That verifiability is the whole reason to derive the curve instead of picking a
 * pretty one.
 */
export function deriveBowl(hints: PlotHints): {
  curve: Curve;
  xDomain: [number, number];
  focus: number;
  a: number;
  h: number;
} {
  const start = hints.start ?? 3;
  const h =
    hints.min ??
    (hints.slope !== undefined && hints.slope !== 0 ? round(start - hints.slope / 2, 4) : 1);
  const denom = 2 * (start - h);
  const a = hints.slope !== undefined && Math.abs(denom) > 1e-6 ? round(hints.slope / denom, 4) : 1;
  const reach = Math.max(2.4, Math.abs(start - h) * 1.55);
  return {
    curve: {
      id: 'loss',
      label: 'loss',
      fn: { name: 'parabola', params: [a === 0 ? 1 : a, h, 0] },
      dashed: false,
      accent: 0,
    },
    xDomain: [round(h - reach, 3), round(h + reach, 3)],
    focus: start,
    a: a === 0 ? 1 : a,
    h,
  };
}

/* --------------------------------------------------------------- primitives */

type PlotInit = {
  xDomain: [number, number];
  yDomain?: [number, number];
  xLabel?: string;
  yLabel?: string;
  curves: Curve[];
  overlays?: PlotOverlay[];
  axes?: PlotElement['axes'];
  grid?: boolean;
  ticks?: boolean;
  floorAtZero?: boolean;
};

export function makePlot(id: string, box: Box, o: PlotInit): PlotElement {
  const yDomain =
    o.yDomain ?? fitYDomain(o.curves, o.xDomain, { floorAtZero: o.floorAtZero ?? true });
  const plot: PlotElement = {
    id,
    type: 'plot',
    at: { x: round(box.x, 2), y: round(box.y, 2), w: round(box.w, 2), h: round(box.h, 2) },
    // A plot is what the beat is *about*, so it goes up almost immediately and the
    // overlays land on the words. Waiting until the middle of the beat to draw the
    // axes leaves the learner listening to an explanation of nothing.
    enter: { at: 0.08, duration: 1.1, style: 'draw' },
    persist: true,
    xDomain: [round(o.xDomain[0], 3), round(o.xDomain[1], 3)],
    yDomain: [round(yDomain[0], 3), round(yDomain[1], 3)],
    axes: o.axes ?? 'both',
    grid: o.grid ?? false,
    ticks: o.ticks ?? false,
    curves: o.curves,
    overlays: o.overlays ?? [],
  };
  if (o.xLabel) plot.xLabel = o.xLabel;
  if (o.yLabel) plot.yLabel = o.yLabel;
  return plot;
}

const point = (curveId: string, x: number, label?: string, at = 0.4): PlotOverlay =>
  label === undefined
    ? { kind: 'point', curveId, x: round(x, 4), at }
    : { kind: 'point', curveId, x: round(x, 4), label, at };

const tangent = (
  curveId: string,
  x: number,
  span: number,
  label?: string,
  at = 0.55,
): PlotOverlay =>
  label === undefined
    ? { kind: 'tangent', curveId, x: round(x, 4), span: round(span, 3), at }
    : { kind: 'tangent', curveId, x: round(x, 4), span: round(span, 3), label, at };

const dropline = (curveId: string, x: number, to: 'x' | 'y' | 'both', at = 0.5): PlotOverlay => ({
  kind: 'dropline',
  curveId,
  x: round(x, 4),
  to,
  at,
});

const annotate = (
  x: number,
  y: number,
  text: string,
  at = 0.6,
  leaderTo?: { x: number; y: number },
): PlotOverlay =>
  leaderTo === undefined
    ? { kind: 'annotate', x: round(x, 4), y: round(y, 4), text, at }
    : { kind: 'annotate', x: round(x, 4), y: round(y, 4), text, at, leaderTo };

/**
 * A stepping sequence, or nothing at all.
 *
 * The IR requires at least two x values, because one point is not a step. A
 * descent that converged immediately (or a learning rate of zero) legitimately
 * produces a single value, so this returns `undefined` rather than emitting an
 * overlay that would fail validation.
 */
const stepsOverlay = (
  curveId: string,
  xs: number[],
  label?: string,
  at = 0.5,
): PlotOverlay | undefined => {
  if (xs.length < 2) return undefined;
  const rounded = xs.map((x) => round(x, 4));
  return label === undefined
    ? { kind: 'steps', curveId, xs: rounded, at }
    : { kind: 'steps', curveId, xs: rounded, label, at };
};

/** Drop the overlays that turned out to be undefined, keeping the order. */
const overlays = (...items: (PlotOverlay | undefined)[]): PlotOverlay[] =>
  items.filter((o): o is PlotOverlay => o !== undefined);

/** Attach a motion only when there is a real path to follow. */
function moveAlong(
  el: Element,
  path: Point[],
  from: number,
  to: number,
  easing: NonNullable<Element['motion']>['easing'] = 'ease-out',
): void {
  const unique = path.filter(
    (p, i) => i === 0 || Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y) > 0.5,
  );
  if (unique.length < 2) return;
  el.motion = { path: unique, from, to, easing, trail: true };
}

/* ------------------------------------------------------------- axis labels */

/**
 * An axis-label rule: match, label, and an optional veto that disqualifies the
 * match when the word is being used in a sense that is not an axis.
 */
type AxisRule = [RegExp, string, RegExp?];

const Y_WORDS: AxisRule[] = [
  [/\bloss\b/i, 'loss'],
  [/\berror\b/i, 'error'],
  [/\bcost\b/i, 'cost'],
  [/\bhow wrong\b/i, 'how wrong we are'],
  [/\bprobability\b/i, 'probability'],
  [/\bprice\b/i, 'price'],
  [/\bmoney|balance|value\b/i, 'value'],
  [/\bheight|altitude|elevation\b/i, 'height'],
  [/\b(?:count|frequency|how many)\b/i, 'how many'],
  // "rate" is a trap. Loose alternation (`\bspeed|rate\b`) plus the fact that a
  // gradient-descent beat says "learning rate 0.1" made this rule label the loss
  // axis of the benchmark's worked example "rate" — a hyperparameter printed where
  // the quantity being minimised belongs, which quietly unteaches the beat.
  // A rate is only a vertical axis when it is the thing being plotted, so the
  // step-size senses are excluded by name.
  [/\b(?:speed|rate)\b/i, 'rate', /\b(?:learning|step|lr|decay|sampl)\w*[- ]rate|\blr\b/i],
];

const X_WORDS: AxisRule[] = [
  // The learner's own words for the axis beat the notation every time: an axis
  // labelled "where you stand" is still the anchor, an axis labelled "w" is not.
  [/\bwhere you (?:stand|are)\b/i, 'where you stand'],
  [/\bhow far (?:along|across)\b/i, 'how far along'],
  [/\bparameter\b/i, 'parameter'],
  [/\bweight\b|\bw\b/i, 'w'],
  [/\btime\b|\bepoch|\bstep count/i, 'time'],
  [/\btemperature\b/i, 'temperature'],
  [/\bquantity|amount\b/i, 'quantity'],
  [/\binput\b/i, 'input'],
  [/\bmodel (?:size|capacity)|complexity\b/i, 'model complexity'],
  [/\bdistance\b/i, 'distance'],
];

function pick(text: string, table: AxisRule[], fallback?: string): string | undefined {
  for (const [re, label, veto] of table) {
    if (!re.test(text)) continue;
    if (veto && veto.test(text)) continue;
    return label;
  }
  return fallback;
}

export function axisLabels(
  text: string,
  fallback: { x?: string; y?: string } = {},
): {
  x?: string;
  y?: string;
} {
  const out: { x?: string; y?: string } = {};
  const x = pick(text, X_WORDS, fallback.x);
  const y = pick(text, Y_WORDS, fallback.y);
  if (x) out.x = x;
  if (y) out.y = y;
  return out;
}

/* ------------------------------------------------------------------ recipes */

export type PlotContext = {
  /** Stable id prefix, unique within the storyboard. */
  id: string;
  /** Canvas box the drawing must fill. */
  box: Box;
  /** The beat's narration, mined for numbers the intent left out. */
  narration: string;
  /** Vertical output wants one idea per picture and bigger ink. */
  vertical?: boolean;
};

type Recipe = {
  name: string;
  match: RegExp;
  build(ctx: PlotContext, hints: PlotHints, text: string): Element[];
};

const columns = (box: Box, n: number, gap = 34): Box[] => {
  const w = (box.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({
    x: round(box.x + i * (w + gap), 2),
    y: box.y,
    w: round(w, 2),
    h: box.h,
  }));
};

/** Three learning rates, side by side, each one an honest descent run. */
const learningRates: Recipe = {
  name: 'learning-rates',
  match:
    /three (?:plots|panels|curves|graphs)|too (?:small|large|big)|learning rate.{0,24}(?:compar|side by side|three)|crawls|diverges/i,
  build(ctx, hints, text) {
    const bowl = deriveBowl({ ...hints, start: hints.start ?? 2.4 });
    const names = ['too small', 'too large', 'about right'];
    // Convergence of w ← w − lr·2a(w − h) is governed by |1 − 2·lr·a|: below one
    // it converges, above one it diverges. These three rates are chosen so the
    // drawn staircases really do crawl, really do fly apart, and really do land.
    const rates = [0.04 / bowl.a, 1.18 / bowl.a, 0.35 / bowl.a];
    const yDomain = fitYDomain([bowl.curve], bowl.xDomain, { floorAtZero: true });
    const labelY = yDomain[1] * 0.88;
    const axis = axisLabels(text, { x: 'w', y: 'loss' });
    return columns(ctx.box, 3).map((box, i) => {
      // No `label` on the curve: the annotation below already names this panel, and
      // carrying both wrote "too small" twice per panel in the benchmark render —
      // once beside the trace, once above the bowl. A learner reading a board with
      // every caption doubled assumes the two say different things and hunts for a
      // difference that is not there.
      const { label: _unused, ...bare } = bowl.curve;
      const curve: Curve = { ...bare, id: 'loss', accent: i };
      const xs = descend(curve, bowl.focus, rates[i]!, i === 0 ? 6 : 5, bowl.xDomain);
      const enter = 0.22 + i * 0.2;
      return makePlot(`${ctx.id}_${i}`, box, {
        xDomain: bowl.xDomain,
        yDomain,
        curves: [curve],
        ...(i === 0 ? { xLabel: axis.x, yLabel: axis.y } : {}),
        overlays: overlays(
          annotate(bowl.h, labelY, names[i]!, enter),
          stepsOverlay('loss', xs, undefined, enter + 0.06),
        ),
      });
    });
  },
};

/** Two wells of different depths: descent finds *a* minimum, not *the* minimum. */
const localMinima: Recipe = {
  name: 'local-minima',
  match:
    /local (?:minim|optim)|second (?:valley|well|dip)|two (?:valleys|wells|minima|dips)|wrong (?:valley|minimum)|global minim/i,
  build(ctx, hints, text) {
    // Tilted quartic: the left well is deeper, so the right one is the trap.
    const curve: Curve = {
      id: 'loss',
      label: 'loss',
      fn: { name: 'doubleWell', params: [1, 2, 0.55, 2.2] },
      dashed: false,
      accent: 0,
    };
    const xDomain: [number, number] = [-1.75, 1.75];
    const start = hints.start ?? 1.55;
    const lr = hints.lr ?? 0.06;
    const xs = descend(curve, start, lr, hints.steps ?? 6, xDomain);
    const trap = xs[xs.length - 1] ?? 0.9;
    const deeper = -1.1;
    const axis = axisLabels(text, { x: 'w', y: 'loss' });
    const plot = makePlot(ctx.id, ctx.box, {
      xDomain,
      curves: [curve],
      xLabel: axis.x,
      yLabel: axis.y,
      floorAtZero: false,
      overlays: overlays(
        stepsOverlay('loss', xs, undefined, 0.34),
        point('loss', trap, 'it stops here', 0.58),
        point('loss', deeper, 'deeper — never found', 0.74),
        dropline('loss', deeper, 'y', 0.8),
      ),
    });
    const from = dataToCanvas(plot, { x: trap, y: curveY(curve, trap) ?? 0 });
    const ball = ballPath(
      `${ctx.id}_ball`,
      dataToCanvas(plot, { x: start, y: curveY(curve, start) ?? 0 }),
      ctx.vertical ? 15 : 13,
    );
    moveAlong(ball, stepPath(plot, curve, xs), 0.36, 0.92);
    ball.enter = { at: 0.2, duration: 0.5, style: 'pop' };
    const gap = chevronPath(
      `${ctx.id}_gap`,
      from,
      dataToCanvas(plot, { x: deeper, y: curveY(curve, deeper) ?? 0 }),
    );
    gap.enter = { at: 0.76, duration: 0.6, style: 'draw' };
    return [plot, ball, gap];
  },
};

/** The descent itself: real steps, a ball that moves, steps that shorten. */
const descentSteps: Recipe = {
  name: 'descent',
  match:
    /\bsteps?\b|descend|descent|iterat|repeat|update|ball (?:moves|rolls|slides|actually)|watch .{0,20}(?:move|shrink|shorten)/i,
  build(ctx, hints, text) {
    const bowl = deriveBowl(hints);
    const lr = hints.lr ?? round(0.1 / bowl.a, 4);
    const count = hints.steps ?? 3;
    const xs = descend(bowl.curve, bowl.focus, lr, count, bowl.xDomain);
    const axis = axisLabels(text, { x: 'w', y: 'loss' });
    const landed = xs[1];
    const top = curveY(bowl.curve, bowl.focus) ?? 1;
    const plot = makePlot(ctx.id, ctx.box, {
      xDomain: bowl.xDomain,
      curves: [bowl.curve],
      xLabel: axis.x,
      yLabel: axis.y,
      overlays: overlays(
        point('loss', bowl.focus, `w = ${trim(bowl.focus)}`, 0.18),
        dropline('loss', bowl.focus, 'x', 0.24),
        stepsOverlay('loss', xs, undefined, 0.42),
        landed === undefined ? undefined : point('loss', landed, `w = ${trim(landed)}`, 0.62),
        xs.length > 2
          ? annotate(bowl.h, top * 0.3, 'the steps shrink as it flattens', 0.82)
          : undefined,
      ),
    });
    const ball = ballPath(
      `${ctx.id}_ball`,
      dataToCanvas(plot, { x: bowl.focus, y: top }),
      ctx.vertical ? 16 : 14,
    );
    moveAlong(ball, stepPath(plot, bowl.curve, xs), 0.46, 0.94);
    ball.enter = { at: 0.14, duration: 0.5, style: 'pop' };
    return [plot, ball];
  },
};

/**
 * The tangent — and with it, the minus sign.
 *
 * The slope arrow points *up* to the right; the step arrow points *down* to the
 * left, directly beneath it, so the learner sees the two are opposite before
 * anyone says the word "negative". That is the difference between deriving the
 * minus sign and asserting it.
 */
const tangentSlope: Recipe = {
  name: 'tangent',
  match: /tangent|slope|steep|gradient|derivative|minus sign|downhill|which way/i,
  build(ctx, hints, text) {
    const bowl = deriveBowl(hints);
    const at = bowl.focus;
    const slope = round(slopeAt(bowl.curve, at), 3);
    const span = Math.max(0.5, (bowl.xDomain[1] - bowl.xDomain[0]) * 0.16);
    const labels = axisLabels(text, { x: 'w', y: 'loss' });
    const plot = makePlot(ctx.id, ctx.box, {
      xDomain: bowl.xDomain,
      curves: [bowl.curve],
      xLabel: labels.x,
      yLabel: labels.y,
      overlays: [
        point('loss', at, `here`, 0.16),
        tangent('loss', at, span, `slope ${slope > 0 ? '+' : ''}${trim(slope)}`, 0.44),
        dropline('loss', at, 'x', 0.24),
        annotate(
          at,
          (curveY(bowl.curve, at) ?? 0) * 0.42,
          slope > 0 ? 'uphill is right, so step left' : 'uphill is left, so step right',
          0.7,
        ),
      ],
    });
    const foot = dataToCanvas(plot, { x: at, y: curveY(bowl.curve, at) ?? 0 });
    const downhillX = slope > 0 ? at - span * 0.9 : at + span * 0.9;
    const target = dataToCanvas(plot, { x: downhillX, y: curveY(bowl.curve, downhillX) ?? 0 });
    const arrow = makeArrow(`${ctx.id}_downhill`, {
      from: { x: foot.x, y: foot.y + 26 },
      to: { x: target.x, y: target.y + 26 },
      curve: 0,
      label: 'downhill',
      enter: { at: 0.78, duration: 0.6, style: 'draw' },
    });
    return [plot, arrow];
  },
};

/** Loss on the vertical axis: the number that says how wrong we are. */
const lossAxis: Recipe = {
  name: 'loss-axis',
  match: /loss|cost|\berror\b|how wrong|vertical axis|y axis/i,
  build(ctx, hints, text) {
    const bowl = deriveBowl(hints);
    const labels = axisLabels(text, { x: 'w', y: 'loss' });
    const y = curveY(bowl.curve, bowl.focus) ?? 0;
    const plot = makePlot(ctx.id, ctx.box, {
      xDomain: bowl.xDomain,
      curves: [bowl.curve],
      xLabel: labels.x,
      yLabel: labels.y,
      overlays: [
        point('loss', bowl.focus, undefined, 0.3),
        dropline('loss', bowl.focus, 'both', 0.46),
        annotate(bowl.focus, y * 1.16, 'how wrong we are here', 0.66),
        point('loss', bowl.h, 'as good as it gets', 0.84),
      ],
    });
    return [plot];
  },
};

/** Training versus held-out data — the shape of overfitting. */
const overfitting: Recipe = {
  name: 'overfitting',
  match: /overfit|training (?:vs|versus|and) (?:test|validation|held)|generali[sz]/i,
  build(ctx, _hints, text) {
    const train: Curve = {
      id: 'train',
      label: 'training',
      fn: { name: 'exp', params: [3.4, -0.42] },
      dashed: false,
      accent: 0,
    };
    const held: Curve = {
      id: 'held',
      label: 'unseen data',
      fn: { name: 'parabola', params: [0.13, 4.1, 0.85] },
      dashed: true,
      accent: 2,
    };
    const xDomain: [number, number] = [0.2, 9];
    const labels = axisLabels(text, { x: 'model complexity', y: 'error' });
    return [
      makePlot(ctx.id, ctx.box, {
        xDomain,
        curves: [train, held],
        xLabel: labels.x,
        yLabel: labels.y,
        overlays: [
          point('held', 4.1, 'best here', 0.5),
          dropline('held', 4.1, 'x', 0.58),
          shade('held', 'train', 5.4, 9, 0.74),
          annotate(7.2, 2.9, 'memorising, not learning', 0.86),
        ],
      }),
    ];
  },
};

const supplyDemand: Recipe = {
  name: 'supply-demand',
  match: /supply|demand|equilibrium|price (?:settles|meets)/i,
  build(ctx, _hints, text) {
    const supply: Curve = {
      id: 'supply',
      label: 'supply',
      fn: { name: 'line', params: [0.8, 0.6] },
      dashed: false,
      accent: 0,
    };
    const demand: Curve = {
      id: 'demand',
      label: 'demand',
      fn: { name: 'line', params: [-0.7, 7.4] },
      dashed: false,
      accent: 2,
    };
    const cross = round((7.4 - 0.6) / 1.5, 3);
    const labels = axisLabels(text, { x: 'quantity', y: 'price' });
    return [
      makePlot(ctx.id, ctx.box, {
        xDomain: [0, 8],
        curves: [supply, demand],
        xLabel: labels.x,
        yLabel: labels.y,
        overlays: [
          point('supply', cross, 'they agree here', 0.55),
          dropline('supply', cross, 'both', 0.7),
        ],
      }),
    ];
  },
};

/** Shade under one curve, or between two of them when `toCurveId` is given. */
const shade = (
  curveId: string,
  toCurveId: string | undefined,
  fromX: number,
  toX: number,
  at = 0.6,
): PlotOverlay => ({
  kind: 'shade',
  curveId,
  ...(toCurveId === undefined ? {} : { toCurveId }),
  fromX: round(fromX, 3),
  toX: round(toX, 3),
  at,
});

/** One-curve shapes: the long tail of "just draw me this function". */
function simple(
  name: string,
  match: RegExp,
  fn: NonNullable<Curve['fn']>,
  xDomain: [number, number],
  fallback: { x?: string; y?: string },
  marks?: (ctx: PlotContext, hints: PlotHints) => PlotOverlay[],
): Recipe {
  return {
    name,
    match,
    build(ctx, hints, text) {
      const curve: Curve = { id: name, label: fallback.y ?? name, fn, dashed: false, accent: 0 };
      const labels = axisLabels(text, fallback);
      return [
        makePlot(ctx.id, ctx.box, {
          xDomain,
          curves: [curve],
          xLabel: labels.x,
          yLabel: labels.y,
          overlays: marks ? marks(ctx, hints) : [],
          floorAtZero: false,
        }),
      ];
    },
  };
}

const RECIPES: Recipe[] = [
  learningRates,
  localMinima,
  overfitting,
  supplyDemand,
  descentSteps,
  tangentSlope,
  simple(
    'sigmoid',
    /sigmoid|logistic|s-curve|saturat|squash/i,
    { name: 'sigmoid', params: [1.6, 0, 1] },
    [-5, 5],
    { x: 'input', y: 'probability' },
    () => [dropline('sigmoid', 0, 'both', 0.55), annotate(2.6, 0.95, 'flattens out', 0.7)],
  ),
  simple(
    'gaussian',
    /bell|normal distribution|gaussian|spread of|standard deviation/i,
    { name: 'gaussian', params: [0, 1, 1] },
    [-3.6, 3.6],
    { x: 'value', y: 'how many' },
    () => [
      shade('gaussian', undefined, -1, 1, 0.6),
      annotate(0, 1.12, 'most of it lives here', 0.72),
    ],
  ),
  simple(
    'growth',
    /exponential|compound|doubl(?:e|ing)|snowball|growth/i,
    { name: 'exp', params: [0.5, 0.55] },
    [0, 8],
    { x: 'time', y: 'value' },
    () => [point('growth', 6.4, 'it runs away', 0.62)],
  ),
  simple(
    'diminishing',
    /logarithm|diminishing returns|log scale|levels off/i,
    { name: 'log', params: [2.2, 1] },
    [0.15, 9],
    { x: 'effort', y: 'value' },
    () => [annotate(6.5, 5.4, 'each extra unit buys less', 0.66)],
  ),
  simple(
    'wave',
    /wave|oscillat|sine|periodic|cycle|back and forth/i,
    { name: 'sine', params: [1, 1.4, 0, 0] },
    [0, 9],
    { x: 'time', y: 'value' },
  ),
  simple(
    'threshold',
    /threshold|step function|cutoff|switch(?:es)? on|all or nothing/i,
    { name: 'step', params: [3, 0, 1] },
    [0, 7],
    { x: 'input', y: 'output' },
    () => [annotate(3, 0.55, 'nothing, then everything', 0.6)],
  ),
  simple(
    'linear',
    /\blinear\b|straight line|proportional|constant rate/i,
    { name: 'line', params: [0.8, 0.4] },
    [0, 8],
    { x: 'input', y: 'output' },
  ),
  lossAxis,
];

/** Fallback: still a real plot with real axes, just an unopinionated one. */
const bowlOnly: Recipe = {
  name: 'bowl',
  match: /.^/,
  build(ctx, hints, text) {
    const bowl = deriveBowl(hints);
    const labels = axisLabels(text, { x: 'w', y: 'loss' });
    return [
      makePlot(ctx.id, ctx.box, {
        xDomain: bowl.xDomain,
        curves: [bowl.curve],
        xLabel: labels.x,
        yLabel: labels.y,
        overlays: [point('loss', bowl.h, 'the bottom', 0.6)],
      }),
    ];
  },
};

/** Which recipe an intent selects. Exported so tests can pin the mapping. */
export function recipeFor(describe: string, narration = ''): string {
  const text = `${describe} ${narration}`;
  for (const r of RECIPES) if (r.match.test(text)) return r.name;
  return bowlOnly.name;
}

/**
 * Build the elements for a `plot` intent.
 *
 * The intent's own words choose the recipe; the beat's narration only supplies
 * numbers the intent left out, so a chatty narration can never override an
 * explicit drawing instruction.
 */
export function buildPlot(ctx: PlotContext, intent: VisualIntent): Element[] {
  const text = `${intent.describe} ${ctx.narration}`;
  const hints = plotHints(intent.describe, ctx.narration);
  // The intent's own words are consulted first and alone. Matching against the
  // narration too would let a passing "that is why the step subtracts" hijack a
  // beat whose instruction plainly asked for a tangent.
  const recipe =
    RECIPES.find((r) => r.match.test(intent.describe)) ??
    RECIPES.find((r) => r.match.test(text)) ??
    bowlOnly;
  const built = recipe.build(ctx, hints, intent.describe || ctx.narration);
  return built.length ? built : bowlOnly.build(ctx, hints, intent.describe);
}

/** A number written the way a narrator would say it: 2.6, not 2.6000000001. */
export function trim(n: number): string {
  const r = round(n, 3);
  return Number.isInteger(r) ? String(r) : String(r).replace(/0+$/, '').replace(/\.$/, '');
}
