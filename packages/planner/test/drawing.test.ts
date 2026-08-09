import assert from 'node:assert/strict';
import test from 'node:test';
import type { Element, Mark } from '@inkcast/core';
import { DRAW_H, DRAW_W } from '@inkcast/core';
import {
  buildDrawing,
  cleanMarks,
  fitCanvas,
  fitDrawing,
  markBounds,
  repairLabels,
  MAX_MARKS,
} from '../src/drawing.js';
import { labelFootprint } from '../src/draw-geom.js';
import { auditDrawing } from '../src/draw-audit.js';

const BOX = { x: 100, y: 200, w: 800, h: 400 };

const mark = (m: Partial<Mark> & { id: string; kind: Mark['kind'] }): Mark => ({
  closed: false,
  smooth: false,
  dashed: false,
  ...m,
});

/** A small honest drawing: a box, a stroke through it, and a label beside it. */
const DRAWING: Mark[] = [
  mark({ id: 'cell', kind: 'rect', x: 100, y: 100, w: 400, h: 300 }),
  mark({
    id: 'gap',
    kind: 'line',
    points: [
      [300, 100],
      [300, 400],
    ],
  }),
  mark({
    id: 'ion',
    kind: 'arrow',
    points: [
      [200, 250],
      [420, 250],
    ],
  }),
  mark({ id: 'cell-label', kind: 'label', x: 300, y: 60, text: 'the cell', size: 30 }),
];

test('a drawing becomes ordinary elements, one per mark, named for its part', () => {
  const els = buildDrawing(DRAWING, { id: 'b1_v0', box: BOX });
  assert.equal(els.length, 4);
  assert.deepEqual(
    els.map((e) => e.id),
    ['b1_v0_cell', 'b1_v0_gap', 'b1_v0_ion', 'b1_v0_cell-label'],
  );
  // The part's own name survives into the element id, which is what lets a later beat
  // or an emphasis address `gap` rather than "the third stroke".
  assert.deepEqual(
    els.map((e) => e.type),
    ['shape', 'path', 'arrow', 'text'],
  );
  // Drawn in the order they were placed, spread across the beat rather than at once.
  const times = els.map((e) => e.enter.at);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i]! > times[i - 1]!, 'marks do not arrive in drawing order');
  }
  assert.ok(times[times.length - 1]! < 0.8, 'the last mark lands too late in the beat');
});

test('a drawing is fitted into its box by its own content, uniformly', () => {
  const els = buildDrawing(DRAWING, { id: 'b1_v0', box: BOX });
  const x0 = Math.min(...els.map((e) => e.at.x));
  const y0 = Math.min(...els.map((e) => e.at.y));
  const x1 = Math.max(...els.map((e) => e.at.x + e.at.w));
  const y1 = Math.max(...els.map((e) => e.at.y + e.at.h));
  // Inside the box it was given — a drawing that overflowed would land on the beat below.
  assert.ok(x0 >= BOX.x - 40 && x1 <= BOX.x + BOX.w + 40, `${x0}..${x1} left the box`);
  assert.ok(y0 >= BOX.y - 40 && y1 <= BOX.y + BOX.h + 40, `${y0}..${y1} left the box`);

  // And it fills it: content bounds, not canvas bounds, is what makes a drawing that
  // used a corner of its canvas still fill the cell.
  const fit = fitDrawing(DRAWING, BOX);
  assert.ok(fit.s > 0.8, `content-fitted drawings should not be shrunk: ${fit.s}`);

  // Uniform, because a stretched drawing of anything looks wrong. One scale, both axes.
  const wide = buildDrawing(DRAWING, { id: 'x', box: { x: 0, y: 0, w: 4000, h: 400 } });
  const rect = wide.find((e) => e.id === 'x_cell')!;
  assert.ok(
    Math.abs(rect.at.w / rect.at.h - 400 / 300) < 0.02,
    'the drawing was stretched to fill a wide box',
  );
});

test('two labels are moved apart in the authoring geometry', () => {
  // The defect that showed up in every panel of the twelve-subject breadth test, and the
  // one that is never what anyone meant: two names written on top of each other.
  //
  // What this proves and no more: apartness in `markBounds` space, which for a label is
  // `labelBox` — one unwrapped line at the author's own cap height. That is *not* the
  // space the words are drawn in, and for a whole session this assertion was read as if it
  // covered the frame. It does not. The test below is the one that covers the frame.
  const stacked = [
    mark({ id: 'outline', kind: 'rect', x: 0, y: 0, w: 900, h: 500 }),
    mark({ id: 'a', kind: 'label', x: 400, y: 250, text: 'right atrium', size: 30 }),
    mark({ id: 'b', kind: 'label', x: 410, y: 255, text: 'bicuspid valve', size: 30 }),
  ];
  const out = repairLabels(stacked);
  const a = markBounds(out[1] as Mark)!;
  const b = markBounds(out[2] as Mark)!;
  const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  assert.ok(apart, 'two labels were left on top of each other');
});

