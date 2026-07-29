import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard, type PlotElement } from '@inkcast/core';
import { builtinMetrics } from '../src/fontmetrics.js';
import { ctxFor, seedFrom } from '../src/geometry.js';
import {
  CURVE_FUNCTIONS,
  curveEval,
  curveInk,
  describeCurveFunctions,
  niceStep,
  plotFrame,
  resolvePlot,
  tickValues,
  type CurveFnName,
} from '../src/plot.js';
import { inkStyleFor } from '../src/style.js';
import {
  containsBox,
  padBox,
  parsePath,
  pathBBox,
  pathLength,
  samplePath,
  unionBox,
} from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const font = builtinMetrics(style.fontFamily);
const SEED = seedFrom('plot-test');
const BOX = { x: 200, y: 140, w: 1000, h: 720 };

function ctx() {
  return ctxFor(style, SEED);
}

/** A `PlotElement` with every default filled in, via the real schema. */
function plot(over: Partial<Record<string, unknown>> = {}): PlotElement {
  const sb = parseStoryboard({
    version: 1,
    title: 't',
    scenes: [
      {
        id: 's1',
        narration: 'n',
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'p',
            type: 'plot',
            at: BOX,
            xDomain: [-3, 3],
            yDomain: [0, 10],
            curves: [{ id: 'L', fn: { name: 'parabola', params: [1, 0, 0] } }],
            ...over,
          },
        ],
      },
    ],
  });
  const el = sb.scenes[0]?.elements[0];
  assert.ok(el && el.type === 'plot');
  return el;
}

function resolve(el: PlotElement) {
  return resolvePlot(el, ctx(), { style, font, canvasHeight: 1080, baseAt: el.enter.at });
}

/* ------------------------------------------------------- named functions --- */

test('every named function is documented with matching params and defaults', () => {
  const names = Object.keys(CURVE_FUNCTIONS) as CurveFnName[];
  // The IR's enum and this table must not drift: the planner reads the table.
  assert.deepEqual(
    new Set(names),
    new Set([
      'parabola',
      'line',
      'sigmoid',
      'gaussian',
      'sine',
      'exp',
      'log',
      'doubleWell',
      'step',
    ]),
  );
  for (const name of names) {
    const doc = CURVE_FUNCTIONS[name];
    assert.equal(doc.params.length, doc.defaults.length, `${name} params/defaults mismatch`);
    assert.ok(doc.formula.length > 0, `${name} has no formula`);
    assert.ok(doc.summary.length > 20, `${name} summary is too thin to guide a planner`);
    for (const d of doc.defaults) assert.ok(Number.isFinite(d), `${name} default is not finite`);
  }
  const described = describeCurveFunctions();
  for (const name of names) assert.match(described, new RegExp(`${name}\\(`));
});

test('named functions compute the documented formula', () => {
  const cases: Array<[CurveFnName, number[], number, number]> = [
    ['parabola', [2, 1, 3], 4, 2 * (4 - 1) ** 2 + 3],
    ['line', [-1.5, 4], 2, -1.5 * 2 + 4],
    ['sigmoid', [2, 1, 5], 1, 5 / 2],
    ['gaussian', [1, 2, 3], 1, 3],
    ['sine', [2, 0.25, 0], 1, 2 * Math.sin(Math.PI / 2)],
    ['exp', [3, 0.5, 1], 2, 3 * Math.exp(1) + 1],
    ['log', [2, 1, Math.E], 1 + Math.E, 2],
    ['step', [1, -1, 4], 0.99, -1],
    ['step', [1, -1, 4], 1, 4],
  ];
  for (const [name, params, x, want] of cases) {
    const got = curveEval({ id: 'c', fn: { name, params }, dashed: false, accent: 0 }).at(x);
    assert.ok(got !== undefined, `${name} is undefined at ${x}`);
    assert.ok(Math.abs(got - want) < 1e-9, `${name}(${x}) = ${got}, expected ${want}`);
  }
});

test('log is undefined at and below x0 rather than spiking', () => {
  const ev = curveEval({ id: 'c', fn: { name: 'log', params: [1, 2] }, dashed: false, accent: 0 });
  assert.equal(ev.at(2), undefined);
  assert.equal(ev.at(1), undefined);
  assert.ok((ev.at(3) ?? NaN) === 0);
  // The gap splits the drawn runs instead of producing a NaN path.
  const runs = ev.samples(0, 6, 60);
  assert.equal(runs.length, 1);
  for (const run of runs) for (const p of run) assert.ok(p.x > 2 && Number.isFinite(p.y));
});

