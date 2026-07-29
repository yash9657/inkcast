import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrowMidpoint,
  arrowPaths,
  ctxFor,
  emphasisPaths,
  roughenPathData,
  seedFrom,
  shapePaths,
  type InkPath,
  type ShapeKind,
} from '../src/geometry.js';
import { inkStyleFor, type InkStyleName } from '../src/style.js';
import { parsePath, pathBBox, pathLength, samplePath } from '../src/svg.js';

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

/* ---- the two ink modes -------------------------------------------------- */

const FLAT = { x: 100, y: 300, w: 400, h: 0 };

test('sketch is what a context with no ink mode already drew', () => {
  // The whole risk of adding a mode is moving the default. Every existing lane
  // passes no `ink` at all, so the two must be the same drawing byte for byte.
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  for (const shape of SHAPES) {
    const silent = shapePaths(shape, BOX, ctxFor(style, 4242));
    const explicit = shapePaths(shape, BOX, { ...ctxFor(style, 4242), ink: 'sketch' });
    assert.deepEqual(
      explicit.map((p) => p.d),
      silent.map((p) => p.d),
      `${shape}: 'sketch' must be the default, not a new look`,
    );
  }
});

test('a crisp mark has no perturbation left in it', () => {
  const style = inkStyleFor({ style: 'chalk', palette: 'color' }); // the roughest hand
  const crisp = (seed: number): InkPath[] =>
    shapePaths('line', FLAT, { ...ctxFor(style, seed), ink: 'crisp' });

  // Exact: a horizontal line is dead flat, not nearly flat. Chalk's roughness
  // would otherwise put every sample a couple of units either side. The y itself
  // is the middle of the box, which `shapePaths` gives a 1-unit height when it is
  // degenerate — the value is not the point here, the spread is.
  const flat = crisp(1)[0];
  assert.ok(flat);
  // Bounded rather than equal: the samples come from evaluating a cubic, so they
  // carry float noise of their own. Chalk would wobble by whole units.
  const ys = samplePath(parsePath(flat.d)).map((p) => p.y);
  const spread = Math.max(...ys) - Math.min(...ys);
  assert.ok(spread < 1e-6, `crisp line is not flat (spread ${spread}): ${flat.d}`);
  assert.equal(pathLength(flat.d), FLAT.w, 'a crisp line is exactly as long as asked');

  // Seed-independent: with no randomness in the geometry, the seed cannot show up
  // in the bytes either — which is what makes two crisp drawings comparable.
  assert.deepEqual(
    crisp(1).map((p) => p.d),
    crisp(987654).map((p) => p.d),
    'crisp path data must be a pure function of the geometry asked for',
  );

  const sketch = shapePaths('line', FLAT, ctxFor(style, 1));
  assert.notEqual(sketch[0]?.d, crisp(1)[0]?.d, 'crisp and sketch must not be the same drawing');
});

test('crisp path data is used verbatim, subpaths and closes included', () => {
  const style = inkStyleFor({ style: 'pencil', palette: 'color' });
  // Multi-segment and closed, on purpose. A single-segment path cannot catch the bug
  // this pins: roughjs at zero roughness keeps every control point but re-emits one
  // subpath *per segment* and drops the `Z`, which is invisible on a stroked line and
  // ruins a filled one — a glyph outline comes out hollow. The first version of this
  // test used one cubic and passed while that was broken.
  const d = 'M10 10 C30 40 70 40 90 10 C110 -20 150 -20 170 10 L170 60 Z';
  const out = roughenPathData({ ...ctxFor(style, 55), ink: 'crisp' }, d, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.d, d, 'a crisp path must come back out exactly as it went in');
  assert.equal(out[0]?.d.match(/M/g)?.length, 1, 'crisp must not split the path into subpaths');
  assert.match(out[0]?.d ?? '', /Z$/, 'crisp must keep the contour closed');
});

test('a crisp path can carry a fill, which is what a glyph outline is', () => {
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  const out = roughenPathData(
    { ...ctxFor(style, 7), ink: 'crisp' },
    'M0 0 L40 0 L40 40 L0 40 Z',
    0,
    { fill: '#123456', stroke: '#123456', strokeWidth: 1.5 },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]?.fill, '#123456');
  assert.equal(out[0]?.stroke, '#123456');
  assert.equal(out[0]?.strokeWidth, 1.5);
  assert.ok((out[0]?.length ?? 0) > 0, 'the reveal needs a measured length');
});

test('a crisp mark ignores a call site that asks for its own roughness', () => {
  // Several plot helpers pass `roughness: style.roughness * 0.75` and friends.
  // Crisp has to win, or the mode would be quietly overridable per mark.
  const style = inkStyleFor({ style: 'marker', palette: 'color' });
  const ctx = { ...ctxFor(style, 12), ink: 'crisp' as const };
  const plain = roughenPathData(ctx, 'M0 0 C10 20 30 20 40 0', 0);
  const asked = roughenPathData(ctx, 'M0 0 C10 20 30 20 40 0', 0, {
    roughness: style.roughness,
    bowing: style.bowing,
    maxRandomnessOffset: 4,
  });
  assert.deepEqual(
    asked.map((p) => p.d),
    plain.map((p) => p.d),
  );
});