/**
 * `cardiac8`'s spark beat, verbatim from `projects/cardiac8/lesson.json` steps[1].
 *
 * Kept whole rather than reduced to the two labels, because the repair's choice is made
 * against the beat's ink: with the ink removed it sidesteps downward and the defect does
 * not reproduce. This is the drawing behind the frame at ~51.5s of `projects/cardiac8`.
 */
const SPARK_BEAT: Mark[] = [
  mark({ id: 'left-atrium', kind: 'rect', x: 110, y: 60, w: 330, h: 190 }),
  mark({ id: 'right-atrium', kind: 'rect', x: 540, y: 60, w: 330, h: 190 }),
  mark({ id: 'left-atrium-hatch', kind: 'hatch', x: 110, y: 60, w: 330, h: 190, angle: 35 }),
  mark({ id: 'right-atrium-hatch', kind: 'hatch', x: 540, y: 60, w: 330, h: 190, angle: 35 }),
  mark({
    id: 'wave-front-1',
    kind: 'stroke',
    smooth: true,
    points: [
      [870, 70],
      [760, 90],
      [660, 130],
      [560, 170],
      [470, 190],
    ],
  }),
  mark({
    id: 'wave-front-2',
    kind: 'stroke',
    smooth: true,
    points: [
      [870, 110],
      [790, 140],
      [700, 175],
      [610, 210],
      [520, 225],
    ],
  }),
  mark({ id: 'spark-origin', kind: 'dots', x: 830, y: 60, w: 50, h: 40, count: 10 }),
  mark({
    id: 'valve-left',
    kind: 'stroke',
    points: [
      [220, 250],
      [260, 270],
      [300, 250],
    ],
  }),
  mark({
    id: 'valve-right',
    kind: 'stroke',
    points: [
      [650, 250],
      [690, 270],
      [730, 250],
    ],
  }),
  mark({ id: 'left-ventricle', kind: 'rect', x: 140, y: 320, w: 270, h: 190 }),
  mark({ id: 'right-ventricle', kind: 'rect', x: 570, y: 320, w: 270, h: 190 }),
  mark({
    id: 'flow-arrow-left',
    kind: 'arrow',
    points: [
      [260, 220],
      [260, 320],
    ],
  }),
  mark({
    id: 'flow-arrow-right',
    kind: 'arrow',
    points: [
      [690, 220],
      [690, 320],
    ],
  }),
  mark({
    id: 'label-atria',
    kind: 'label',
    x: 475,
    y: 30,
    size: 28,
    text: 'atria (spark spreads sideways)',
  }),
  mark({
    id: 'label-spark-origin',
    kind: 'label',
    x: 770,
    y: 10.88,
    size: 26,
    text: 'spark starts here',
  }),
  mark({
    id: 'arrow-spark-origin',
    kind: 'arrow',
    points: [
      [870, 50],
      [860, 70],
    ],
  }),
  mark({ id: 'label-valves', kind: 'label', x: 475, y: 275, size: 26, text: 'open valves' }),
  mark({
    id: 'label-ventricles',
    kind: 'label',
    x: 475,
    y: 540,
    size: 28,
    text: 'ventricles (fill with blood)',
  }),
];

/** The cell `cardiac8` gave that beat: `fitCanvas` lands it at exactly the shipped fit. */
const SPARK_CELL = { x: 3444.46, y: 405.03, w: 607.09, h: 339.97 };

test('a label the repair cleared is still clear once it is drawn', () => {
  // The frame at ~51.5s of `projects/cardiac8/out.mp4` reads "atria (spark spreadsspark
  // starts here": the two names are typed through each other, and `repairLabels` had
  // already run and reported success. It moved `label-spark-origin` from x 770 to x 828.24
  // and scored the pair 20 authoring units clear — in `labelBox` space, where the first
  // label is 436.8 x 39.2. The board drew it at 343.5 x 59 and the second at 291 x 29,
  // overlapping by 102.80 x 29.00 canvas units. The measurement error was larger than
  // the clearance it bought by an order of magnitude.
  //
  // So the assertion is made where the viewer is: on the boxes that reach the storyboard.
  const els = buildDrawing(SPARK_BEAT, { id: 'b3_v0', box: SPARK_CELL, underlay: true });
  assert.equal(fitCanvas(SPARK_CELL).s.toFixed(5), '0.60709', 'the shipped fit was not reproduced');
  const text = els.filter((e) => e.type === 'text');
  assert.equal(text.length, 4, 'the beat should draw four names');
  for (let i = 0; i < text.length; i++) {
    for (let j = i + 1; j < text.length; j++) {
      const a = (text[i] as Element).at;
      const b = (text[j] as Element).at;
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(
        w <= 0 || h <= 0,
        `${text[i]?.id} and ${text[j]?.id} are drawn through each other, by ${w.toFixed(2)}x${h.toFixed(2)}`,
      );
    }
  }
});

