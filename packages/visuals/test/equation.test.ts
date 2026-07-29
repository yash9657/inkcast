import assert from 'node:assert/strict';
import test from 'node:test';
import { ctxFor, seedFrom } from '../src/geometry.js';
import { resolveEquation, type EquationSpec, type ResolvedEquation } from '../src/equation.js';
import { inkStyleFor } from '../src/style.js';
import { containsBox, padBox, parsePath, pathBBox, unionBox } from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const SEED = seedFrom('equation-test');
const BOX = { x: 200, y: 140, w: 800, h: 220 };

/** The milestone's own acceptance example (`PIPELINE.md` step 3). */
const MILESTONE = 'w \\leftarrow 3 - 0.1 \\times 4 = 2.6';

function resolve(
  tex: string,
  over: Partial<EquationSpec> = {},
  seed = SEED,
): Promise<ResolvedEquation | undefined> {
  return resolveEquation(
    { tex, display: true, box: BOX, align: 'center', ...over },
    ctxFor(style, seed),
    { style },
  );
}

function ds(r: ResolvedEquation): string[] {
  return r.items.flatMap((i) => (i.kind === 'path' ? [i.path.d] : []));
}

test('the milestone equation typesets to real glyph outlines', async () => {
  const r = await resolve(MILESTONE);
  assert.ok(r, 'the equation lane produced nothing at all');

  // 13 glyphs: w, arrow, 3, minus, 0, ., 1, times, 4, =, 2, ., 6. Asserting a floor
  // rather than the exact count keeps this from breaking on a font's ligature
  // choices, while still failing loudly if it degenerates to a box or a single blob.
  assert.ok(r.layout.marks >= 13, `expected a glyph per symbol, got ${r.layout.marks}`);
  assert.equal(ds(r).length, r.layout.marks);

  for (const d of ds(r)) {
    assert.match(d, /^M/, `path data must start with a moveto: ${d.slice(0, 24)}`);
    assert.ok(!/NaN|Infinity|undefined/.test(d), `non-numeric path data: ${d}`);
    // A glyph is an outline with curves in it, not a rectangle standing in for one.
    assert.ok(parsePath(d).length >= 2, `mark has no geometry: ${d}`);
  }
  // Filled, because glyphs are outlines — an unfilled equation is a wireframe.
  for (const item of r.items) {
    if (item.kind !== 'path') continue;
    assert.notEqual(item.path.fill, 'none', 'glyphs must be filled');
    assert.equal(item.path.fillRule, 'nonzero', 'counters need nonzero winding');
    assert.ok(item.path.strokeWidth > 0, 'the reveal needs an outline to trace');
  }
});

test('marks come out in left-to-right reveal order', async () => {
  const r = await resolve(MILESTONE);
  assert.ok(r);
  // The page gives each part of an item a slice of the timeline in order, so this
  // ordering *is* the animation: the equation writes itself across the board.
  const lefts = ds(r).map((d) => pathBBox(d).x);
  for (let i = 1; i < lefts.length; i++) {
    const prev = lefts[i - 1] as number;
    const here = lefts[i] as number;
    // Sorted by translated origin, so a wide glyph's box can start marginally left of
    // its predecessor's; a whole glyph-width of backtracking is a real ordering bug.
    assert.ok(
      here >= prev - r.layout.emSize * 0.5,
      `mark ${i} starts ${prev - here} units left of mark ${i - 1} — not left to right`,
    );
  }
  const first = pathBBox(ds(r)[0] as string);
  const last = pathBBox(ds(r)[ds(r).length - 1] as string);
  assert.ok(last.x > first.x, 'the last mark must be to the right of the first');
});

test('an equation is crisp: exact, and seed-independent', async () => {
  const a = await resolve(MILESTONE, {}, 1);
  const b = await resolve(MILESTONE, {}, 987654);
  assert.ok(a && b);
  assert.deepEqual(ds(b), ds(a), 'a seed reached the geometry — the ink is not crisp');
});

test('resolving the same equation twice is byte-identical', async () => {
  // The storyboard is cached on a fingerprint; an equation that drifted between runs
  // would invalidate that cache forever and nobody would suspect the typesetter.
  const a = await resolve('\\frac{\\partial L}{\\partial w} = 2x');
  const b = await resolve('\\frac{\\partial L}{\\partial w} = 2x');
  assert.ok(a && b);
  assert.deepEqual(ds(b), ds(a));
  assert.deepEqual(b.layout, a.layout);
});

