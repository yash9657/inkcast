import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrowMidpoint,
  arrowPaths,
  ctxFor,
  emphasisPaths,
  seedFrom,
  shapePaths,
  type InkPath,
  type ShapeKind,
} from '../src/geometry.js';
import { inkStyleFor, type InkStyleName } from '../src/style.js';
import { parsePath, pathBBox, pathLength } from '../src/svg.js';

const BOX = { x: 40, y: 60, w: 320, h: 180 };
const SEED = seedFrom('geometry-test');

function assertDrawable(paths: InkPath[], label: string): void {
  assert.ok(paths.length > 0, `${label} produced no paths`);
  for (const p of paths) {
    assert.ok(p.d.length > 0, `${label} produced an empty d`);
    assert.match(p.d, /^M/, `${label} path data must start with a moveto: ${p.d.slice(0, 24)}`);
    assert.ok(!/NaN|undefined|Infinity/.test(p.d), `${label} path data has non-numbers: ${p.d}`);
    const segs = parsePath(p.d);
    assert.ok(segs.length >= 2, `${label} path has no geometry`);
    assert.ok(pathLength(p.d) > 0, `${label} path has zero length`);
    assert.ok(Number.isFinite(p.length) && p.length > 0, `${label} length not measured`);
    assert.ok(p.strokeWidth >= 0);
  }
}

test('rough.js runs with no DOM at all', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'this test must run headless');
  const ctx = ctxFor(inkStyleFor({ style: 'marker', palette: 'color' }), SEED);
  assertDrawable(shapePaths('rect', BOX, ctx), 'rect');
});

const SHAPES: ShapeKind[] = ['rect', 'ellipse', 'line', 'bracket', 'underline', 'circle-highlight'];

for (const shape of SHAPES) {
  test(`shape ${shape} resolves to valid path data`, () => {
    const ctx = ctxFor(inkStyleFor({ style: 'marker', palette: 'color' }), SEED);
    assertDrawable(shapePaths(shape, BOX, ctx), shape);
  });
}

test('a bracket flips orientation with the box aspect', () => {
  const ctx = () => ctxFor(inkStyleFor({ style: 'ink', palette: 'mono' }), SEED);
  const tall = pathBBox(shapePaths('bracket', { x: 0, y: 0, w: 60, h: 400 }, ctx())[0]?.d ?? '');
  const wide = pathBBox(shapePaths('bracket', { x: 0, y: 0, w: 400, h: 60 }, ctx())[0]?.d ?? '');
  assert.ok(tall.h > tall.w, 'a tall box should get a vertical brace');
  assert.ok(wide.w > wide.h, 'a wide box should get a horizontal brace');
});

test('filled shapes emit the sketchy fill before the outline', () => {
  const ctx = ctxFor(inkStyleFor({ style: 'marker', palette: 'color' }), SEED);
  const unfilled = shapePaths('rect', BOX, ctx, false);
  const filled = shapePaths(
    'rect',
    BOX,
    ctxFor(inkStyleFor({ style: 'marker', palette: 'color' }), SEED),
    true,
  );
  assert.ok(filled.length > unfilled.length, 'a fill should add at least one path');
  assertDrawable(filled, 'filled rect');
});

test('seeded output is reproducible, and different seeds differ', () => {
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  const a = shapePaths('rect', BOX, ctxFor(style, 4242));
  const b = shapePaths('rect', BOX, ctxFor(style, 4242));
  const c = shapePaths('rect', BOX, ctxFor(style, 99));
  assert.deepEqual(
    a.map((p) => p.d),
    b.map((p) => p.d),
    'the same seed must produce byte-identical path data',
  );
  assert.notEqual(a[0]?.d, c[0]?.d, 'a different seed must produce different wobble');
});

