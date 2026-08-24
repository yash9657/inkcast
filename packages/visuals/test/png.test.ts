import assert from 'node:assert/strict';
import test from 'node:test';
import { groundWhiteness, pngSize, readPng } from '../src/png.js';
import { flatPng, makePng } from './pngfixture.js';

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const GREY: [number, number, number, number] = [200, 200, 200, 255];

test('a PNG round-trips through the reader at every colour type it claims to read', () => {
  for (const colorType of [0, 2, 6] as const) {
    const png = makePng(8, 4, (x, y) => (x === y ? BLACK : WHITE), { colorType });
    const img = readPng(png);
    assert.ok(img, `colour type ${colorType} must be readable`);
    assert.equal(img.width, 8);
    assert.equal(img.height, 4);
    assert.equal(img.rgba.length, 8 * 4 * 4);
    // The diagonal is black and everything else is white, whatever the channel layout was.
    assert.equal(img.rgba[(1 * 8 + 1) * 4], 0, 'the diagonal pixel is ink');
    assert.equal(img.rgba[(1 * 8 + 5) * 4], 255, 'its neighbour is paper');
    assert.equal(img.rgba[(1 * 8 + 1) * 4 + 3], 255, 'opaque either way');
  }
});

test('every PNG filter type reconstructs the same image', () => {
  // A picture with gradients in both directions, so Up, Sub, Average and Paeth each
  // actually have something to predict and a wrong one cannot coincidentally agree.
  const paint = (x: number, y: number): [number, number, number, number] => [
    (x * 37) % 256,
    (y * 11) % 256,
    (x * y) % 256,
    255,
  ];
  const expected = readPng(makePng(6, 5, paint, { filter: 0 }));
  assert.ok(expected);
  for (const filter of [1, 2, 3, 4] as const) {
    const got = readPng(makePng(6, 5, paint, { filter }));
    assert.ok(got, `filter ${filter} must decode`);
    assert.deepEqual(
      Array.from(got.rgba),
      Array.from(expected.rgba),
      `filter ${filter} must reconstruct the same pixels as filter 0`,
    );
  }
});

test('the reader abstains rather than guessing at bytes it cannot read', () => {
  assert.equal(readPng(Buffer.from('not a png at all')), undefined);
  assert.equal(readPng(Buffer.alloc(0)), undefined);
  // A truncated file: the header parses, the pixels are not there.
  const png = flatPng(4, 4, WHITE);
  assert.equal(readPng(png.subarray(0, 40)), undefined);
});

test('pngSize reads the real header and falls back to a square when there is none', () => {
  assert.deepEqual(pngSize(flatPng(96, 32, WHITE)), { w: 96, h: 32 });
  assert.deepEqual(pngSize(Buffer.from('not a png')), { w: 1024, h: 1024 });
});

test('a white page is white ground and a grey page is not', () => {
  assert.equal(groundWhiteness(flatPng(64, 64, WHITE)), 1);
  const grey = groundWhiteness(flatPng(64, 64, GREY));
  assert.ok(
    grey !== undefined && grey < 0.9,
    `a #c8c8c8 ground must read below the floor: ${grey}`,
  );
});

test('ink on the page does not make the ground grey — the median is what is asked', () => {
  // A drawing is allowed to touch its own edge. One bar running off the side moves a mean
  // and must not move the verdict; the whole point of measuring the median is this case.
  const barred = makePng(64, 64, (x) => (x >= 30 && x < 34 ? BLACK : WHITE));
  assert.equal(groundWhiteness(barred), 1);
});

test('a transparent ground counts as white, because the board is what shows through', () => {
  const clear = makePng(64, 64, (x, y) =>
    x > 16 && x < 48 && y > 16 && y < 48 ? BLACK : [0, 0, 0, 0],
  );
  assert.equal(groundWhiteness(clear), 1);
});

test('groundWhiteness abstains on bytes it cannot read', () => {
  assert.equal(groundWhiteness(Buffer.from('not a png')), undefined);
});
