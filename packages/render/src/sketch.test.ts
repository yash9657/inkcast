/**
 * The sketch primitives, on their own.
 *
 * Two of them carry a promise the rest of the pipeline cannot check for itself. The
 * title rule promises exactly one stroke running left to right, because the runtime
 * reveals an item's strokes in order and a second pass would sweep back across the
 * words like a strike-through. The brand mark promises that its geometry comes from
 * one exported const, because the finished logo lands later (`docs/PLAN-LAUNCH.md` C4)
 * and "swap the spec" has to remain a one-place edit rather than a hunt through
 * arithmetic. Both promises are invisible in a rendered frame until they are broken,
 * so they are pinned here.
 *
 * Determinism is checked too, for the reason the module header gives: four capture
 * workers draw the same board at once and a re-render must match the poster frame.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAND_MARK, Rng, TITLE_UNDERLINE, sketchBrandMark, sketchUnderline } from './sketch.js';
import type { SketchStyle } from './sketch.js';

const MARKER: SketchStyle = { roughness: 1, bowing: 1, passes: 2, scale: 1 };

/** Every coordinate in a `d` string, in order. */
function nums(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function xs(d: string): number[] {
  return nums(d).filter((_, i) => i % 2 === 0);
}

function ys(d: string): number[] {
  return nums(d).filter((_, i) => i % 2 === 1);
}

test('a title rule is one stroke, left to right, that lifts as it goes', () => {
  const run = { x0: 300, x1: 900, baseline: 220, size: 96 };
  const strokes = sketchUnderline(new Rng(11), MARKER, run);
  // One stroke, not `passes` of them: the second pass would sweep back over the words.
  assert.equal(strokes.length, 1);

  const d = strokes[0] as string;
  const x = xs(d);
  const y = ys(d);
  const startX = x[0] as number;
  const endX = x[x.length - 1] as number;
  // Drawn in the writing direction, continuing where the letters stopped.
  assert.ok(endX > startX, `rule runs backwards: ${startX} -> ${endX}`);
  // It starts before the first letter and finishes past the last one.
  assert.ok(startX < run.x0, `rule starts inside the first letter at ${startX}`);
  assert.ok(endX > run.x1, `rule stops short of the last letter at ${endX}`);
  // The whole rule sits under the baseline, and the right end is the higher one.
  assert.ok(Math.min(...y) > run.baseline, `rule crosses the baseline at ${Math.min(...y)}`);
  assert.ok(
    (y[y.length - 1] as number) < (y[0] as number),
    'the rule should lift to the right, not sag',
  );
});

test('the title rule scales with the type size and nothing else', () => {
  // Same words, twice the type: every offset doubles, because the spec is stated in
  // fractions of the size. A caption rule and a title rule are the same gesture.
  const small = sketchUnderline(new Rng(3), MARKER, { x0: 0, x1: 400, baseline: 0, size: 40 });
  const large = sketchUnderline(new Rng(3), MARKER, { x0: 0, x1: 400, baseline: 0, size: 80 });
  const dropSmall = Math.min(...ys(small[0] as string));
  const dropLarge = Math.min(...ys(large[0] as string));
  assert.ok(dropLarge > dropSmall * 1.6, `${dropLarge} should be well below ${dropSmall}`);
  assert.equal(TITLE_UNDERLINE.rise > 0, true);
  assert.equal(TITLE_UNDERLINE.approach < 1, true);
});

test('the same seed draws the same rule, in this process and the next', () => {
  const run = { x0: 120, x1: 640, baseline: 500, size: 62 };
  assert.deepEqual(
    sketchUnderline(new Rng(97), MARKER, run),
    sketchUnderline(new Rng(97), MARKER, run),
  );
  assert.notDeepEqual(
    sketchUnderline(new Rng(97), MARKER, run),
    sketchUnderline(new Rng(98), MARKER, run),
  );
});

test('the brand plate is a square tile, one cast stroke, and a closed nib', () => {
  // A deliberately wide plate box: the mark must not stretch with it.
  const mark = sketchBrandMark(new Rng(5), MARKER, { x: 1600, y: 900, w: 260, h: 120 });
  assert.equal(mark.box.w, mark.box.h);
  assert.ok(mark.box.w < 120, 'the tile should fit the short side, inset');
  assert.ok(mark.box.x > 1600 && mark.box.x + mark.box.w < 1860, 'tile centred in the box');

  // Four edges, one pass each. Two passes read as a blurred double border at plate size.
  assert.equal(mark.tile.length, 4);
  // One confident stroke, for the same reason the title rule is one stroke.
  assert.equal(mark.cast.length, 1);
  // Closed, so the caller can fill it — the nib is solid, the tile is not.
  assert.ok(mark.nib.endsWith(' Z'), `nib is not closed: ${mark.nib}`);
  assert.ok(!mark.nib.includes('C'), 'the nib must have straight edges to read as a triangle');
  assert.equal(nums(mark.nib).length, 6, 'the nib is three corners');

  // The marker is heavier than the border it sits inside.
  assert.ok(mark.castWidth > mark.borderWidth);
  // C4's "2 px border" on a 24-unit design box, carried through as a ratio.
  assert.equal(Math.round((mark.borderWidth / mark.box.w) * 24 * 100) / 100, 2);
});

test('the cast stroke rises to the right and stops where the nib starts', () => {
  const mark = sketchBrandMark(new Rng(5), MARKER, { x: 0, y: 0, w: 240, h: 240 });
  const cast = mark.cast[0] as string;
  const cx = xs(cast);
  const cy = ys(cast);
  assert.ok((cx[cx.length - 1] as number) > (cx[0] as number), 'the cast runs left to right');
  assert.ok((cy[cy.length - 1] as number) < (cy[0] as number), 'the cast rises');

  // The apex is a full nib length past the base, along `nibAim` — the gap that keeps
  // the shaft's ink out from under the triangle's edges at favicon size.
  const apexX = Math.max(...xs(mark.nib));
  const shaftEndX = cx[cx.length - 1] as number;
  const expected = mark.box.w * BRAND_MARK.nibLength;
  assert.ok(apexX > shaftEndX, 'the nib should extend past the end of the shaft');
  assert.ok(
    Math.abs(apexX - shaftEndX - expected) < mark.box.w * 0.05,
    `shaft gap ${apexX - shaftEndX} vs expected ${expected}`,
  );
});

test('the nib stands upright, which is what makes it a play button', () => {
  // Base perpendicular to `nibAim`, not to the shaft. A nib built on the shaft's own
  // tangent is an arrowhead; two captured plates read exactly that way.
  const mark = sketchBrandMark(new Rng(5), MARKER, { x: 0, y: 0, w: 240, h: 240 });
  const nx = xs(mark.nib);
  const ny = ys(mark.nib);
  const [b1x, apexX, b2x] = nx as [number, number, number];
  const [b1y, , b2y] = ny as [number, number, number];
  // The two base corners share an x (to within the nib's deliberately small jitter)
  // and straddle the apex vertically: a vertical base, pointing due right.
  assert.ok(Math.abs(b1x - b2x) < 2, `base is not vertical: ${b1x} vs ${b2x}`);
  assert.ok(apexX > b1x && apexX > b2x, 'the apex must lead the base');
  const halfW = (Math.abs(b1y - b2y) / 2 / mark.box.w) * 24;
  assert.ok(halfW > 4, `nib half-width ${halfW}/24 is too narrow to read as a triangle`);
  // The floor that stops it reading as an arrowhead: clearly wider than the shaft.
  assert.ok(Math.abs(b1y - b2y) / 2 > mark.castWidth * 1.4);
});

test('the whole mark stays inside the plate box it was given', () => {
  const box = { x: 100, y: 200, w: 180, h: 180 };
  const mark = sketchBrandMark(new Rng(42), MARKER, box);
  // The tile edges overshoot their corners by design, so allow the sketch slop the
  // primitives are documented to add; what must not happen is the mark escaping the
  // plate and colliding with the film's own ink in the corner of the frame.
  const slop = 8;
  for (const d of [...mark.tile, ...mark.cast, mark.nib]) {
    for (const x of xs(d)) {
      assert.ok(x >= box.x - slop && x <= box.x + box.w + slop, `x ${x} escaped ${d}`);
    }
    for (const y of ys(d)) {
      assert.ok(y >= box.y - slop && y <= box.y + box.h + slop, `y ${y} escaped ${d}`);
    }
  }
});

test('swapping the spec moves the geometry, so the logo swap is one edit', () => {
  const box = { x: 0, y: 0, w: 200, h: 200 };
  const stock = sketchBrandMark(new Rng(7), MARKER, box);
  const fatter = sketchBrandMark(new Rng(7), MARKER, box, {
    ...BRAND_MARK,
    nibHalfWidth: BRAND_MARK.nibHalfWidth * 2,
    borderWeight: BRAND_MARK.borderWeight * 3,
  });
  assert.notEqual(stock.nib, fatter.nib);
  assert.ok(fatter.borderWidth > stock.borderWidth * 2.9);
  // Cast violet is the authoritative token's sRGB resolution, not the plan's typo.
  assert.equal(BRAND_MARK.stroke, '#4F46E5');
});

test('the same seed draws the same plate', () => {
  const box = { x: 10, y: 20, w: 120, h: 120 };
  assert.deepEqual(
    sketchBrandMark(new Rng(1234), MARKER, box),
    sketchBrandMark(new Rng(1234), MARKER, box),
  );
});
