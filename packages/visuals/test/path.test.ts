import assert from 'node:assert/strict';
import test from 'node:test';
import { ctxFor, seedFrom } from '../src/geometry.js';
import {
  catmullRomPath,
  clipPolylineToBox,
  clipPolylineToRange,
  clipSegmentToBox,
  dedupePoints,
  resolvePath,
  simplifyPolyline,
} from '../src/path.js';
import { inkStyleFor, strokeWidthFor, type InkStyleName } from '../src/style.js';
import { parsePath, pathBBox, pathLength, samplePath, type Pt } from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const SEED = seedFrom('path-test');

const HILL: Pt[] = [
  { x: 100, y: 500 },
  { x: 220, y: 340 },
  { x: 340, y: 200 },
  { x: 460, y: 320 },
  { x: 600, y: 480 },
];

/** Every command a valid `d` may contain after normalisation. */
const VALID_D = /^M-?[\d.]+ -?[\d.]+( (?:[MLC]-?[\d.]+ -?[\d.]+( -?[\d.]+ -?[\d.]+){0,2}|Z))*$/;

function assertValidPathData(d: string, label: string): void {
  assert.ok(d.length > 0, `${label}: empty path data`);
  assert.match(d, /^M/, `${label}: must start with a moveto`);
  assert.ok(!/NaN|Infinity|undefined|null/.test(d), `${label}: non-numeric path data — ${d}`);
  assert.match(d, VALID_D, `${label}: not well-formed path data — ${d.slice(0, 120)}`);
  const segs = parsePath(d);
  assert.ok(segs.length >= 2, `${label}: no geometry`);
  for (const s of segs) {
    if (s.c === 'Z') continue;
    assert.ok(Number.isFinite(s.p.x) && Number.isFinite(s.p.y), `${label}: non-finite point`);
  }
  assert.ok(pathLength(d) > 0, `${label}: zero length`);
}

/* -------------------------------------------------------------- smoothing --- */

test('catmullRomPath produces valid cubic path data through every waypoint', () => {
  const d = catmullRomPath(HILL);
  assertValidPathData(d, 'hill');
  // One cubic per gap: interpolating, not approximating.
  assert.equal((d.match(/C/g) ?? []).length, HILL.length - 1);

  const ends = parsePath(d)
    .filter((s) => s.c === 'C' || s.c === 'M')
    .map((s) => (s.c === 'C' || s.c === 'M' ? s.p : undefined));
  HILL.forEach((want, i) => {
    const got = ends[i];
    assert.ok(got, `waypoint ${i} missing`);
    assert.ok(
      Math.abs(got.x - want.x) < 0.01 && Math.abs(got.y - want.y) < 0.01,
      `the spline must pass through waypoint ${i}`,
    );
  });
});

test('a smoothed path is genuinely smooth, not a polyline in disguise', () => {
  const smooth = samplePath(parsePath(catmullRomPath(HILL)));
  const poly = HILL;
  const turn = (pts: Pt[]): number => {
    let worst = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1] as Pt;
      const b = pts[i] as Pt;
      const c = pts[i + 1] as Pt;
      const a1 = Math.atan2(b.y - a.y, b.x - a.x);
      const a2 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      worst = Math.max(worst, d);
    }
    return worst;
  };
  // The polyline has a hard corner at the summit; the spline must not.
  assert.ok(turn(poly) > 0.7, 'the fixture should have a real corner to smooth');
  assert.ok(turn(smooth) < 0.25, `the spline still has a corner (${turn(smooth)} rad)`);
});

test('closed paths wrap and append Z; two points still work; one point degenerates safely', () => {
  const closed = catmullRomPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    { closed: true },
  );
  assertValidPathData(closed, 'closed');
  assert.match(closed, /Z$/);
  assert.equal((closed.match(/C/g) ?? []).length, 4, 'a closed loop needs one cubic per edge');

  const two = catmullRomPath([
    { x: 0, y: 0 },
    { x: 50, y: 60 },
  ]);
  assertValidPathData(two, 'two points');

  assert.equal(catmullRomPath([{ x: 3, y: 4 }]), 'M3 4');
  assert.equal(catmullRomPath([]), '');
});