test('the box the repair reserves for a label is the box the builder draws it in', () => {
  // A guard, not a reproduction: this passes unchanged against the commit the bug shipped
  // from, because `labelFootprint` and `buildMark` were written together and have never
  // disagreed. The invariant that was actually absent is repairLabels-vs-builder, which is
  // the test above. This one pins the seam that makes that test's fix possible — if
  // `labelFootprint` ever stops reproducing the label branch of `buildMark`, the repair
  // goes back to reserving a box the words do not occupy and the frames go back to showing
  // collisions that every number in the repo calls clean.
  const cell = { x: 0, y: 0, w: 700, h: 392 };
  const fit = fitCanvas(cell);
  const cases: Mark[] = [
    // Wraps: 30 characters at a 280-unit cap.
    mark({
      id: 'wrapped',
      kind: 'label',
      x: 500,
      y: 300,
      size: 28,
      text: 'atria (spark spreads sideways)',
    }),
    // One short word, which the 80-unit floor in `measureText` decides rather than the text.
    mark({ id: 'short', kind: 'label', x: 300, y: 200, size: 30, text: 'N' }),
    // Either side of the caption/label boundary `roleFor` snaps at.
    mark({ id: 'smaller', kind: 'label', x: 400, y: 120, size: 34, text: 'bundle of His' }),
    mark({ id: 'larger', kind: 'label', x: 400, y: 460, size: 44, text: 'bundle of His' }),
  ];
  for (const m of cases) {
    const [el] = buildDrawing([m], { id: 't', box: cell, underlay: true });
    assert.ok(el && el.type === 'text', `${m.id} did not build`);
    const reserved = labelFootprint(m, fit.s);
    // Compared in board units, which is where the collision happens.
    assert.ok(
      Math.abs(reserved.w * fit.s - el.at.w) <= 1,
      `${m.id}: reserved ${(reserved.w * fit.s).toFixed(2)} wide, drew ${el.at.w}`,
    );
    assert.ok(
      Math.abs(reserved.h * fit.s - el.at.h) <= 1,
      `${m.id}: reserved ${(reserved.h * fit.s).toFixed(2)} tall, drew ${el.at.h}`,
    );
  }
});

test('a label is moved off small ink, and left alone inside the shape it names', () => {
  const onAPart = [
    mark({ id: 'outline', kind: 'rect', x: 0, y: 0, w: 900, h: 500 }),
    mark({ id: 'valve', kind: 'ellipse', x: 400, y: 220, w: 60, h: 60 }),
    mark({ id: 'name', kind: 'label', x: 430, y: 250, text: 'valve', size: 30 }),
  ];
  const moved = repairLabels(onAPart)[2] as Mark;
  const after = markBounds(moved)!;
  const part = markBounds(onAPart[1] as Mark)!;
  const clear =
    after.y + after.h <= part.y ||
    after.y >= part.y + part.h ||
    after.x + after.w <= part.x ||
    after.x >= part.x + part.w;
  assert.ok(clear, 'the label is still burying the part it names');

  // But the big containing outline is not an obstacle. Treating it as one makes every
  // position busy, the search fails, and the label is left exactly where it started —
  // which is why the first version of this repaired nothing on a real drawing.
  const inside = [
    mark({ id: 'outline', kind: 'rect', x: 0, y: 0, w: 900, h: 500 }),
    mark({ id: 'name', kind: 'label', x: 450, y: 250, text: 'the heart', size: 30 }),
  ];
  assert.deepEqual(repairLabels(inside)[1], inside[1]);
});

test('a label is moved off a long arrow, which a bounding box could never see', () => {
  // The case the area cap got wrong every time it mattered. An arrow across the drawing has
  // a bounding box covering the drawing, so the old rule — ink under a fifth of the drawing
  // is an obstacle — classified it as scenery and left every label lying on it. The frames
  // showed labels crowding arrows for three sessions because of it.
  const onALeader = [
    mark({
      id: 'flow',
      kind: 'arrow',
      points: [
        [60, 60],
        [940, 500],
      ],
    }),
    mark({ id: 'name', kind: 'label', x: 500, y: 280, text: 'blood flow', size: 30 }),
  ];
  const moved = repairLabels(onALeader)[1] as Mark;
  assert.notDeepEqual(moved, onALeader[1], 'the label was left lying along the arrow');
  assert.deepEqual(auditDrawing([onALeader[0] as Mark, moved]), []);
});