/* ------------------------------------------------------------- doubleWell --- */

test('doubleWell has two minima at DIFFERENT heights, left the deeper', () => {
  const ev = curveEval({
    id: 'w',
    fn: { name: 'doubleWell', params: [] },
    dashed: false,
    accent: 0,
  });
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= 4000; i++) {
    const x = -2.2 + (4.4 * i) / 4000;
    const y = ev.at(x);
    assert.ok(y !== undefined, `doubleWell undefined at ${x}`);
    xs.push(x);
    ys.push(y);
  }
  const minima: Array<{ x: number; y: number }> = [];
  const maxima: Array<{ x: number; y: number }> = [];
  for (let i = 1; i < ys.length - 1; i++) {
    const [a, b, c] = [ys[i - 1] as number, ys[i] as number, ys[i + 1] as number];
    if (b < a && b < c) minima.push({ x: xs[i] as number, y: b });
    if (b > a && b > c) maxima.push({ x: xs[i] as number, y: b });
  }
  assert.equal(minima.length, 2, `expected exactly two minima, got ${minima.length}`);
  assert.equal(maxima.length, 1, 'expected one ridge between the wells');

  const [left, right] = minima as [{ x: number; y: number }, { x: number; y: number }];
  assert.ok(left.x < 0 && right.x > 0, 'the wells should straddle the origin');
  // The whole point of the function: a global and a local minimum, not a tie.
  assert.ok(left.y < right.y, 'the left well must be the global minimum');
  assert.ok(right.y - left.y > 0.2, `the wells are too close in height: ${left.y} vs ${right.y}`);
  assert.ok((maxima[0] as { y: number }).y > right.y, 'the ridge must sit above both wells');
  // Defaults lift both wells above zero, so the curve reads as a loss.
  assert.ok(left.y > 0, 'the default k should keep both wells positive');
});

test('a tilt of zero collapses the wells to equal depth — which is why it is not the default', () => {
  const ev = curveEval({
    id: 'w',
    fn: { name: 'doubleWell', params: [1, 1, 0, 0] },
    dashed: false,
    accent: 0,
  });
  assert.ok(Math.abs((ev.at(-1) ?? NaN) - (ev.at(1) ?? NaN)) < 1e-12);
  assert.notEqual(CURVE_FUNCTIONS.doubleWell.defaults[2], 0);
});

/* ---------------------------------------------------------------- tangent --- */

test('tangent slope matches the analytic derivative for every smooth function', () => {
  const cases: Array<{
    name: CurveFnName;
    params: number[];
    d: (x: number) => number;
    xs: number[];
  }> = [
    { name: 'parabola', params: [2, 1, 3], d: (x) => 2 * 2 * (x - 1), xs: [-2, 0, 1, 2.5, 4] },
    { name: 'line', params: [-1.5, 4], d: () => -1.5, xs: [-3, 0, 7] },
    {
      name: 'sigmoid',
      params: [2, 1, 5],
      d: (x) => {
        const s = 5 / (1 + Math.exp(-2 * (x - 1)));
        return (2 * s * (5 - s)) / 5;
      },
      xs: [-1, 0.5, 1, 3],
    },
    {
      name: 'gaussian',
      params: [1, 2, 3],
      d: (x) => 3 * Math.exp(-((x - 1) ** 2) / 8) * (-(x - 1) / 4),
      xs: [-2, 0, 1, 2, 5],
    },
    {
      name: 'sine',
      params: [2, 0.25, 0.3],
      d: (x) => 2 * 2 * Math.PI * 0.25 * Math.cos(2 * Math.PI * 0.25 * x + 0.3),
      xs: [-1, 0, 0.7, 2],
    },
    { name: 'exp', params: [3, 0.5, 1], d: (x) => 1.5 * Math.exp(0.5 * x), xs: [-2, 0, 1.5] },
    { name: 'log', params: [2, 1, Math.E], d: (x) => 2 / (x - 1), xs: [1.5, 3, 9] },
    {
      name: 'doubleWell',
      params: [1, 1, 0.35, 0.4],
      d: (x) => 4 * x * (x * x - 1) + 0.35,
      xs: [-1.8, -1, -0.3, 0.5, 1.2, 1.9],
    },
  ];
  for (const c of cases) {
    const ev = curveEval({
      id: 'c',
      fn: { name: c.name, params: c.params },
      dashed: false,
      accent: 0,
    });
    for (const x of c.xs) {
      const got = ev.slopeAt(x);
      const want = c.d(x);
      assert.ok(got !== undefined, `${c.name}: no slope at ${x}`);
      const tol = Math.max(1e-6, Math.abs(want) * 1e-6);
      assert.ok(
        Math.abs(got - want) <= tol,
        `${c.name}'(${x}) = ${got}, analytic ${want} (tol ${tol})`,
      );
    }
  }
});