test('duplicate and non-finite waypoints are dropped rather than flattening a segment', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: Number.NaN, y: 5 },
    { x: 10, y: 10 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ];
  assert.deepEqual(dedupePoints(pts), [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ]);
  assertValidPathData(catmullRomPath(pts), 'deduped');
});

/* ---------------------------------------------------------- simplification --- */

test('simplifyPolyline keeps the shape and drops the filler', () => {
  const dense: Pt[] = [];
  for (let i = 0; i <= 400; i++) {
    const x = -3 + (6 * i) / 400;
    dense.push({ x: x * 100, y: x * x * 40 });
  }
  const simple = simplifyPolyline(dense, 1.5);
  assert.ok(
    simple.length < dense.length / 6,
    `only dropped to ${simple.length} of ${dense.length}`,
  );
  assert.ok(simple.length > 4, 'oversimplified — the parabola would look like a V');
  assert.deepEqual(simple[0], dense[0]);
  assert.deepEqual(simple[simple.length - 1], dense[dense.length - 1]);

  // Nothing kept strays from the original polyline.
  const before = pathBBox(catmullRomPath(dense));
  const after = pathBBox(catmullRomPath(simple));
  assert.ok(Math.abs(before.w - after.w) < 4 && Math.abs(before.h - after.h) < 4);

  assert.deepEqual(simplifyPolyline(dense, 0), dense, 'epsilon 0 is a no-op');
  // 20k points must not blow the stack: RDP here is iterative on purpose.
  const huge: Pt[] = [];
  for (let i = 0; i < 20_000; i++) huge.push({ x: i, y: Math.sin(i / 900) * 50 });
  assert.ok(simplifyPolyline(huge, 0.5).length > 2);
});

/* ------------------------------------------------------------------ clipping */

test('clipSegmentToBox returns exactly the visible portion', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(clipSegmentToBox({ x: -50, y: 50 }, { x: 150, y: 50 }, box), [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ]);
  assert.deepEqual(clipSegmentToBox({ x: 20, y: 20 }, { x: 60, y: 60 }, box), [
    { x: 20, y: 20 },
    { x: 60, y: 60 },
  ]);
  assert.equal(clipSegmentToBox({ x: -10, y: -10 }, { x: -5, y: 200 }, box), undefined);
  // A diagonal leaving through the corner.
  const diag = clipSegmentToBox({ x: 50, y: 50 }, { x: 250, y: 250 }, box);
  assert.ok(diag);
  assert.ok(Math.abs(diag[1].x - 100) < 1e-9 && Math.abs(diag[1].y - 100) < 1e-9);
});

test('clipPolylineToBox splits a polyline that leaves and re-enters', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  const runs = clipPolylineToBox(
    [
      { x: 10, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: -40 },
      { x: 70, y: -40 },
      { x: 70, y: 50 },
      { x: 90, y: 50 },
    ],
    box,
  );
  assert.equal(runs.length, 2, 'the excursion must break the run in two');
  for (const run of runs) {
    for (const p of run) {
      assert.ok(p.x >= -1e-9 && p.x <= 100 + 1e-9 && p.y >= -1e-9 && p.y <= 100 + 1e-9);
    }
  }
});

test('clipPolylineToRange stops a curve exactly at the range edge', () => {
  const pts: Pt[] = [];
  for (let x = -3; x <= 3.0001; x += 0.05) pts.push({ x, y: x * x });
  const runs = clipPolylineToRange(pts, 0, 4);
  // A parabola is only inside y ≤ 4 for x ∈ [-2, 2]: one visible run, trimmed at
  // both ends rather than at whichever sample happened to fall outside.
  assert.equal(runs.length, 1);
  for (const run of runs) for (const p of run) assert.ok(p.y >= -1e-9 && p.y <= 4 + 1e-9);
  const crossings = runs.flat().filter((p) => Math.abs(p.y - 4) < 1e-9);
  assert.equal(crossings.length, 2, 'the curve should enter and leave exactly once each');
  for (const c of crossings) assert.ok(Math.abs(Math.abs(c.x) - 2) < 1e-6, `crossing at ${c.x}`);
});

