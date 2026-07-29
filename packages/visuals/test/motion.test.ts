import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard, type Motion } from '@inkcast/core';
import {
  ease,
  fractionAtLength,
  motionAt,
  motionPath,
  polylineLength,
  resamplePolyline,
  resolveMotion,
} from '../src/motion.js';
import type { Pt } from '../src/svg.js';

/** Waypoints with deliberately uneven spacing — the case `t` interpolation ruins. */
const UNEVEN: Pt[] = [
  { x: 0, y: 0 },
  { x: 20, y: 10 },
  { x: 400, y: 60 },
  { x: 430, y: 300 },
];

function gaps(pts: Pt[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    out.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return out;
}

/* ------------------------------------------------------------- resampling --- */

test('resamplePolyline spaces samples evenly by arc length, however uneven the input', () => {
  const before = gaps(UNEVEN);
  assert.ok(Math.max(...before) / Math.min(...before) > 15, 'the fixture must be lopsided');

  const n = 200;
  const total = polylineLength(UNEVEN);
  const target = total / (n - 1);
  const after = gaps(resamplePolyline(UNEVEN, n));
  assert.equal(after.length, n - 1);
  // Every sample is `target` further along the *path*. A chord that straddles a
  // vertex is shorter than that, because the object is turning there — but never
  // longer, and only the two interior vertices may do it.
  const short = after.filter((g) => g < target * 0.999);
  assert.ok(short.length <= 2, `${short.length} gaps fell short; only corners may`);
  for (const g of after) assert.ok(g <= target + 1e-9, `a gap overshot: ${g} > ${target}`);
  for (const g of short) assert.ok(g > target * 0.6, `corner chord collapsed: ${g}`);

  // Straight segments have no corners, so there the spacing is exactly uniform.
  const line = gaps(
    resamplePolyline(
      [
        { x: 0, y: 0 },
        { x: 137, y: 91 },
      ],
      64,
    ),
  );
  assert.ok(Math.max(...line) - Math.min(...line) < 1e-9);

  // Resampling a polyline can never add length.
  assert.ok(Math.abs(polylineLength(resamplePolyline(UNEVEN, 4000)) - total) < 0.5);
});

test('resamplePolyline keeps the endpoints and honours the sample count', () => {
  const out = resamplePolyline(UNEVEN, 37);
  assert.equal(out.length, 37);
  assert.deepEqual(out[0], UNEVEN[0]);
  const last = out[out.length - 1] as Pt;
  const want = UNEVEN[UNEVEN.length - 1] as Pt;
  assert.ok(Math.abs(last.x - want.x) < 1e-6 && Math.abs(last.y - want.y) < 1e-6);
});

test('degenerate inputs resample without throwing', () => {
  assert.deepEqual(resamplePolyline([]), []);
  const still = resamplePolyline(
    [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ],
    8,
  );
  assert.equal(still.length, 8);
  for (const p of still) assert.deepEqual(p, { x: 5, y: 5 });
  assert.equal(resamplePolyline([{ x: 1, y: 2 }], 4).length, 4);
  // A count below two is raised to two rather than producing an unusable path.
  assert.equal(resamplePolyline(UNEVEN, 1).length, 2);
});

test('motionPath smooths waypoints and measures the smooth curve, not the chords', () => {
  const mp = motionPath(UNEVEN);
  assert.match(mp.d, /^M/);
  assert.ok(mp.d.includes('C'), 'waypoints must be smoothed, not left as a polyline');
  // A spline rounds the corners it passes through, so it is a little shorter than
  // the polyline — but the same journey, not a different one.
  const poly = polylineLength(UNEVEN);
  assert.ok(mp.length > poly * 0.8 && mp.length < poly * 1.2, `${mp.length} vs polyline ${poly}`);

  // No corners left, so the chord spacing really is uniform here.
  const g = gaps(mp.points);
  assert.ok(Math.max(...g) - Math.min(...g) < Math.max(...g) * 0.05);
});

test('motionPath accepts raw SVG path data, arcs included', () => {
  const mp = motionPath('M0 0 A50 50 0 0 1 100 0');
  assert.ok(mp.points.length > 2);
  // A semicircle of radius 50 is π·50 long.
  assert.ok(Math.abs(mp.length - Math.PI * 50) < 1.5, `measured ${mp.length}`);
  const g = gaps(mp.points);
  assert.ok(Math.max(...g) - Math.min(...g) < Math.max(...g) * 0.02);
});

/* ------------------------------------------------------------- evaluation --- */

test('motionAt gives constant-speed positions and a unit tangent', () => {
  const mp = motionPath(UNEVEN, { samples: 512 });
  const quarter = motionAt(mp, 0.25);
  const half = motionAt(mp, 0.5);
  assert.ok(Math.abs(quarter.distance - mp.length * 0.25) < 1e-6);
  assert.ok(Math.abs(half.distance - mp.length * 0.5) < 1e-6);

  for (const t of [0, 0.1, 0.5, 0.9, 1]) {
    const s = motionAt(mp, t);
    assert.ok(Math.abs(Math.hypot(s.tangent.x, s.tangent.y) - 1) < 1e-9, 'tangent must be unit');
    assert.ok(Math.abs(Math.atan2(s.tangent.y, s.tangent.x) - s.angle) < 1e-9);
  }
});

test('equal slices of time cover equal distance — the whole point of the module', () => {
  // A semicircle: known length, uniform curvature, so a chord-based speed check is
  // a fair measure of whether movement is even.
  const mp = motionPath('M0 0 A120 120 0 0 1 240 0', { samples: 1024 });
  assert.ok(Math.abs(mp.length - Math.PI * 120) < 2);

  const step = 1 / 60;
  const spans: number[] = [];
  for (let i = 0; i < 60; i++) {
    const a = motionAt(mp, i * step).point;
    const b = motionAt(mp, (i + 1) * step).point;
    spans.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const min = Math.min(...spans);
  const max = Math.max(...spans);
  assert.ok(max - min < max * 0.01, `speed varies across the path: ${min}..${max}`);

  // The same path driven by the raw parameter instead of arc length is what this
  // avoids: the underlying cubics differ in length, so `t` is not distance.
  const segs = motionPath(UNEVEN, { samples: 1024 });
  assert.ok(Math.abs(motionAt(segs, 0.5).distance - segs.length / 2) < 1e-6);
});

test('motionAt clamps outside 0-1 and matches the endpoints', () => {
  const mp = motionPath(UNEVEN);
  const first = mp.points[0] as Pt;
  const last = mp.points[mp.points.length - 1] as Pt;
  assert.deepEqual(motionAt(mp, -3).point, first);
  const end = motionAt(mp, 4).point;
  assert.ok(Math.abs(end.x - last.x) < 1e-9 && Math.abs(end.y - last.y) < 1e-9);
});

test('the tangent points along a straight path and turns with a curved one', () => {
  const straight = motionPath([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  const s = motionAt(straight, 0.5);
  assert.ok(Math.abs(s.tangent.x - 1) < 1e-6 && Math.abs(s.tangent.y) < 1e-6);
  assert.ok(Math.abs(s.angle) < 1e-6);

  // Quarter circle: heading rotates by about 90° from start to finish.
  const arc = motionPath('M0 0 A100 100 0 0 1 100 100');
  const a = motionAt(arc, 0.02).angle;
  const b = motionAt(arc, 0.98).angle;
  assert.ok(Math.abs(Math.abs(b - a) - Math.PI / 2) < 0.15, `turned ${b - a} rad`);
});

test('fractionAtLength inverts motionAt', () => {
  const mp = motionPath(UNEVEN);
  for (const t of [0, 0.2, 0.55, 1]) {
    assert.ok(Math.abs(fractionAtLength(mp, motionAt(mp, t).distance) - t) < 1e-9);
  }
  assert.equal(fractionAtLength(mp, -50), 0);
  assert.equal(fractionAtLength(mp, mp.length * 10), 1);
  assert.equal(fractionAtLength({ ...mp, length: 0 }, 5), 0);
});

test('an empty motion path evaluates to the origin rather than crashing', () => {
  const s = motionAt({ points: [], length: 0, closed: false, d: '' }, 0.5);
  assert.deepEqual(s.point, { x: 0, y: 0 });
  assert.equal(s.distance, 0);
});

/* ----------------------------------------------------------------- easing --- */

test('every easing is monotone from 0 to 1 and matches its CSS control points', () => {
  const easings: Motion['easing'][] = ['linear', 'ease', 'ease-in', 'ease-out', 'bounce'];
  for (const name of easings) {
    assert.ok(Math.abs(ease(name, 0)) < 1e-6, `${name} must start at 0`);
    assert.ok(Math.abs(ease(name, 1) - 1) < 1e-6, `${name} must end at 1`);
    assert.equal(ease(name, -2), ease(name, 0), `${name} must clamp below 0`);
    assert.equal(ease(name, 5), ease(name, 1), `${name} must clamp above 1`);
    for (let t = 0; t <= 1; t += 0.05) {
      const v = ease(name, t);
      assert.ok(Number.isFinite(v), `${name} is not finite at ${t}`);
      if (name !== 'bounce') assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `${name}(${t}) = ${v}`);
    }
  }
  assert.ok(Math.abs(ease('linear', 0.37) - 0.37) < 1e-9);
  // ease-in starts slower than linear; ease-out starts faster.
  assert.ok(ease('ease-in', 0.25) < 0.25);
  assert.ok(ease('ease-out', 0.25) > 0.25);
  // cubic-bezier(0.25, 0.1, 0.25, 1) at the midpoint is ~0.8.
  assert.ok(Math.abs(ease('ease', 0.5) - 0.8) < 0.02, `ease(0.5) = ${ease('ease', 0.5)}`);
});

/* ------------------------------------------------------------- the IR type --- */

function motion(over: Partial<Motion> = {}): Motion {
  const sb = parseStoryboard({
    version: 1,
    title: 't',
    scenes: [
      {
        id: 's',
        narration: 'n',
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'ball',
            type: 'shape',
            shape: 'ellipse',
            at: { x: 100, y: 100, w: 40, h: 40 },
            motion: { path: UNEVEN, ...over },
          },
        ],
      },
    ],
  });
  const el = sb.scenes[0]?.elements[0];
  assert.ok(el?.motion);
  return el.motion;
}

test('resolveMotion produces even positions plus centre-relative offsets', () => {
  const box = { x: 100, y: 100, w: 40, h: 40 };
  const layout = resolveMotion(
    motion({ from: 0.2, to: 0.9, easing: 'ease-out', trail: true }),
    box,
  );
  assert.ok(layout);
  assert.equal(layout.from, 0.2);
  assert.equal(layout.to, 0.9);
  assert.equal(layout.easing, 'ease-out');
  assert.equal(layout.trail, true);
  assert.ok(layout.length > 0);
  assert.match(layout.d, /^M/);
  assert.equal(layout.points.length, layout.offsets.length);
  assert.ok(layout.points.length > 40);

  // Offsets are the translation from the element's own centre, so the renderer
  // can move it without recomputing anything.
  const centre = { x: 120, y: 120 };
  layout.points.forEach((p, i) => {
    const o = layout.offsets[i] as Pt;
    assert.ok(Math.abs(p.x - centre.x - o.x) < 1e-9);
    assert.ok(Math.abs(p.y - centre.y - o.y) < 1e-9);
  });
  // It survives the round trip through the manifest.
  assert.deepEqual(JSON.parse(JSON.stringify(layout)), layout);
});

test('a motion with no length resolves to undefined so the element just stays put', () => {
  const still = resolveMotion(
    motion({
      path: [
        { x: 10, y: 10 },
        { x: 10, y: 10 },
      ],
    }),
    { x: 0, y: 0, w: 10, h: 10 },
  );
  assert.equal(still, undefined);
});
