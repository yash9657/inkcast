import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipToBox,
  containsBox,
  fitMatrix,
  parsePath,
  pathBBox,
  pathLength,
  pathToString,
  serialiseSvg,
  svgDocument,
  transformPath,
  unionBox,
} from '../src/svg.js';

test('parsePath normalises every command to absolute M/L/C/Z', () => {
  const segs = parsePath('m10 10 h20 v20 l-20 0 z');
  assert.deepEqual(
    segs.map((s) => s.c),
    ['M', 'L', 'L', 'L', 'Z'],
  );
  assert.equal(pathToString(segs), 'M10 10 L30 10 L30 30 L10 30 Z');
});

test('parsePath handles smooth curves, quadratics and implicit repeats', () => {
  const segs = parsePath('M0 0 Q50 100 100 0 T200 0');
  assert.equal(segs.filter((s) => s.c === 'C').length, 2);
  const smooth = parsePath('M0 0 C10 0 20 0 30 0 S50 0 60 0');
  assert.equal(smooth.filter((s) => s.c === 'C').length, 2);
  // Implicit repeat: one L command, three coordinate pairs.
  assert.equal(parsePath('M0 0 L1 1 2 2 3 3').filter((s) => s.c === 'L').length, 3);
});

test('parsePath accepts arc flags packed against the next number', () => {
  // `a3 3 0 106 0` is largeArc=1, sweep=0, dx=6 — the compact form lucide emits.
  const spaced = pathLength('M9 18 a3 3 0 1 0 6 0');
  const packed = pathLength('M9 18a3 3 0 106 0');
  assert.ok(Math.abs(spaced - packed) < 1e-6, `${spaced} vs ${packed}`);
});

test('pathLength is accurate for known geometry', () => {
  assert.equal(pathLength('M0 0 L100 0'), 100);
  assert.equal(pathLength('M0 0 H10 V10 H0 Z'), 40);
  const circle = pathLength('M-50 0 A50 50 0 1 0 50 0 A50 50 0 1 0 -50 0 Z');
  assert.ok(Math.abs(circle - 2 * Math.PI * 50) < 1, `circumference was ${circle}`);
});

test('pathLength and pathBBox survive junk without hanging', () => {
  assert.equal(pathLength(''), 0);
  assert.equal(pathLength('M0 0'), 0);
  assert.deepEqual(pathBBox(''), { x: 0, y: 0, w: 0, h: 0 });
});

test('pathBBox measures curves, not just anchors', () => {
  const box = pathBBox('M0 0 C0 100 100 100 100 0');
  assert.equal(box.x, 0);
  assert.equal(box.w, 100);
  assert.ok(box.h > 70 && box.h < 76, `curve height ${box.h}`);
});

test('fitMatrix scales uniformly and centres inside the destination', () => {
  const m = fitMatrix({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 200 });
  assert.equal(m.a, 10);
  assert.equal(m.d, 10);
  assert.equal(transformPath('M0 0 L10 10', m), 'M0 50 L100 150');
});

test('clipToBox stops on the border of the box', () => {
  assert.deepEqual(clipToBox({ x: 0, y: 0, w: 100, h: 50 }, { x: 200, y: 25 }), { x: 100, y: 25 });
  assert.deepEqual(clipToBox({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: -100 }), { x: 50, y: 0 });
});

test('unionBox and containsBox agree', () => {
  const u = unionBox([
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 5, w: 10, h: 10 },
  ]);
  assert.deepEqual(u, { x: 0, y: 0, w: 30, h: 15 });
  assert.ok(containsBox(u, { x: 1, y: 1, w: 2, h: 2 }));
  assert.ok(!containsBox(u, { x: 25, y: 5, w: 20, h: 5 }));
});

test('serialiser escapes text but leaves CSS alone', () => {
  assert.equal(
    serialiseSvg({ tag: 'text', attrs: { x: 1 }, text: 'a & b < c' }),
    '<text x="1">a &amp; b &lt; c</text>',
  );
  const doc = svgDocument({
    viewBox: { x: 0, y: 0, w: 4, h: 4 },
    css: "@font-face{font-family:'A';src:url('a.ttf')}",
    children: [],
  });
  assert.match(doc, /viewBox="0 0 4 4"/);
  assert.match(doc, /src:url\('a\.ttf'\)/);
  assert.ok(!doc.includes('&quot;'), 'CSS must not be entity-escaped');
});
