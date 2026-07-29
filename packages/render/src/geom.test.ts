/**
 * The geometry helpers, on their own.
 *
 * These are small and boring and every one of them is load-bearing somewhere the
 * failure is expensive: a mis-measured path is ink framed out of shot, a bad clip is
 * a tangent running off the board, a wrong union area is a "full" board that is
 * actually empty.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundsOfPoints,
  circlePath,
  clipSegment,
  flattenPathData,
  polylineLength,
  unionArea,
  unionRects,
} from './geom.js';
import type { Pt } from './geom.js';

test('bounds and unions cope with empty, single and degenerate input', () => {
  assert.equal(boundsOfPoints([]), null);
  assert.deepEqual(boundsOfPoints([[5, 7]]), { x: 5, y: 7, w: 0, h: 0 });
  assert.deepEqual(
    boundsOfPoints([
      [5, 7],
      [1, 9],
    ]),
    { x: 1, y: 7, w: 4, h: 2 },
  );
  // NaN from a malformed storyboard must not poison the framing.
  assert.deepEqual(
    boundsOfPoints([
      [Number.NaN, 0],
      [2, 4],
    ]),
    { x: 2, y: 4, w: 0, h: 0 },
  );

  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 20, y: 5, w: 10, h: 10 };
  assert.deepEqual(unionRects(a, null), a);
  assert.deepEqual(unionRects(null, b), b);
  assert.equal(unionRects(null, null), null);
  assert.deepEqual(unionRects(a, b), { x: 0, y: 0, w: 30, h: 15 });
});

test('union area counts overlapping content once', () => {
  const one = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(unionArea([one]), 100);
  assert.equal(unionArea([one, one]), 100, 'a label on a plot is not twice the ink');
  assert.equal(unionArea([one, { x: 5, y: 0, w: 10, h: 10 }]), 150);
  assert.equal(unionArea([one, { x: 20, y: 20, w: 10, h: 10 }]), 200);
  assert.equal(unionArea([]), 0);
  assert.equal(unionArea([{ x: 0, y: 0, w: 0, h: 5 }]), 0);
});

test('a segment is clipped to the box it belongs to', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  const inside = clipSegment([10, 10], [90, 90], box);
  assert.deepEqual(inside, [
    [10, 10],
    [90, 90],
  ]);

  const crossing = clipSegment([-50, 50], [150, 50], box);
  assert.deepEqual(crossing, [
    [0, 50],
    [100, 50],
  ]);

  const half = clipSegment([50, 50], [50, 500], box);
  assert.deepEqual(half, [
    [50, 50],
    [50, 100],
  ]);

  assert.equal(clipSegment([200, 200], [300, 300], box), null, 'entirely outside');
  assert.equal(clipSegment([-10, 50], [-5, 50], box), null);
});

test('a circle is a closed path measurable by the browser', () => {
  const d = circlePath(10, 20, 5);
  assert.match(d, /^M5 20C/);
  assert.match(d, /Z$/);
  const pts = flattenPathData(d).flat();
  const box = boundsOfPoints(pts);
  assert.ok(box);
  assert.ok(Math.abs(box.w - 10) < 0.2 && Math.abs(box.h - 10) < 0.2, 'diameter 10');
  assert.ok(Math.abs(box.x - 5) < 0.2 && Math.abs(box.y - 15) < 0.2);
});

test('path flattening measures the shapes the visuals stage emits', () => {
  // A roughened stroke: cubic béziers with implicit repeated commands.
  const subs = flattenPathData('M0 0 C 10 -20 30 -20 40 0 30 20 10 20 0 0');
  assert.equal(subs.length, 1);
  const pts = subs[0] as Pt[];
  assert.deepEqual(pts[0], [0, 0]);
  assert.ok(pts.length > 20, 'both curves are sampled');
  const box = boundsOfPoints(pts);
  assert.ok(box && box.w > 39 && box.h > 25, `measured ${JSON.stringify(box)}`);
  assert.ok(polylineLength(pts) > 80);

  // Garbage in, empty out — never a throw and never a NaN box.
  assert.deepEqual(flattenPathData(''), []);
  assert.deepEqual(flattenPathData('not a path'), []);
  assert.deepEqual(flattenPathData('M10 10'), [], 'a lone moveto draws nothing');
});