test('a step has no slope at the jump and zero slope either side', () => {
  const ev = curveEval({
    id: 'c',
    fn: { name: 'step', params: [2, 0, 1] },
    dashed: false,
    accent: 0,
  });
  assert.equal(ev.slopeAt(2), undefined);
  assert.equal(ev.slopeAt(0), 0);
  assert.equal(ev.slopeAt(5), 0);
});

test('a point curve reports the drawn spline slope, matching the data it interpolates', () => {
  // Samples of y = x², so the interpolating spline's slope must approximate 2x.
  const points = [];
  for (let x = -3; x <= 3.0001; x += 0.25) points.push({ x, y: x * x });
  const ev = curveEval({ id: 'c', points, dashed: false, accent: 0 });
  for (const x of [-2, -0.5, 0.75, 2.25]) {
    const got = ev.slopeAt(x);
    assert.ok(got !== undefined);
    assert.ok(Math.abs(got - 2 * x) < 0.05, `spline slope at ${x} was ${got}, wanted ${2 * x}`);
  }
  assert.equal(ev.at(-4), undefined, 'outside the sampled range there is no curve');
});

test('the drawn tangent has the curve slope in data space, and touches the curve', () => {
  const el = plot({
    curves: [{ id: 'L', fn: { name: 'parabola', params: [1, 0, 0.5] } }],
    overlays: [{ kind: 'tangent', curveId: 'L', x: 2, span: 1, at: 0.4 }],
  });
  const resolved = resolve(el);
  const part = resolved.parts.find((p) => p.kind === 'tangent');
  assert.ok(part, 'no tangent part');
  const mark = resolved.layout.marks.find((m) => m.kind === 'tangent');
  assert.ok(mark && mark.slope !== undefined);
  assert.ok(Math.abs(mark.slope - 4) < 1e-6, `slope was ${mark.slope}`);
  // It touches the curve at x = 2, y = 4.5.
  assert.ok(Math.abs(mark.data.y - 4.5) < 1e-9);

  // Read the slope back out of the geometry: the drawn line, mapped to data
  // space, must have the same gradient.
  const strokes = part.items.filter((i) => i.kind === 'path');
  assert.ok(strokes.length >= 1);
  const bbox = pathBBox((strokes[0] as { kind: 'path'; path: { d: string } }).path.d);
  const a = resolved.frame.toData({ x: bbox.x, y: bbox.y + bbox.h });
  const b = resolved.frame.toData({ x: bbox.x + bbox.w, y: bbox.y });
  const drawn = (b.y - a.y) / (b.x - a.x);
  assert.ok(Math.abs(drawn - 4) < 0.2, `the drawn tangent's gradient was ${drawn}`);
});

/* --------------------------------------------------------- staying inside --- */

