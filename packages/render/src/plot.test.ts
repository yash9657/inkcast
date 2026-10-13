/**
 * `plot` — the element that decides whether the video can teach anything
 * quantitative.
 *
 * The tests are about build *order* and *direction* as much as about geometry: a
 * curve that appears all at once, or reveals in the order its samples happen to sit
 * in an array, is a picture of a curve rather than a curve being explained.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStoryboard } from '@inkcast/core';
import type { PlotElement, Storyboard } from '@inkcast/core';
import { compilePlan } from './compile.js';
import { lessonStoryboard, planWithVisuals, withVisuals } from './fixture.js';
import { flattenPathData } from './geom.js';
import type { Pt } from './geom.js';
import { CURVE_FUNCTIONS, curveEval, plotFrame } from '@inkcast/visuals';
import { paletteFor } from './palette.js';
import type { GeomPrim, PlanItem, PlanPrim, Rect, TextPrim } from './types.js';

const DIR = '/tmp/inkcast-plot-test';

function plotBoard(el: Record<string, unknown>): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'plot',
    meta: { fps: 30, outroSec: 0 },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's',
        narration: 'here is the loss curve for one weight and here is the slope',
        durationSec: 6,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          {
            id: 'p',
            type: 'plot',
            xDomain: [-3, 3],
            yDomain: [0, 10],
            curves: [{ id: 'bowl', fn: { name: 'parabola', params: [1, 0, 0.5] } }],
            at: { x: 200, y: 120, w: 1500, h: 840 },
            enter: { at: 0, duration: 0.5, style: 'draw' },
            ...el,
          },
        ],
      },
    ],
  });
}

async function items(sb: Storyboard): Promise<PlanItem[]> {
  return (await planWithVisuals(sb)).items;
}

function geomsOf(item: PlanItem | undefined): GeomPrim[] {
  return (item?.prims ?? []).filter((p): p is GeomPrim => p.kind === 'geom');
}

function textsOf(item: PlanItem | undefined): TextPrim[] {
  return (item?.prims ?? []).filter((p): p is TextPrim => p.kind === 'text');
}

function bounds(prims: PlanPrim[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const prim of prims) {
    const pts: Pt[] =
      prim.kind === 'geom'
        ? flattenPathData(prim.d).flat()
        : prim.kind === 'text'
          ? [
              [prim.box.x, prim.box.y],
              [prim.box.x + prim.box.w, prim.box.y + prim.box.h],
            ]
          : [
              [prim.box.x, prim.box.y],
              [prim.box.x + prim.box.w, prim.box.y + prim.box.h],
            ];
    for (const p of pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

test('the renderer holds no second opinion about curve maths', async () => {
  // The named functions, the sampling and the slopes belong to `@inkcast/visuals`,
  // which is authoritative for plot geometry; `curveEval` is what the drawn curve is
  // built from and `CURVE_FUNCTIONS` is the contract the planner writes against.
  // This asserts the renderer reaches for that one implementation rather than
  // keeping a copy to drift against — the copy it used to keep disagreed with the
  // planner about what `step` meant.
  const bowl = curveEval({
    id: 'b',
    fn: { name: 'parabola', params: [1, 0, 0] },
    dashed: false,
    accent: 0,
  });
  assert.equal(bowl.at(3), 9);
  assert.ok((bowl.slopeAt(-2) ?? 0) < 0, 'downhill to the right on the left flank');
  assert.ok((bowl.slopeAt(2) ?? 0) > 0);

  // Explicit samples interpolate along the same spline the path lane draws.
  const sampled = curveEval({
    id: 's',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ],
    dashed: false,
    accent: 0,
  });
  // Inverted by bisection against the drawn spline, so exact to float precision
  // rather than exactly representable.
  assert.ok(Math.abs((sampled.at(5) ?? 0) - 10) < 1e-9);

  // `step` is a single jump, which is what the planner's params mean by it.
  const jump = curveEval({
    id: 'j',
    fn: { name: 'step', params: [3, 0, 1] },
    dashed: false,
    accent: 0,
  });
  assert.equal(jump.at(2.9), 0);
  assert.equal(jump.at(3.1), 1);

  assert.ok(CURVE_FUNCTIONS.parabola.params.length > 0, 'the catalogue is documented as data');
});

test('axes are drawn first, then the curve, then the overlays', async () => {
  const built = await items(
    plotBoard({
      xLabel: 'weight',
      yLabel: 'loss',
      overlays: [
        { kind: 'point', curveId: 'bowl', x: -2 },
        { kind: 'dropline', curveId: 'bowl', x: -2, to: 'x' },
      ],
    }),
  );
  assert.deepEqual(
    built.map((i) => i.id),
    ['p', 'p~curve-bowl', 'p~ov0', 'p~ov1'],
  );
  for (let i = 1; i < built.length; i++) {
    const prev = built[i - 1]!;
    const here = built[i]!;
    assert.ok(
      here.start >= prev.start + prev.dur - 1e-9,
      `${here.id} must wait for ${prev.id} to finish`,
    );
  }
  // The frame carries the axes and their labels; the curve is a separate stroke.
  assert.ok(geomsOf(built[0]).length >= 4, 'two axes and two arrowheads');
  assert.deepEqual(
    textsOf(built[0]).map((t) => t.text),
    ['weight', 'loss'],
  );
  assert.equal(geomsOf(built[1]).length, 1, 'a curve is one stroke, revealed once');
});

test('a curve is revealed along its own direction, left to right', async () => {
  const built = await items(plotBoard({}));
  const curve = built.find((i) => i.id === 'p~curve-bowl');
  const d = geomsOf(curve)[0]?.d ?? '';
  const pts = flattenPathData(d).flat();
  assert.ok(pts.length > 30, 'the curve is sampled densely enough to read as a curve');

  const first = pts[0] as Pt;
  const last = pts.at(-1) as Pt;
  assert.ok(last[0] > first[0], 'the stroke starts at the left of the plot and ends at the right');
  let backwards = 0;
  for (let i = 1; i < pts.length; i++) {
    if ((pts[i] as Pt)[0] < (pts[i - 1] as Pt)[0]) backwards++;
  }
  assert.ok(backwards < pts.length * 0.06, `x advances monotonically, ${backwards} steps back`);

  // A bowl: both ends high, the middle low.
  const mid = pts[Math.floor(pts.length / 2)] as Pt;
  assert.ok(mid[1] > first[1] && mid[1] > last[1], 'y is flipped into screen space');
});

test('a curve leaving the range is clipped into the plot area, not squashed into it', async () => {
  const sb = plotBoard({
    yDomain: [0, 4],
    curves: [{ id: 'bowl', fn: { name: 'parabola', params: [1, 0, 0] } }],
  });
  const built = await items(sb);
  const el = sb.scenes[0]?.elements[0] as PlotElement;
  const ink = geomsOf(built.find((i) => i.id === 'p~curve-bowl'));
  // A bowl that overshoots the top at both ends leaves exactly one visible run.
  assert.equal(ink.length, 1, 'the middle of the bowl is what remains');
  const box = bounds(ink);
  assert.ok(box.y >= el.at.y - 2, 'nothing is drawn above the frame');
  assert.ok(box.y + box.h <= el.at.y + el.at.h + 2, 'or below it');

  // The visible part still spans the middle of the domain.
  assert.ok(box.w > el.at.w * 0.3);
});

test('an overlay lands on its own fraction of the narration', async () => {
  const built = await items(
    plotBoard({
      overlays: [
        { kind: 'tangent', curveId: 'bowl', x: -2, span: 1, at: 0.6, label: 'slope' },
        { kind: 'annotate', x: 1.5, y: 8, text: 'steeper here', at: 0.85 },
      ],
    }),
  );
  const tangent = built.find((i) => i.id === 'p~ov0');
  const note = built.find((i) => i.id === 'p~ov1');
  assert.ok(tangent && note);
  // 0.6 and 0.85 of a six-second narration.
  assert.ok(Math.abs(tangent.start - 3.6) < 1e-9, `tangent at ${tangent.start}`);
  assert.ok(Math.abs(note.start - 5.1) < 1e-9, `annotation at ${note.start}`);

  // A tangent sweeps into the slope it measures.
  assert.ok(tangent.sweep, 'the tangent swings into place');
  assert.ok(Math.abs(tangent.sweep.deg) > 20, `a visible swing, got ${tangent.sweep.deg}`);
  const line = geomsOf(tangent)[0];
  const pts = flattenPathData(line?.d ?? '').flat();
  const left = pts[0] as Pt;
  const right = pts.at(-1) as Pt;
  // On the left flank of a bowl the tangent descends to the right, on screen.
  assert.ok(right[1] > left[1], 'the drawn tangent points downhill');
});

test('a stepping sequence appears one step at a time, in order', async () => {
  const built = await items(
    plotBoard({
      overlays: [{ kind: 'steps', curveId: 'bowl', xs: [-2.4, -1.6, -1, -0.6], label: 'descend' }],
    }),
  );
  const steps = built.filter((i) => i.id.startsWith('p~ov0s'));
  assert.equal(steps.length, 3, 'four positions are three moves');
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!;
    assert.ok(steps[i]!.start >= prev.start + prev.dur - 1e-9, 'each step waits for the last');
    assert.ok(steps[i]!.center[0] > prev.center[0], 'and lands further along the curve');
  }
  assert.ok(
    textsOf(steps[0]).some((t) => t.text === 'descend'),
    'the sequence is labelled once, on its first move',
  );
});

test('plot ink stays inside the element box and uses only the board palette', async () => {
  const sb = plotBoard({
    grid: true,
    ticks: true,
    xLabel: 'weight',
    yLabel: 'loss',
    curves: [
      { id: 'bowl', fn: { name: 'parabola', params: [1, 0, 0.5] } },
      { id: 'flat', fn: { name: 'line', params: [0, 1] }, dashed: true, accent: 1 },
    ],
    overlays: [
      { kind: 'point', curveId: 'bowl', x: -2.4, label: 'here' },
      { kind: 'shade', curveId: 'bowl', fromX: -1, toX: 1 },
      { kind: 'dropline', curveId: 'bowl', x: 1.5, to: 'both' },
    ],
  });
  const el = sb.scenes[0]?.elements[0] as PlotElement;
  const built = (await items(sb)).filter((i) => i.id.startsWith('p'));
  assert.ok(built.length >= 5);

  const pal = paletteFor('color');
  const allowed = new Set([pal.ink, pal.inkSoft, pal.accent]);
  for (const item of built) {
    for (const prim of item.prims) {
      const colour = prim.kind === 'geom' ? prim.stroke : prim.kind === 'text' ? prim.color : null;
      if (colour) assert.ok(allowed.has(colour), `unexpected plot colour ${colour}`);
    }
    const box = bounds(item.prims);
    // A label may sit on the frame's edge; nothing may wander off the board.
    assert.ok(box.x >= el.at.x - 4, `${item.id} stays inside on the left`);
    assert.ok(box.x + box.w <= el.at.x + el.at.w + 4, `${item.id} stays inside on the right`);
    assert.ok(box.y >= el.at.y - 4, `${item.id} stays inside on top`);
    assert.ok(box.y + box.h <= el.at.y + el.at.h + 4, `${item.id} stays inside at the bottom`);
  }
  // Ticks and a grid are drawn softly, and never dash-revealed like real ink.
  const frame = built[0];
  assert.ok(geomsOf(frame).some((g) => g.noDash === true && (g.opacity ?? 1) < 0.5));
});

test('the plotting area leaves room for the labels it was given', async () => {
  // The gutters are the visuals stage's decision, sized from the real type scale.
  // The renderer reads the solved area rather than insetting the box a second time.
  const sb = plotBoard({ xLabel: 'weight', yLabel: 'loss', ticks: true });
  const bare = plotBoard({ axes: 'both' });
  const withLabels = plotFrame(sb.scenes[0]?.elements[0] as PlotElement, { canvasHeight: 1080 });
  const without = plotFrame(bare.scenes[0]?.elements[0] as PlotElement, { canvasHeight: 1080 });
  assert.ok(withLabels.area.x > without.area.x, 'a y label and ticks buy a left gutter');
  assert.ok(withLabels.area.h < without.area.h, 'and an x label a bottom one');
  assert.ok(withLabels.area.w > 0 && withLabels.area.h > 0);
  // The axis lines sit on zero when zero is in range, otherwise on the domain edge.
  assert.equal(withLabels.anchor.y, 0);
  assert.equal(withLabels.anchor.x, 0);

  // And what the renderer draws agrees with it: the frame phase's ink lands inside
  // the solved area, not the raw element box.
  const frame = (await items(sb))[0];
  const ink = bounds(geomsOf(frame));
  assert.ok(
    ink.x >= withLabels.area.x - withLabels.area.w * 0.1,
    'the frame is drawn in the inset area the layout solved',
  );
});

test('a later beat annotating the same plot does not re-ink it', async () => {
  const built = await items(lessonStoryboard());
  const ids = built.map((i) => i.id);
  assert.ok(ids.includes('loss'), 'the first beat draws the frame');
  assert.ok(ids.includes('loss~curve-bowl'), 'and the curve');
  // The second beat re-declares both — it has to, because its overlays need the
  // curve definition — but the board already carries them.
  assert.ok(!ids.includes('tan'), 'the frame is not drawn twice');
  assert.ok(!ids.includes('tan~curve-bowl'), 'nor the curve');
  assert.ok(
    ids.some((id) => id.startsWith('tan~ov')),
    'only the new overlays are added',
  );
});

/* --------------------------------------------------------- label collisions */