test('a repair never throws a label off the canvas to make a number better', () => {
  // Measured, and the reason the weights are what they are. The first scored version
  // weighted displacement at almost nothing: across the 41 cached drawings it removed every
  // label collision by flinging labels up to 180 units off the canvas, where they named
  // nothing and shrank the fitted picture to make room for them. 713 raw down to 48, and
  // all 48 were labels the repair itself had marooned.
  const crowded: Mark[] = [
    ...Array.from({ length: 12 }, (_, i) =>
      mark({
        id: `line-${i}`,
        kind: 'line',
        points: [
          [40, 40 + i * 40],
          [960, 40 + i * 40],
        ],
      }),
    ),
    mark({ id: 'name', kind: 'label', x: 500, y: 280, text: 'somewhere in here', size: 30 }),
  ];
  const placed = repairLabels(crowded).find((m) => m.kind === 'label') as Mark;
  const box = markBounds(placed)!;
  assert.ok(
    box.x >= -DRAW_W * 0.05 && box.x + box.w <= DRAW_W * 1.05,
    `the label was pushed to ${box.x.toFixed(0)}..${(box.x + box.w).toFixed(0)}, outside the canvas`,
  );
  assert.ok(
    box.y >= -DRAW_H * 0.05 && box.y + box.h <= DRAW_H * 1.05,
    `the label was pushed to ${box.y.toFixed(0)}..${(box.y + box.h).toFixed(0)}, outside the canvas`,
  );
});

test("the drawing's own title is dropped before it reaches the board", () => {
  // The beat's idea is already written above the cell, so a self-titled drawing puts two
  // captions on one panel — and the title, being the biggest mark, lands across the
  // picture. Four of twelve breadth-test subjects did this.
  const titled = cleanMarks([
    mark({ id: 'grid', kind: 'rect', x: 100, y: 200, w: 600, h: 300 }),
    mark({ id: 'title', kind: 'label', x: 400, y: 40, text: 'Matrix Multiplication', size: 48 }),
    mark({ id: 'n-pole', kind: 'label', x: 150, y: 40, text: 'N', size: 48 }),
  ]);
  assert.deepEqual(
    titled.map((m) => m.id),
    ['grid', 'n-pole'],
    'a big one-word label inside a diagram is not a title',
  );
});

test('a label with nothing under it is left exactly where the author put it', () => {
  const same = repairLabels(DRAWING);
  assert.deepEqual(same[3], DRAWING[3]);
});

test('marks with no geometry are dropped, ids are unique, and the count is capped', () => {
  const messy: Mark[] = [
    mark({ id: 'ok', kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    mark({ id: 'nothing', kind: 'rect' }),
    mark({ id: 'empty-label', kind: 'label', x: 5, y: 5, text: '   ' }),
    mark({ id: 'ok', kind: 'ellipse', x: 20, y: 0, w: 10, h: 10 }),
  ];
  const clean = cleanMarks(messy);
  assert.deepEqual(
    clean.map((m) => m.id),
    ['ok', 'ok-1'],
  );
  const many = Array.from({ length: 80 }, (_, i) =>
    mark({ id: `m${i}`, kind: 'rect', x: i, y: 0, w: 5, h: 5 }),
  );
  assert.equal(cleanMarks(many).length, MAX_MARKS);
});

test('an empty or undrawable drawing produces nothing, so the caller can fall back', () => {
  assert.deepEqual(buildDrawing([], { id: 'b', box: BOX }), []);
  assert.deepEqual(buildDrawing([mark({ id: 'x', kind: 'rect' })], { id: 'b', box: BOX }), []);
});

test('the drawing canvas is landscape, matching the hole a beat leaves for a picture', () => {
  // Not decoration: a drawing authored at 4:3 fits a 2.4:1 figure box by height and
  // leaves a third of the cell blank on either side. Measured at 17% frame fill.
  assert.ok(DRAW_W / DRAW_H > 1.5, 'the canvas stopped being landscape');
});

test('a stroke keeps its corners when it is not smooth, and loses them when it is', () => {
  const zig = mark({
    id: 'zig',
    kind: 'stroke',
    points: [
      [0, 0],
      [50, 100],
      [100, 0],
      [150, 100],
    ],
  });
  const [angular] = buildDrawing([zig], { id: 'b', box: BOX });
  assert.ok(angular && angular.type === 'path');
  // Explicit path data, because the waypoint lane splines every corner into a curve —
  // which would turn a zigzag into a wave.
  assert.ok(angular.d?.startsWith('M'), 'an angular stroke was not emitted as path data');
  assert.equal(angular.points, undefined);

  const [curved] = buildDrawing([{ ...zig, smooth: true }], { id: 'b', box: BOX });
  assert.ok(curved && curved.type === 'path');
  assert.ok((curved.points?.length ?? 0) >= 4, 'a smooth stroke lost its waypoints');
});