const DOMAINS: Array<{ label: string; el: PlotElement }> = [
  {
    label: 'parabola clipped by the range',
    el: plot({ xDomain: [-6, 6], yDomain: [0, 4], grid: true, ticks: true }),
  },
  {
    label: 'exponential blowing past the top',
    el: plot({
      xDomain: [0, 6],
      yDomain: [0, 20],
      curves: [{ id: 'e', fn: { name: 'exp', params: [1, 1] } }],
    }),
  },
  {
    label: 'sine oscillating out of range',
    el: plot({
      xDomain: [0, 4],
      yDomain: [-0.5, 0.5],
      curves: [{ id: 's', fn: { name: 'sine', params: [1, 1] } }],
    }),
  },
  {
    label: 'reversed y domain',
    el: plot({ xDomain: [-2, 2], yDomain: [10, 0] }),
  },
  {
    label: 'a step riser',
    el: plot({
      xDomain: [-2, 2],
      yDomain: [-1, 2],
      curves: [{ id: 'st', fn: { name: 'step', params: [0, 0, 1] } }],
    }),
  },
  {
    label: 'a double well with every overlay',
    el: plot({
      xDomain: [-2, 2],
      yDomain: [0, 3],
      xLabel: 'weight',
      yLabel: 'loss',
      grid: true,
      ticks: true,
      curves: [
        { id: 'w', fn: { name: 'doubleWell', params: [] }, label: 'loss' },
        {
          id: 'z',
          fn: { name: 'line', params: [0, 0.4] },
          dashed: true,
          accent: 2,
          label: 'floor',
        },
      ],
      overlays: [
        { kind: 'point', curveId: 'w', x: 1.5, label: 'start here', at: 0.1 },
        { kind: 'tangent', curveId: 'w', x: 1.5, span: 0.6, label: 'steep', at: 0.2 },
        { kind: 'dropline', curveId: 'w', x: 1.5, to: 'both', at: 0.3 },
        { kind: 'shade', curveId: 'w', toCurveId: 'z', fromX: -1.5, toX: 1.5, at: 0.4 },
        { kind: 'steps', curveId: 'w', xs: [1.5, 1.2, 1, 0.96], label: 'stuck', at: 0.5 },
        {
          kind: 'annotate',
          x: -1,
          y: 2.4,
          text: 'the global minimum',
          leaderTo: { x: -1.05, y: 0.05 },
          at: 0.6,
        },
      ],
    }),
  },
];

test('every curve and overlay stays inside the element box', () => {
  for (const { label, el } of DOMAINS) {
    const resolved = resolve(el);
    // Roughjs wobble can reach maxRandomnessOffset plus half a stroke width.
    const slack = style.maxRandomnessOffset * 2 + style.strokeWidth;
    const allowed = padBox(el.at, slack);
    for (const part of resolved.parts) {
      for (const item of part.items) {
        if (item.kind === 'path') {
          const bbox = pathBBox(item.path.d);
          assert.ok(
            containsBox(allowed, bbox),
            `${label}: ${part.kind}/${part.id} left the box — ${JSON.stringify(bbox)} vs ${JSON.stringify(allowed)}`,
          );
        } else {
          assert.ok(
            containsBox(allowed, item.text.bounds),
            `${label}: ${part.kind}/${part.id} label left the box`,
          );
        }
      }
    }
  }
});

test('curve strokes stay inside the plotted area, not just the box', () => {
  for (const { label, el } of DOMAINS) {
    const resolved = resolve(el);
    const slack = style.maxRandomnessOffset * 2 + style.strokeWidth * 1.5;
    const allowed = padBox(resolved.frame.area, slack);
    for (const part of resolved.parts.filter((p) => p.kind === 'curve')) {
      for (const item of part.items) {
        if (item.kind !== 'path') continue;
        assert.ok(
          containsBox(allowed, pathBBox(item.path.d)),
          `${label}: curve ${part.id} escaped the plotted area`,
        );
      }
    }
  }
});

test('every plot stroke is real, finite path data', () => {
  for (const { label, el } of DOMAINS) {
    const resolved = resolve(el);
    assert.ok(resolved.items.length > 0, `${label}: nothing drawn`);
    for (const item of resolved.items) {
      if (item.kind !== 'path') continue;
      assert.match(item.path.d, /^M/, `${label}: path does not start with a moveto`);
      assert.ok(!/NaN|Infinity|undefined/.test(item.path.d), `${label}: non-numeric path data`);
      assert.ok(parsePath(item.path.d).length >= 2, `${label}: path has no geometry`);
      assert.ok(item.path.length > 0, `${label}: unmeasured stroke`);
    }
  }
});

/* ------------------------------------------------------------ frame + ticks */