test('the typeset result fits inside its box, keeping its aspect ratio', async () => {
  const r = await resolve(MILESTONE);
  assert.ok(r);
  const ink = unionBox(ds(r).map((d) => pathBBox(d)));
  // Stroke half-widths can push the outline a hair past the fitted bounds.
  assert.ok(
    containsBox(padBox(BOX, r.layout.emSize * 0.1), ink),
    `ink ${JSON.stringify(ink)} escaped box ${JSON.stringify(BOX)}`,
  );
  assert.ok(r.layout.bounds.w <= BOX.w && r.layout.bounds.h <= BOX.h);

  // A wide equation in a tall box must letterbox, not stretch: the drawn aspect has
  // to match the typeset aspect, because a stretched equation is a wrong one.
  const tall = await resolve(MILESTONE, { box: { x: 0, y: 0, w: 400, h: 400 } });
  assert.ok(tall);
  const aspect = (b: { w: number; h: number }): number => b.w / b.h;
  assert.ok(
    Math.abs(aspect(tall.layout.bounds) - aspect(r.layout.bounds)) < 0.02,
    'the equation was stretched to fit',
  );
});

test('align moves the equation within a box it does not fill', async () => {
  // Deliberately height-limited: this equation's aspect is about 12:1, so in a box
  // wider than 12× its height the fit is capped by the height and there is real
  // horizontal slack to place it in. A 1600×200 box has none — the equation fills the
  // width exactly — and align would have nothing to do.
  const box = { x: 0, y: 0, w: 1600, h: 60 };
  const left = await resolve(MILESTONE, { box, align: 'left' });
  const centre = await resolve(MILESTONE, { box, align: 'center' });
  const right = await resolve(MILESTONE, { box, align: 'right' });
  assert.ok(left && centre && right);
  assert.ok(
    left.layout.bounds.x < centre.layout.bounds.x && centre.layout.bounds.x < right.layout.bounds.x,
    'align had no effect on placement',
  );
  // Same drawing, moved — not re-typeset at a different size.
  assert.equal(left.layout.bounds.w, right.layout.bounds.w);
});

test('a fraction contributes its rule, not just its digits', async () => {
  // The bar is a `<rect>` in MathJax's output rather than a glyph, so this is the
  // test that the walker collects rects at all — without it a fraction silently
  // renders as two numbers with nothing between them.
  const frac = await resolve('\\frac{1}{2}');
  const digits = await resolve('12');
  assert.ok(frac && digits);
  assert.ok(
    frac.layout.marks > digits.layout.marks,
    `a fraction should add a rule: ${frac.layout.marks} vs ${digits.layout.marks} marks`,
  );
  // The rule is a wide, flat mark; nothing else in `\frac{1}{2}` is.
  const flat = ds(frac)
    .map((d) => pathBBox(d))
    .filter((b) => b.w > b.h * 3);
  assert.equal(flat.length, 1, 'expected exactly one fraction rule');
});

test('display and inline styles set the same source differently', async () => {
  const display = await resolve('\\sum_{i=1}^{n} x_i', { display: true });
  const inline = await resolve('\\sum_{i=1}^{n} x_i', { display: false });
  assert.ok(display && inline);
  // Display puts the limits above and below the sigma; inline tucks them beside it,
  // so the inline form is wider relative to its height.
  const ratio = (r: ResolvedEquation): number => r.layout.bounds.w / r.layout.bounds.h;
  assert.ok(
    ratio(inline) > ratio(display),
    `inline should be the wider setting: ${ratio(inline)} vs ${ratio(display)}`,
  );
});

test('unusable source falls back rather than drawing nothing', async () => {
  // `undefined` is the contract that makes the caller draw the TeX as text. Throwing
  // or returning empty geometry would lose the beat instead.
  assert.equal(await resolve(''), undefined);
  assert.equal(await resolve('   '), undefined);
  const broken = await resolve('\\frac{1}{');
  if (broken) {
    // MathJax may typeset an error indicator instead of failing; either is fine, so
    // long as it is finite geometry and not a crash.
    for (const d of ds(broken)) assert.ok(!/NaN|Infinity/.test(d));
  }
});
