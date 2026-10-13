/**
 * The third type catalogue is gone, and this is what stops it coming back.
 *
 * `ROLE_SCALE` in `src/style.ts` held its own fractions of canvas height for the IR's five
 * text roles, and `docs/HANDOFF.md` counts it as one of the three uncoordinated type
 * catalogues behind defect 0. Being a *fraction* is what let it drift unnoticed: `title`
 * was 0.082, which on a 1080-tall frame is 88.6 units where the renderer draws 96, so
 * every diagram label, term-card heading and plot caption this lane sized was 8% smaller
 * than the same role elsewhere on the same board, and nothing compared the two.
 *
 * Unlike the other two, this one was a genuine restatement rather than a second unit.
 * `roleFontSize`'s own contract is that the whole canvas is on screen (`PlotTypeSizes` in
 * `src/plot.ts` says so), and when the whole canvas is on screen the canvas *is* the frame
 * — so a fraction of canvas height and a size in output pixels are the same statement, and
 * `TYPE_SCALE[role] / TYPE_REFERENCE_HEIGHT` is the only fraction that can be right.
 *
 * Asserted here rather than left to the derivation, because the derivation is exactly what
 * a later reader "simplifies" back into a literal table — and a literal table is how this
 * started.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { TYPE_REFERENCE_HEIGHT, TYPE_SCALE, frameSize } from '@inkcast/core';
import { roleFontSize } from '../src/style.js';

const ROLES = ['title', 'heading', 'body', 'label', 'caption'] as const;

test('a role is sized here exactly as the renderer sizes it', () => {
  for (const role of ROLES) {
    assert.equal(
      roleFontSize(role, TYPE_REFERENCE_HEIGHT),
      TYPE_SCALE[role],
      `${role} is sized differently by the visuals stage than by the renderer`,
    );
  }
});

test('the reference height is the frame height, not a literal beside it', () => {
  // A hard 1080 here would be a fourth copy of the same kind of fact — the one that
  // decides how tall the output is — and `frameSize` is the function that owns it.
  assert.equal(TYPE_REFERENCE_HEIGHT, frameSize('16:9').h);
});

test('the size is still a fraction of the canvas it is given', () => {
  // The property that makes the derivation legal in the first place. A caller passing half
  // a canvas gets half the type; if this ever became a flat pixel size, plot captions on a
  // 540-unit canvas would come out twice as large as the plot expects.
  assert.equal(
    roleFontSize('caption', TYPE_REFERENCE_HEIGHT / 2) * 2,
    roleFontSize('caption', TYPE_REFERENCE_HEIGHT),
  );
  // And there is a floor, because a fraction of a tiny canvas is unreadable rather than
  // small — the clamp in `roleFontSize` predates all of this and is deliberate.
  assert.equal(roleFontSize('caption', 10), 8);
});

test('an unknown role falls back to body rather than to NaN', () => {
  // `roleFontSize` takes a `TextRole`, which is now keyed off `TYPE_SCALE`, so this is
  // unreachable through the types — and reachable through JSON, which is how every role in
  // this pipeline actually arrives. `TYPE_SCALE[role]` on a miss is `undefined`, and
  // `undefined / 1080` is `NaN`, which reaches an SVG attribute and draws nothing at all.
  const bodged = roleFontSize('subtitle' as (typeof ROLES)[number], TYPE_REFERENCE_HEIGHT);
  assert.equal(bodged, TYPE_SCALE.body);
});