test('the frame maps the domain onto the plotted area, both ways', () => {
  const el = plot({ xDomain: [-3, 3], yDomain: [0, 10], xLabel: 'w', yLabel: 'loss', ticks: true });
  const f = plotFrame(el, { canvasHeight: 1080 });
  assert.ok(containsBox(el.at, f.area), 'the area must be inside the box');
  assert.ok(f.area.w >= el.at.w * 0.5 && f.area.h >= el.at.h * 0.5, 'gutters ate the plot');

  const bl = f.toCanvas({ x: -3, y: 0 });
  const tr = f.toCanvas({ x: 3, y: 10 });
  assert.ok(Math.abs(bl.x - f.area.x) < 1e-6);
  assert.ok(Math.abs(bl.y - (f.area.y + f.area.h)) < 1e-6, 'y must grow upwards');
  assert.ok(Math.abs(tr.x - (f.area.x + f.area.w)) < 1e-6);
  assert.ok(Math.abs(tr.y - f.area.y) < 1e-6);

  const round = f.toData(f.toCanvas({ x: 1.25, y: 7.5 }));
  assert.ok(Math.abs(round.x - 1.25) < 1e-9 && Math.abs(round.y - 7.5) < 1e-9);

  // Axes sit at the data zero when it is in range, at the nearest edge otherwise.
  assert.equal(f.anchor.x, 0);
  assert.equal(f.anchor.y, 0);
  const above = plotFrame(plot({ xDomain: [2, 8], yDomain: [-9, -1] }), { canvasHeight: 1080 });
  assert.equal(above.anchor.x, 2);
  assert.equal(above.anchor.y, -1);
});