test('no two labels on a plot are printed on top of each other', async () => {
  // Every label site in plot.ts is chosen from local geometry and is right in
  // isolation; the phases never see each other. The benchmark render put "the
  // bottom" through the y-axis, "how wrong we are here" across the curve, and
  // "too small"/"too large" through each other. This is the pass that stops it.
  const sb = plotBoard({
    xLabel: 'w',
    yLabel: 'loss',
    curves: [{ id: 'bowl', label: 'loss', fn: { name: 'parabola', params: [1, 1, 0] } }],
    overlays: [
      { kind: 'point', curveId: 'bowl', x: 1, label: 'the bottom', at: 0.1 },
      { kind: 'point', curveId: 'bowl', x: 2.4, label: 'how wrong we are here', at: 0.2 },
      { kind: 'tangent', curveId: 'bowl', x: 2.4, span: 1, label: 'slope +2.8', at: 0.3 },
      { kind: 'annotate', x: 1, y: 1.2, text: 'uphill is right, so step left', at: 0.4 },
      { kind: 'annotate', x: 1, y: 2.6, text: 'the steps shrink as it flattens', at: 0.5 },
    ],
  });
  const boxes = (await items(sb)).flatMap((item) => textsOf(item)).map((t) => t.box);
  assert.ok(boxes.length >= 6, `expected the labels and both axis names, got ${boxes.length}`);

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(
        ox <= 0 || oy <= 0,
        `labels ${i} and ${j} overlap by ${ox.toFixed(1)}x${oy.toFixed(1)} units`,
      );
    }
  }

  // Dodging never pushes a label out of the element it belongs to.
  const el = sb.scenes[0]!.elements[0]!;
  for (const b of boxes) {
    assert.ok(
      b.x >= el.at.x - 1 &&
        b.y >= el.at.y - 1 &&
        b.x + b.w <= el.at.x + el.at.w + 1 &&
        b.y + b.h <= el.at.y + el.at.h + 1,
      `a label escaped the plot box: ${JSON.stringify(b)}`,
    );
  }
});