test('reusing one context does not leak roughjs randomness between marks', () => {
  // roughjs memoises its RNG onto the options object; if we ever stopped passing
  // `randomizer: undefined` the second call below would drift.
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  const ctx1 = ctxFor(style, 7);
  const first = shapePaths('rect', BOX, ctx1)[0]?.d;
  shapePaths('ellipse', BOX, ctx1);
  const again = shapePaths('rect', BOX, ctx1)[0]?.d;
  assert.equal(first, again);
});

test('ink personality changes with meta.style', () => {
  const styles: InkStyleName[] = ['marker', 'pencil', 'chalk', 'ink'];
  const seen = new Map<InkStyleName, { d: string; w: number; o: number }>();
  for (const name of styles) {
    const style = inkStyleFor({ style: name, palette: 'color' });
    const p = shapePaths('rect', BOX, ctxFor(style, 11))[0];
    assert.ok(p);
    seen.set(name, { d: p.d, w: p.strokeWidth, o: p.opacity });
  }
  const marker = seen.get('marker');
  const pencil = seen.get('pencil');
  const chalk = seen.get('chalk');
  const liner = seen.get('ink');
  assert.ok(marker && pencil && chalk && liner);
  assert.ok(marker.w > pencil.w, 'marker must be fatter than pencil');
  assert.ok(pencil.o < liner.o, 'pencil must be lighter than ink');
  assert.ok(chalk.d !== liner.d, 'chalk roughness must differ from a fine liner');
  assert.equal(
    new Set([marker.d, pencil.d, chalk.d, liner.d]).size,
    4,
    'all four styles must differ',
  );
});

test('arrows curve and get a real arrowhead at the tip', () => {
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  const from = { x: 0, y: 0 };
  const to = { x: 400, y: 100 };
  const straight = arrowPaths(from, to, 0, ctxFor(style, 5));
  const curved = arrowPaths(from, to, 0.8, ctxFor(style, 5));
  assertDrawable(straight, 'straight arrow');
  assertDrawable(curved, 'curved arrow');
  assert.notEqual(straight[0]?.d, curved[0]?.d, 'the curve parameter must bend the shaft');

  const head = straight.filter((p) => p.group === 'arrowhead');
  assert.ok(head.length > 0, 'an arrow with no head is a line');
  const hb = pathBBox(head[0]?.d ?? '');
  assert.ok(
    Math.hypot(hb.x + hb.w - to.x, hb.y + hb.h / 2 - to.y) < 80,
    'the head must sit at the tip',
  );

  const mid = arrowMidpoint(from, to, 0.8);
  assert.notEqual(mid.y, 50, 'a curved arrow midpoint is off the chord');
  assert.deepEqual(arrowMidpoint(from, to, 0), { x: 200, y: 50 });
});

test('every emphasis effect produces drawable geometry', () => {
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  const target = { x: 200, y: 200, w: 240, h: 90 };
  const canvas = { x: 0, y: 0, w: 1920, h: 1080 };
  for (const effect of ['circle', 'underline', 'arrow-to', 'pulse'] as const) {
    const paths = emphasisPaths(effect, target, ctxFor(style, 3), {
      origin: { x: 40, y: 40, w: 10, h: 10 },
      canvas,
    });
    assertDrawable(paths, `emphasis ${effect}`);
  }
  const dim = emphasisPaths('dim-others', target, ctxFor(style, 3), { canvas });
  assert.equal(dim.length, 1);
  const scrim = dim[0];
  assert.ok(scrim);
  assert.equal(scrim.fillRule, 'evenodd', 'the scrim needs a hole punched in it');
  assert.notEqual(scrim.fill, 'none');
  assert.equal(scrim.stroke, 'none');
  const bbox = pathBBox(scrim.d);
  assert.equal(bbox.w, canvas.w);
  assert.equal(bbox.h, canvas.h);
});

test('a circle-highlight surrounds its target rather than sitting inside it', () => {
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  const paths = shapePaths('circle-highlight', BOX, ctxFor(style, 8));
  const box = pathBBox(paths[0]?.d ?? '');
  assert.ok(box.w > BOX.w, 'the loop must be wider than what it circles');
  assert.ok(box.h > BOX.h);
});