test('ticks land on 1-2-5 steps inside the domain', () => {
  assert.equal(niceStep(10, 5), 2);
  // 6/5 = 1.2 rounds up the 1-2-5 ladder to 2, giving three intervals rather
  // than seven ticks across a six-unit domain. Fewer ticks is the right answer
  // for an explainer.
  assert.equal(niceStep(6, 5), 2);
  assert.equal(niceStep(0.4, 5), 0.1);
  assert.deepEqual(tickValues([0, 10], 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(tickValues([-3, 3], 5), [-2, 0, 2]);
  for (const v of tickValues([-7.3, 4.1], 5)) assert.ok(v >= -7.3 && v <= 4.1);
  assert.ok(tickValues([0, 0], 5).length >= 1, 'a degenerate domain must not hang');
});

/* ---------------------------------------------------------- parts and `at` */

test('parts carry their own at fraction and a contiguous draw range', () => {
  const el = plot({
    enter: { at: 0.1, duration: 1, style: 'draw' },
    grid: true,
    ticks: true,
    xLabel: 'w',
    yLabel: 'loss',
    curves: [{ id: 'L', fn: { name: 'parabola', params: [1, 0, 0.5] }, label: 'loss' }],
    overlays: [
      { kind: 'steps', curveId: 'L', xs: [2, 1, 0.4], at: 0.9 },
      { kind: 'point', curveId: 'L', x: 2, at: 0.3 },
      { kind: 'tangent', curveId: 'L', x: 2, span: 1, at: 0.6 },
    ],
  });
  const resolved = resolve(el);
  const records = resolved.layout.parts;
  assert.ok(records.length >= 8, `expected a rich part list, got ${records.length}`);

  // Contiguous and gapless across the whole draw sequence.
  let expected = 0;
  for (const r of records) {
    assert.equal(r.from, expected, `part ${r.kind}/${r.id} does not start where the last ended`);
    assert.ok(r.to >= r.from, `part ${r.kind}/${r.id} owns no items`);
    expected = r.to + 1;
  }
  assert.equal(expected, resolved.items.length, 'parts must cover every drawn item');

  // The frame and the curves inherit the element's `at`; overlays keep their own.
  for (const r of records.filter((p) => !p.kind.startsWith('overlay'))) {
    if (r.id.startsWith('overlay:')) continue;
    assert.equal(r.at, 0.1, `${r.kind} should inherit the element's enter.at`);
  }
  const overlays = records.filter((r) => r.id.startsWith('overlay:'));
  // Three overlays, but the stepping sequence is one part *per hop* — the descent
  // has to arrive a move at a time, so each hop owns its own draw range and start.
  assert.deepEqual(
    overlays.map((r) => `${r.kind}@${r.at}`),
    ['point@0.3', 'tangent@0.6', 'steps@0.9', 'steps@0.9'],
    'overlays must be drawn in ascending `at` order, hop by hop for a descent',
  );
  assert.deepEqual(
    overlays.filter((r) => r.kind === 'steps').map((r) => r.id),
    ['overlay:0:0', 'overlay:0:1'],
    'each hop after the first is a suffixed sub-part of the same overlay',
  );
  for (const r of records) {
    for (let i = r.from; i <= r.to; i++) {
      const item = resolved.items[i];
      if (item && item.kind === 'path') assert.equal(item.path.group, r.group);
    }
  }
});

test('every curve is exposed as an arc-length-even canvas trace', () => {
  const el = plot({
    curves: [
      { id: 'L', fn: { name: 'parabola', params: [1, 0, 0.5] }, label: 'loss' },
      { id: 'M', fn: { name: 'line', params: [1, 2] }, accent: 1, dashed: true },
    ],
  });
  const resolved = resolve(el);
  assert.deepEqual(resolved.layout.curves.map((c) => c.id).sort(), ['L', 'M']);
  for (const trace of resolved.layout.curves) {
    assert.ok(trace.points.length > 40, 'a trace needs enough samples to ride');
    const gaps: number[] = [];
    for (let i = 1; i < trace.points.length; i++) {
      const a = trace.points[i - 1] as { x: number; y: number };
      const b = trace.points[i] as { x: number; y: number };
      gaps.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    assert.ok(max - min < max * 0.02, `trace ${trace.id} is not evenly spaced (${min}..${max})`);
    for (const p of trace.points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    }
  }
  assert.equal(resolved.layout.curves.find((c) => c.id === 'M')?.dashed, true);
});

test('unknown curve references warn and draw nothing rather than throwing', () => {
  const el = plot({
    overlays: [
      { kind: 'point', curveId: 'nope', x: 0, at: 0 },
      { kind: 'tangent', curveId: 'nope', x: 0, span: 1, at: 0 },
      { kind: 'steps', curveId: 'nope', xs: [0, 1], at: 0 },
    ],
  });
  const resolved = resolve(el);
  assert.equal(resolved.parts.filter((p) => p.id.startsWith('overlay:')).length, 0);
  assert.equal(resolved.layout.marks.length, 0);
});

test('axes: none draws no axis, and a plot with no curves still resolves', () => {
  const bare = resolve(plot({ axes: 'none', curves: [] }));
  assert.equal(bare.parts.filter((p) => p.kind === 'axis').length, 0);
  assert.equal(bare.items.length, 0);
  assert.equal(bare.layout.curves.length, 0);

  const xOnly = resolve(plot({ axes: 'x' }));
  assert.deepEqual(
    xOnly.parts.filter((p) => p.kind === 'axis').map((p) => p.id),
    ['x'],
  );
});

test('accent indices walk the palette and are clamped, not wrapped', () => {
  const seen = new Set<string>();
  for (let i = 0; i <= 5; i++) seen.add(curveInk(style, i).colour);
  assert.ok(seen.size >= 4, 'accents should be visually distinguishable');
  assert.equal(curveInk(style, 0).colour, style.ink);
  assert.equal(curveInk(style, 1).colour, style.accent);
  assert.equal(curveInk(style, 99).colour, curveInk(style, 5).colour);
  assert.equal(curveInk(style, -4).colour, curveInk(style, 0).colour);
  // Mono collapses the palette on purpose; nothing here should crash on that.
  const mono = inkStyleFor({ style: 'ink', palette: 'mono' });
  assert.equal(curveInk(mono, 1).colour, mono.ink);
});

test('labels never overlap each other', () => {
  const el = DOMAINS[5]?.el;
  assert.ok(el);
  const resolved = resolve(el);
  const boxes = resolved.items.filter((i) => i.kind === 'text').map((i) => i.text.bounds);
  assert.ok(boxes.length >= 6, 'this fixture should produce plenty of labels');
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as { x: number; y: number; w: number; h: number };
      const b = boxes[j] as { x: number; y: number; w: number; h: number };
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!hit, `labels ${i} and ${j} overlap: ${JSON.stringify(a)} ${JSON.stringify(b)}`);
    }
  }
});

test('resolving the same plot twice is byte-identical', () => {
  const el = DOMAINS[5]?.el;
  assert.ok(el);
  const a = resolve(el);
  const b = resolve(el);
  assert.deepEqual(
    a.items.map((i) => (i.kind === 'path' ? i.path.d : i.text.text)),
    b.items.map((i) => (i.kind === 'path' ? i.path.d : i.text.text)),
  );
  assert.deepEqual(a.layout.parts, b.layout.parts);
});

test('a step function is drawn with a vertical riser, not a diagonal ramp', () => {
  const ev = curveEval({
    id: 's',
    fn: { name: 'step', params: [0, 0, 1] },
    dashed: false,
    accent: 0,
  });
  const runs = ev.samples(-2, 2, 40);
  const all = runs.flat();
  let riser = 0;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1] as { x: number; y: number };
    const b = all[i] as { x: number; y: number };
    if (Math.abs(b.y - a.y) > 0.5 && Math.abs(b.x - a.x) < 1e-6) riser++;
  }
  assert.ok(riser >= 1, 'the jump should be a vertical segment');
});