test('a ball riding a plot lands on the curve, not beside it', async () => {
  // The IR only tells an author that the plot occupies `at`, so every author maps
  // data space across the whole box. `plotMap` then insets that box for the axis
  // gutters. In the benchmark the descending ball was authored on the curve at
  // w = 3 and drawn below and left of it, ending up on the x-axis while the
  // renderer's own staircase stepped down the curve correctly.
  const el = {
    id: 'p',
    type: 'plot' as const,
    xDomain: [-2, 4] as [number, number],
    yDomain: [0, 15] as [number, number],
    xLabel: 'w',
    yLabel: 'loss',
    at: { x: 200, y: 120, w: 900, h: 500 },
    enter: { at: 0, duration: 0.5, style: 'draw' as const },
    curves: [{ id: 'bowl', fn: { name: 'parabola' as const, params: [1, 1, 0] } }],
  };
  // Where the author thinks (w, loss) = (3, 4) is: fractions of the full box.
  const fx = (3 - -2) / 6;
  const fy = 4 / 15;
  const authored = { x: el.at.x + fx * el.at.w, y: el.at.y + (1 - fy) * el.at.h };

  const sb = parseStoryboard({
    version: 1,
    title: 'ball',
    meta: { fps: 30, outroSec: 0 },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's',
        narration: 'the ball rolls down the loss curve to the bottom',
        durationSec: 6,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          el,
          {
            id: 'p_ball',
            type: 'path',
            at: { x: authored.x - 15, y: authored.y - 15, w: 30, h: 30 },
            enter: { at: 0.1, duration: 0.3, style: 'pop' },
            closed: true,
            fill: true,
            points: [
              { x: authored.x - 15, y: authored.y },
              { x: authored.x, y: authored.y - 15 },
              { x: authored.x + 15, y: authored.y },
              { x: authored.x, y: authored.y + 15 },
            ],
            motion: {
              path: [authored, { x: authored.x - 100, y: authored.y + 80 }],
              from: 0.3,
              to: 0.9,
              easing: 'ease-out',
              trail: false,
            },
          },
        ],
      },
    ],
  });

  const plan = await planWithVisuals(sb);
  const ball = plan.items.find((i) => i.id === 'p_ball');
  assert.ok(ball, 'the ball reached the plan');
  assert.ok(ball.motion, 'the ball still moves');

  // Where the plot actually puts (3, 4): through the inset plotting area, as solved
  // by the stage that owns the gutters.
  const truth = plotFrame(sb.scenes[0]!.elements[0]! as PlotElement, {
    canvasHeight: 1080,
  }).toCanvas({ x: 3, y: 4 });

  // The ball's start is on the curve, and much closer to it than the raw box guess.
  const start = {
    x: ball.center[0] + ball.motion.samples[0]![0],
    y: ball.center[1] + ball.motion.samples[0]![1],
  };
  const err = Math.hypot(start.x - truth.x, start.y - truth.y);
  const before = Math.hypot(authored.x - truth.x, authored.y - truth.y);
  assert.ok(before > 8, `nothing to fix: the gutters only shift by ${before.toFixed(1)} units`);
  assert.ok(
    err < 1,
    `the ball is ${err.toFixed(1)} units off the curve (was ${before.toFixed(1)})`,
  );
});

