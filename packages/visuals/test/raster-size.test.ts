/**
 * The shape of the picture we ask a provider for.
 *
 * Every figure in the first film that contained one drew at **66.7% of the box reserved for
 * it** — `567x378 -> 378x378`, `509.96x339.97 -> 340x340`, `491.73x327.82 -> 328x328`,
 * measured on `projects/cardiac8/storyboard.json`. `FIGURE_AREA` is 3:2, every generated
 * raster was 1024x1024, and the runtime fits an asset uniformly and centres it. The fit is
 * correct — a stretched heart is worse than a small one — so the request had to change.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { illustrationKey, rasterSize, replicateAspect } from '../src/image.js';

test('a square request is exactly what `square_hd` was, so every cached raster is still current', () => {
  assert.deepEqual(rasterSize(1), { width: 1024, height: 1024 });
});

test('the box`s shape is the picture`s shape, and the area stays at one megapixel', () => {
  const box = rasterSize(567 / 378); // the real cardiac figure box, 3:2
  assert.ok(box.width > box.height, 'a 3:2 box asks for a landscape picture');
  const ratio = box.width / box.height;
  assert.ok(Math.abs(ratio - 1.5) < 0.05, `asked for ${ratio.toFixed(3)}, wanted about 1.5`);
  // Both providers price by area, so holding ~1MP is what makes this cost nothing extra.
  const mp = (box.width * box.height) / (1024 * 1024);
  assert.ok(mp > 0.95 && mp < 1.05, `${mp.toFixed(3)} megapixels`);
});

test('a 3:2 picture fills the 3:2 box that cost us a third of every figure', () => {
  const w = 567;
  const h = 378;
  const px = rasterSize(w / h);
  // What `runtime.js` does: fit uniformly, centre.
  const scale = Math.min(w / px.width, h / px.height);
  const filled = ((px.width * scale) / w) * ((px.height * scale) / h);
  assert.ok(filled > 0.97, `fills ${(filled * 100).toFixed(1)}% of its box, was 66.7%`);
});

test('an extreme box is clamped rather than asked for — a 6:1 banner comes back as repeats', () => {
  const wide = rasterSize(6);
  assert.ok(wide.width / wide.height <= 2.6, `clamped to ${wide.width}x${wide.height}`);
  const tall = rasterSize(1 / 6);
  // Clamped symmetrically: portrait must be treated exactly as landscape is.
  assert.equal(wide.width, tall.height);
  assert.equal(wide.height, tall.width);
});

test('a degenerate aspect falls back to square rather than throwing at a provider', () => {
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(rasterSize(bad), { width: 1024, height: 1024 }, `aspect ${bad}`);
  }
});

test('Replicate takes a name, and the nearest name is nearest in log space', () => {
  assert.equal(replicateAspect(1), '1:1');
  assert.equal(replicateAspect(1.5), '3:2');
  // 2:3 must be exactly as far from square as 3:2 is; a linear distance says otherwise and
  // would round a portrait box to 1:1 while rounding its mirror to 3:2.
  assert.equal(replicateAspect(1 / 1.5), '2:3');
});

test('the aspect is in the cache key, or a reshaped request serves the square picture', () => {
  const square = illustrationKey('underlay-heart', 'a heart', 'figure', 1);
  const wide = illustrationKey('underlay-heart', 'a heart', 'figure', 1.5);
  assert.notEqual(square, wide);
});