test('clipPolylineToRange splits every excursion of an oscillating curve', () => {
  const pts: Pt[] = [];
  for (let x = 0; x <= 3.9001; x += 0.01) pts.push({ x, y: Math.sin(2 * Math.PI * x) });
  // Four positive lobes clipped to the upper half: four separate visible arcs.
  const runs = clipPolylineToRange(pts, 0, 1);
  assert.equal(runs.length, 4);
  for (const run of runs) {
    assert.ok(run.length > 10);
    for (const p of run) assert.ok(p.y >= -1e-9 && p.y <= 1 + 1e-9);
  }
});

/* ---------------------------------------------------------------- the lane --- */

const STYLES: InkStyleName[] = ['marker', 'pencil', 'chalk', 'ink'];

test('resolvePath draws points in every ink style and reports its own geometry', () => {
  for (const name of STYLES) {
    const s = inkStyleFor({ style: name, palette: 'color' });
    const resolved = resolvePath({ points: HILL, weight: 1 }, ctxFor(s, SEED));
    assert.ok(resolved, `${name}: nothing resolved`);
    assert.equal(resolved.from, 'points');
    assert.equal(resolved.closed, false);
    assert.equal(resolved.filled, false);
    assertValidPathData(resolved.d, `${name} source`);
    assert.ok(Math.abs(resolved.length - pathLength(resolved.d)) < 1e-6);
    assert.ok(resolved.paths.length > 0, `${name}: no strokes`);
    for (const p of resolved.paths) {
      assertValidPathData(p.d, `${name} stroke`);
      assert.equal(p.group, 'path');
      assert.ok(p.length > 0);
    }
  }
});

test('raw path data is accepted, normalised and roughened', () => {
  const resolved = resolvePath(
    { d: 'M10 10 h80 v40 a20 20 0 0 1 -40 0 q-20 -20 -40 0 z' },
    ctxFor(style, SEED),
  );
  assert.ok(resolved);
  assert.equal(resolved.from, 'd');
  assert.ok(resolved.paths.length > 0);
  for (const p of resolved.paths) assertValidPathData(p.d, 'raw d');
  assert.ok(resolved.length > 0);
});

test('points win over d, and neither means nothing to draw', () => {
  const both = resolvePath({ points: HILL, d: 'M0 0 L10 10' }, ctxFor(style, SEED));
  assert.ok(both);
  assert.equal(both.from, 'points');
  assert.equal(resolvePath({}, ctxFor(style, SEED)), undefined);
  assert.equal(resolvePath({ d: '   ' }, ctxFor(style, SEED)), undefined);
  // A single waypoint is not a stroke, and must not throw.
  assert.equal(resolvePath({ points: [{ x: 1, y: 2 }] }, ctxFor(style, SEED)), undefined);
});

test('closed forces a Z on raw data too, and fill produces filled strokes', () => {
  const closed = resolvePath({ d: 'M0 0 L100 0 L100 100', closed: true }, ctxFor(style, SEED));
  assert.ok(closed);
  assert.match(closed.d, /Z$/);

  const filled = resolvePath({ points: HILL, closed: true, fill: true }, ctxFor(style, SEED));
  assert.ok(filled);
  assert.equal(filled.filled, true);
  assert.ok(
    filled.paths.some((p) => p.fill !== 'none') || filled.paths.length > 1,
    'a filled path should emit fill geometry',
  );
});

test('weight multiplies the ink style stroke width exactly', () => {
  const base = strokeWidthFor(style, 'normal');
  for (const weight of [0.5, 1, 1.8, 3]) {
    const resolved = resolvePath({ points: HILL, weight }, ctxFor(style, SEED));
    assert.ok(resolved);
    const widest = Math.max(...resolved.paths.map((p) => p.strokeWidth));
    assert.ok(
      Math.abs(widest - base * weight) < 1e-6,
      `weight ${weight} gave ${widest}, expected ${base * weight}`,
    );
  }
  // A nonsense weight falls back to 1 instead of producing an invisible stroke.
  const bad = resolvePath({ points: HILL, weight: 0 }, ctxFor(style, SEED));
  assert.ok(bad);
  assert.ok(Math.abs((bad.paths[0]?.strokeWidth ?? 0) - base) < 1e-6);
});

test('the same path resolves identically twice — the seed is honoured', () => {
  const a = resolvePath({ points: HILL }, ctxFor(style, SEED));
  const b = resolvePath({ points: HILL }, ctxFor(style, SEED));
  assert.deepEqual(
    a?.paths.map((p) => p.d),
    b?.paths.map((p) => p.d),
  );
});