/* --------------------------------------------------- one name per axis */

/** Every text prim drawn for a plot, so labels can be counted by content. */
async function labelsOf(sb: Storyboard): Promise<string[]> {
  const out: string[] = [];
  for (const item of (await planWithVisuals(sb)).items) {
    for (const prim of item.prims) if (prim.kind === 'text') out.push((prim as TextPrim).text);
  }
  return out;
}

test('a lone curve does not add a second name to the vertical axis', async () => {
  // The benchmark labelled the axis "height" and the trace "loss" and left the
  // learner to work out whether those were the same measurement. With one curve both
  // are names for the vertical axis, so only the axis keeps its name.
  const labels = await labelsOf(
    plotBoard({
      xLabel: 'where you stand',
      yLabel: 'height',
      curves: [{ id: 'c', label: 'loss', fn: { name: 'parabola', params: [1, 0, 0.5] } }],
    }),
  );
  assert.ok(labels.includes('height'), 'the axis keeps its name');
  assert.ok(!labels.includes('loss'), `the curve label was drawn too: ${JSON.stringify(labels)}`);
});

test('several curves keep their labels, because those tell the traces apart', async () => {
  // Here the labels are doing real work and the axis names the quantity they share.
  const labels = await labelsOf(
    plotBoard({
      xLabel: 'where you stand',
      yLabel: 'height',
      curves: [
        { id: 'a', label: 'too small', fn: { name: 'parabola', params: [1, 0, 0.5] } },
        { id: 'b', label: 'too large', fn: { name: 'parabola', params: [2, 0, 0.5] } },
      ],
    }),
  );
  assert.ok(labels.includes('too small'), `lost a distinguishing label: ${JSON.stringify(labels)}`);
  assert.ok(labels.includes('too large'));
  assert.ok(labels.includes('height'), 'the axis still names the quantity');
});