test('a shade overlay produces a filled region with measurable geometry', () => {
  const el = plot({
    overlays: [{ kind: 'shade', curveId: 'L', fromX: -2, toX: 2, at: 0.5 }],
  });
  const resolved = resolve(el);
  const shade = resolved.parts.find((p) => p.kind === 'shade');
  assert.ok(shade, 'no shade part');
  const paths = shade.items.filter((i) => i.kind === 'path');
  assert.ok(paths.length > 0);
  for (const item of paths) {
    if (item.kind !== 'path') continue;
    assert.ok(pathLength(item.path.d) > 0);
  }
});

/* ---- crisp ink ---------------------------------------------------------- */

test('a plot draws crisp without being asked, and every part of it does', () => {
  // The mode is set inside `resolvePlot`, so a caller passing a plain context —
  // which is what both real call sites do — must still get exact geometry.
  const el = plot({
    grid: true,
    xLabel: 'x',
    yLabel: 'loss',
    overlays: [
      { kind: 'tangent', curveId: 'L', x: 1.5, span: 1, at: 0.3 },
      { kind: 'point', curveId: 'L', x: -1, at: 0.4 },
      { kind: 'dropline', curveId: 'L', x: 2, to: 'both', at: 0.5 },
      { kind: 'steps', curveId: 'L', xs: [-2.5, -1.5, -0.5], at: 0.6 },
    ],
  });
  // Crisp geometry carries no randomness, so the seed cannot reach the bytes. Any
  // stroke that slipped through in sketch mode would differ between these two.
  const one = resolvePlot(el, ctxFor(style, seedFrom('a')), {
    style,
    font,
    canvasHeight: 1080,
    baseAt: el.enter.at,
  });
  const two = resolvePlot(el, ctxFor(style, seedFrom('completely-different')), {
    style,
    font,
    canvasHeight: 1080,
    baseAt: el.enter.at,
  });
  const ds = (r: typeof one): string[] =>
    r.items.flatMap((i) => (i.kind === 'path' ? [i.path.d] : []));
  assert.ok(ds(one).length > 20, 'this plot should be a lot of strokes');
  assert.deepEqual(ds(two), ds(one), 'a plot stroke still depends on the seed');

  // And the axis a learner reads coordinates against is dead straight.
  const axis = one.parts.find((p) => p.kind === 'axis' && p.id === 'x');
  assert.ok(axis);
  const shaft = axis.items.find((i) => i.kind === 'path');
  assert.ok(shaft && shaft.kind === 'path');
  const ys = samplePath(parsePath(shaft.path.d)).map((p) => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-6, `the x axis wobbles: ${shaft.path.d}`);
});

test('a crisp curve keeps every sample rather than simplifying to the wobble', () => {
  // Simplification exists to land the perturbation at human scale. With no
  // perturbation it only costs fidelity, so the crisp curve is the denser one.
  const el = plot();
  const crisp = resolve(el);
  const sketch = resolvePlot(
    el,
    { ...ctxFor(style, SEED), ink: 'sketch' },
    { style, font, canvasHeight: 1080, baseAt: el.enter.at },
  );
  const segs = (r: typeof crisp): number => {
    const part = r.parts.find((p) => p.kind === 'curve');
    assert.ok(part);
    return part.items.reduce((n, i) => n + (i.kind === 'path' ? parsePath(i.path.d).length : 0), 0);
  };
  assert.ok(
    segs(crisp) > segs(sketch) * 2,
    `crisp curve should be far denser: ${segs(crisp)} vs ${segs(sketch)} segments`,
  );
});

test('the resolved plot reports one bounding area that contains all its ink', () => {
  const el = DOMAINS[5]?.el;
  assert.ok(el);
  const resolved = resolve(el);
  const ink = unionBox(
    resolved.items.map((i) => (i.kind === 'path' ? pathBBox(i.path.d) : i.text.bounds)),
  );
  const slack = style.maxRandomnessOffset * 2 + style.strokeWidth;
  assert.ok(containsBox(padBox(el.at, slack), ink), 'the element box must contain all its ink');
  assert.deepEqual(resolved.layout.box, el.at);
});
