import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mark } from '@inkcast/core';
import { DRAW_H, DRAW_W } from '@inkcast/core';
import {
  buildDrawing,
  cleanMarks,
  fitDrawing,
  markBounds,
  repairLabels,
  MAX_MARKS,
} from '../src/drawing.js';
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

test('two labels never overlap each other', () => {
  // The defect that showed up in every panel of the twelve-subject breadth test, and the
  // one that is never what anyone meant: two names written on top of each other.
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