/* ------------------------------------------------ the sidecar is the source */

test('plot geometry comes from the visuals stage, not from a second implementation', async () => {
  // Root cause 1's remaining half. The renderer used to call `resolvePlot` itself,
  // because the visuals stage had no camera and recorded geometry at a fraction of the
  // whole canvas — a factor of five on a framed board, and unusable rather than merely
  // mis-sized, since a plot measures its gutters and dot radii in caption widths.
  //
  // The assertion is that the drawn path data *is* the recorded path data. Not
  // "equivalent", not "close": the same strings, because there is now one resolution.
  const sb = plotBoard({ id: 'p', curves: [{ id: 'bowl', fn: { name: 'parabola' } }] });
  const { dir, sb: resolved } = await withVisuals(sb);
  const manifest = JSON.parse(await readFile(path.join(dir, 'assets', 'visuals.json'), 'utf8')) as {
    elements: Record<string, { strokes: { d: string }[] }>;
  };

  const recorded = manifest.elements.p?.strokes.map((s) => s.d) ?? [];
  assert.ok(recorded.length > 0, 'the visuals stage recorded no strokes for the plot');

  const drawn = compilePlan(resolved, dir)
    .items.filter((i) => i.id === 'p' || i.id.startsWith('p~'))
    .flatMap((i) => i.prims)
    .filter((p): p is GeomPrim => p.kind === 'geom')
    .map((p) => p.d);

  for (const d of drawn) {
    assert.ok(recorded.includes(d), `the renderer drew a path the sidecar does not hold`);
  }
});

test('a plot with no sidecar degrades to a labelled frame, not to nothing', async () => {
  // The renderer can no longer reconstruct a plot, so this is a real failure mode now
  // and it has to be visible. A missing plot leaves a caption in a void, which is the
  // thing this pipeline is least willing to ship; an unresolved asset has always drawn
  // an honest labelled frame and a plot now does the same.
  const sb = plotBoard({ id: 'p', curves: [{ id: 'bowl', fn: { name: 'parabola' } }] });
  const empty = await mkdtemp(path.join(tmpdir(), 'inkcast-no-visuals-'));
  const items = compilePlan(sb, empty).items.filter((i) => i.id === 'p' || i.id.startsWith('p~'));

  assert.equal(items.length, 1, 'exactly one placeholder item');
  const texts = items[0]!.prims.filter((p): p is TextPrim => p.kind === 'text');
  assert.equal(texts[0]?.text, 'p', 'the frame is labelled with the element id');
  assert.ok(
    items[0]!.prims.some((p) => p.kind === 'geom'),
    'the placeholder draws a frame, not just a word',
  );
});
