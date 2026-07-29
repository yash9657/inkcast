/**
 * Motion, and the arc-length geometry underneath it.
 *
 * The property that matters is even speed: an element moving along waypoints must
 * cover equal distance in equal time, not equal *segments* in equal time. A ball
 * that sprints down the long flank of a curve and crawls across the short one
 * teaches the wrong thing about a gradient.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard } from '@inkcast/core';
import { compilePlan } from './compile.js';
import { lessonStoryboard } from './fixture.js';
import {
  cumulativeLengths,
  dashAlong,
  easeFn,
  flattenPathData,
  pointAtLength,
  polylineLength,
  resampleEven,
} from './geom.js';
import type { Pt } from './geom.js';
import type { MotionTrack } from './types.js';

const DIR = '/tmp/inkcast-motion-test';

/** A path whose segments are deliberately very unequal. */
const UNEVEN: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 900, y: 0 },
  { x: 940, y: 40 },
  { x: 1000, y: 400 },
];

function movingBoard(motion: Record<string, unknown>): ReturnType<typeof parseStoryboard> {
  return parseStoryboard({
    version: 1,
    title: 'motion',
    meta: { fps: 30, outroSec: 0 },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's',
        narration: 'it rolls downhill',
        durationSec: 4,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          {
            id: 'ball',
            type: 'shape',
            shape: 'ellipse',
            at: { x: -40, y: -40, w: 80, h: 80 },
            enter: { at: 0, duration: 0.3, style: 'pop' },
            motion,
          },
        ],
      },
    ],
  });
}

function trackOf(motion: Record<string, unknown>): MotionTrack {
  const plan = compilePlan(movingBoard(motion), DIR);
  const item = plan.items.find((i) => i.id === 'ball');
  assert.ok(item?.motion, 'the ball should carry a baked motion track');
  return item.motion;
}

