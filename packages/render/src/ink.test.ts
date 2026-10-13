/**
 * What counts as ink, and against what.
 *
 * The bug this pins is the one that made the instrument useless on half the packs it was
 * meant to score: `statFrame` asked "is this pixel dark, or is it colourful", and on a
 * slate or navy board the *paper* is both. Measured 2026-08-27 before the fix,
 * `projects/qc92-chalk` — a reviewed chalk film — read **99.2% ink**, so `ink-floor`
 * passed vacuously on every dark board ever rendered and `blank-run` could not have fired
 * on one however empty it was.
 *
 * Two things have to hold together, and the second is why the first is safe to make:
 * a dark board must measure its own ink, and a light board must measure exactly what it
 * measured before — `MIN_INK_SHARE`'s corpus derivation was taken with the old rule.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DARK_ENOUGH, groundOf, statFrame, PAPER_CHROMA, PAPER_LUMA } from './ink.js';

/** A one-pixel-per-entry rgb24 buffer. */
function frame(...px: [number, number, number][]): Buffer {
  return Buffer.from(px.flat());
}
const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const LIGHT = '#fcfbf9';
const NAVY = '#14304a'; // blueprint
const SLATE = '#1b232e'; // chalk

test('a board measures ink against its own paper, not against darkness', () => {
  // Each pack's paper is not its own ink. This is the whole defect: navy is both dark and
  // saturated, so *both* of the old clauses fired on every pixel of the board.
  for (const [paper, ink] of [
    [LIGHT, '#1b232e'],
    [NAVY, '#eef4f8'],
    [SLATE, '#f2efe6'],
  ] as const) {
    const buf = frame(hex(paper), hex(paper), hex(paper), hex(ink));
    assert.equal(statFrame(buf, 4, 1, paper).ink, 1, `${paper}: only the ink is ink`);
  }

  // And the accents, which are the case the second clause exists for — a bright mark can
  // be lighter than any absolute threshold and is unquestionably ink.
  const navy = (c: string): number => statFrame(frame(hex(NAVY), hex(c)), 2, 1, NAVY).ink - 0; // paper never counts
  assert.equal(navy('#53c8e8'), 1, 'the cyan accent');
  assert.equal(navy('#ff8a3d'), 1, 'the orange contrast');
  assert.equal(navy('#9db8cc'), 1, 'the soft ink');
  assert.equal(navy(NAVY), 0, 'the paper itself');

  // The grid is not ink: 6% white over navy is a slightly lighter navy, and a check that
  // counted it would report a blank board as a drawn one.
  const grid: [number, number, number] = [
    Math.round(0x14 * 0.94 + 255 * 0.06),
    Math.round(0x30 * 0.94 + 255 * 0.06),
    Math.round(0x4a * 0.94 + 255 * 0.06),
  ];
  assert.equal(statFrame(frame(grid), 1, 1, NAVY).ink, 0, 'the grid dots are not ink');
});

test('the light board measures exactly what it measured before', () => {
  // The old rule, term for term: ink when `lum < DARK_ENOUGH` or `chroma > 30`. The gap
  // is defined as `PAPER_LUMA - DARK_ENOUGH` precisely so this reduces to it, which is
  // what keeps `MIN_INK_SHARE`'s corpus derivation valid.
  assert.equal(PAPER_LUMA - groundOf(undefined).luma, 0, 'the default ground is the paper');
  assert.equal(groundOf(undefined).chroma, PAPER_CHROMA);
  assert.equal(groundOf('not a colour').luma, PAPER_LUMA, 'a bad hex falls back, never throws');

  const lumaOf = (p: [number, number, number]): number =>
    0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  // A neutral ramp: everything below the old threshold is ink, everything above is paper,
  // and the boundary has not moved.
  for (let v = 200; v <= 255; v += 5) {
    const px: [number, number, number] = [v, v, v];
    const expected = lumaOf(px) < DARK_ENOUGH ? 1 : 0;
    assert.equal(
      statFrame(frame(px), 1, 1).ink,
      expected,
      `grey ${v} on the default paper (luma ${lumaOf(px).toFixed(1)})`,
    );
  }
  // Omitting the paper and naming it are the same measurement.
  const mixed = frame(hex(LIGHT), hex('#1b232e'), hex('#2f6fed'), [250, 250, 250]);
  assert.equal(statFrame(mixed, 4, 1).ink, statFrame(mixed, 4, 1, LIGHT).ink);
});