/** Distance between consecutive baked positions. */
function steps(track: MotionTrack): number[] {
  const out: number[] = [];
  for (let i = 1; i < track.samples.length; i++) {
    const a = track.samples[i - 1] as [number, number, number];
    const b = track.samples[i] as [number, number, number];
    out.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

test('arc length is measured along the polyline, not by segment index', () => {
  const pts: Pt[] = UNEVEN.map((p) => [p.x, p.y]);
  const cum = cumulativeLengths(pts);
  const total = polylineLength(pts);
  assert.ok(Math.abs(total - (900 + Math.hypot(40, 40) + Math.hypot(60, 360))) < 1e-9);

  // Halfway by distance is still on the long first segment, not at waypoint 2.
  const mid = pointAtLength(pts, cum, total / 2);
  assert.ok(Math.abs(mid[1]) < 1e-9, 'the midpoint by distance is on the flat run');
  assert.ok(Math.abs(mid[0] - total / 2) < 1e-9);

  assert.deepEqual(pointAtLength(pts, cum, -50), [0, 0], 'clamped at the start');
  assert.deepEqual(pointAtLength(pts, cum, total + 50), [1000, 400], 'clamped at the end');
});

test('resampling by arc length gives evenly spaced samples', () => {
  const pts: Pt[] = UNEVEN.map((p) => [p.x, p.y]);
  const even = resampleEven(pts, 40);
  const gaps = [];
  for (let i = 1; i < even.length; i++) {
    const a = even[i - 1] as Pt;
    const b = even[i] as Pt;
    gaps.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  // Chords across a corner are a little shorter than the arc; everything else is
  // identical to within floating point.
  assert.ok(max - min < max * 0.12, `even spacing, got ${min}..${max}`);
  assert.ok(even.length > 20);
});

test('a linear motion moves at constant speed over unequal segments', () => {
  const track = trackOf({ path: UNEVEN, from: 0, to: 1, easing: 'linear' });
  const total = polylineLength(UNEVEN.map((p) => [p.x, p.y] as Pt));
  const us = track.samples.map((s) => s[2]);
  assert.ok(us.length > 100, `one sample per frame, got ${us.length}`);
  assert.equal(us[0], 0);
  assert.equal(us.at(-1), 1);

  // Distance along the path per frame — the thing that has to be constant.
  const advance: number[] = [];
  for (let i = 1; i < us.length; i++) {
    const d = ((us[i] as number) - (us[i - 1] as number)) * total;
    assert.ok(d > 0, 'progress never stalls or reverses');
    advance.push(d);
  }
  const min = Math.min(...advance);
  const max = Math.max(...advance);
  assert.ok(max - min < max * 0.005, `constant speed along the path, got ${min}..${max}`);

  // Straight-line distance between frames agrees, apart from frames that cut a
  // corner — where the chord is legitimately shorter than the arc walked.
  const chords = steps(track);
  assert.ok(Math.max(...chords) - Math.min(...chords) < Math.max(...chords) * 0.1);

  // And the guard against the bug this replaces: halfway in *time* is halfway in
  // *distance*, which on this path is nowhere near the middle waypoint.
  // The ball's `at` centre is the origin, so its offsets are absolute positions.
  const half = track.samples[Math.round((us.length - 1) / 2)] as [number, number, number];
  assert.ok(Math.abs(half[0] - total / 2) < total * 0.01, `halfway by distance, got ${half[0]}`);
  assert.ok(Math.abs(half[1]) < 1, 'still on the long flat run, not at waypoint 2');
});

test('easing changes the speed profile but never the path or the endpoints', () => {
  const linear = trackOf({ path: UNEVEN, easing: 'linear' });
  const eased = trackOf({ path: UNEVEN, easing: 'ease' });
  assert.deepEqual(eased.samples[0], linear.samples[0], 'both start where the path starts');
  assert.deepEqual(eased.samples.at(-1), linear.samples.at(-1), 'and end where it ends');

  const gaps = steps(eased);
  const first = gaps[0] as number;
  const middle = gaps[Math.floor(gaps.length / 2)] as number;
  assert.ok(middle > first * 2, 'ease-in-out starts slowly and accelerates');

  for (const name of ['linear', 'ease', 'ease-in', 'ease-out', 'bounce'] as const) {
    const fn = easeFn(name);
    assert.ok(Math.abs(fn(0)) < 1e-9, `${name} starts at 0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name} ends at 1`);
  }
});

test('the element is already on its path before the motion starts', () => {
  // `at` is nowhere near the path, so an unbaked start offset would make the ball
  // jump the moment the move begins.
  const track = trackOf({ path: UNEVEN, from: 0.5, to: 1 });
  const plan = compilePlan(movingBoard({ path: UNEVEN, from: 0.5, to: 1 }), DIR);
  const item = plan.items.find((i) => i.id === 'ball');
  assert.ok(item);
  assert.ok(track.start > item.start, 'the move begins after the ball is drawn');
  // Sample 0 is what the runtime holds for every t before `start`: the path's head.
  assert.deepEqual(track.samples[0], [0, 0, 0]);
  assert.ok(Math.abs(track.end - (0 + 4)) < 1e-9, 'to: 1 lands on the end of the narration');
});

test('a trail is beads along the route, each timed to the element passing it', () => {
  const plan = compilePlan(movingBoard({ path: UNEVEN, trail: true, easing: 'linear' }), DIR);
  const trail = plan.items.find((i) => i.id === 'ball~trail');
  assert.ok(trail, 'trail: true adds an item behind the mover');
  assert.ok(trail.noPen, 'the pen is drawing the ball, not laying beads');
  assert.equal(trail.prims.length, trail.trailAt?.length, 'one appearance time per bead');
  assert.ok((trail.trailAt?.length ?? 0) >= 4);
  const at = trail.trailAt ?? [];
  for (let i = 1; i < at.length; i++) {
    assert.ok((at[i] as number) > (at[i - 1] as number), 'beads light up in order');
  }
  assert.ok((at[0] as number) > 0 && (at.at(-1) as number) < 1, 'inside the travelled range');
  assert.equal(trail.motion?.start, plan.items.find((i) => i.id === 'ball')?.motion?.start);

  // No trail unless it was asked for.
  const bare = compilePlan(movingBoard({ path: UNEVEN }), DIR);
  assert.equal(
    bare.items.find((i) => i.id === 'ball~trail'),
    undefined,
  );
});

test('the lesson fixture rolls a ball down the hill it drew', () => {
  const plan = compilePlan(lessonStoryboard(), DIR);
  const ball = plan.items.find((i) => i.id === 'ball');
  const hill = plan.items.find((i) => i.id === 'hill');
  assert.ok(ball?.motion && hill);
  // The ball's baked positions must land on the drawn hillside: same waypoints.
  const last = ball.motion.samples.at(-1) as [number, number, number];
  const centre = ball.center;
  const endX = centre[0] + last[0];
  const endY = centre[1] + last[1];
  assert.ok(endY > centre[1] + 300, 'it finishes far below where it started');
  assert.ok(endX > centre[0] + 700, 'and well to the right');
  assert.ok(ball.motion.start >= plan.scenes[1]!.start, 'inside its own scene');
  assert.ok(ball.motion.end <= plan.scenes[1]!.start + plan.scenes[1]!.speech + 1e-9);
});

test('dashes and raw path data are walked in order, from start to end', () => {
  const line: Pt[] = [
    [0, 0],
    [200, 0],
  ];
  const dashes = dashAlong(line, 20, 10);
  assert.ok(dashes.length >= 6);
  let previous = -1;
  for (const seg of dashes) {
    const head = seg[0] as Pt;
    assert.ok(head[0] > previous, 'dashes advance along the line');
    previous = head[0];
  }

  // Flattening keeps subpaths separate and preserves direction.
  const subs = flattenPathData('M0 0 L100 0 M0 100 C 50 100, 50 200, 100 200 Z');
  assert.equal(subs.length, 2);
  assert.deepEqual(subs[0], [
    [0, 0],
    [100, 0],
  ]);
  const second = subs[1] as Pt[];
  assert.deepEqual(second[0], [0, 100]);
  assert.deepEqual(second.at(-1), [0, 100], 'Z closes back to the subpath start');
  assert.ok(second.length > 4, 'the curve is sampled, not chorded');

  // Relative commands, H/V, and arcs all land somewhere sane.
  const rel = flattenPathData('m10 10 h50 v50 a25 25 0 0 1 -50 0 z');
  const pts = rel[0] as Pt[];
  assert.deepEqual(pts[0], [10, 10]);
  assert.ok(pts.some((p) => Math.abs(p[0] - 60) < 1e-6 && Math.abs(p[1] - 10) < 1e-6));
  assert.ok(
    pts.some((p) => p[1] > 80),
    'the arc bulges below the box',
  );
});
