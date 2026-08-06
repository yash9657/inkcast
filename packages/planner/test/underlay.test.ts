/**
 * The hybrid drawing lane's geometry.
 *
 * Every test here is about one claim: **the picture and the marks aimed at it go through
 * one transform.** If they do not, a leader arrow lands a little way off the structure it
 * names, which looks exactly like the model being bad at aiming and would be diagnosed
 * wrong. It is arithmetic, so it is checked as arithmetic.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DRAW_H, DRAW_W, type Mark } from '@inkcast/core';
import { boxAt, fitCanvas, prepareMarks } from '../src/drawing.js';
import { auditDrawing } from '../src/draw-audit.js';
import { UNDERLAY_AREA, readInkBox, underlayAsset, underlayInkBox } from '../src/underlay.js';

/** Marks carry schema defaults the tests do not care about. As `draw-audit.test.ts`. */
const mark = (m: Partial<Mark> & { id: string; kind: Mark['kind'] }): Mark => ({
  closed: false,
  smooth: false,
  dashed: false,
  ...m,
});

test('a generated subject is placed by its ink, centred, and never stretched', () => {
  // The heart the lane was built on: 496x798 of a 1024 square, so a tall subject with a
  // wide white margin around it. It should come out full height and narrow, centred.
  const box = underlayInkBox({ w: 496, h: 798 });
  assert.equal(Math.round(box.h), DRAW_H);
  assert.equal(Math.round(box.w), Math.round((496 / 798) * DRAW_H));
  assert.ok(Math.abs(box.x + box.w / 2 - DRAW_W / 2) < 0.001, 'centred horizontally');
  assert.ok(Math.abs(box.y + box.h / 2 - DRAW_H / 2) < 0.001, 'centred vertically');
  // Aspect preserved to the last decimal: a stretched heart is still a heart, and every
  // mark aimed at it was aimed at the unstretched one.
  assert.ok(Math.abs(box.w / box.h - 496 / 798) < 1e-9);

  // A wide subject is capped by the reserved area rather than by the canvas, so there is
  // always clear board left for the names.
  const wide = underlayInkBox({ w: 2000, h: 500 });
  assert.equal(Math.round(wide.w), UNDERLAY_AREA.w);
  assert.ok(wide.x >= (DRAW_W - UNDERLAY_AREA.w) / 2 - 0.001);
});

test('the picture and the marks share one transform', () => {
  // The claim the whole lane rests on. A mark the author put at the centre of the ink box
  // has to land at the centre of the drawn picture, whatever box the beat gives it.
  const ink = underlayInkBox({ w: 496, h: 798 });
  for (const cell of [
    { x: 0, y: 0, w: 1000, h: 560 },
    { x: 110, y: 70, w: 1700, h: 940 },
    { x: 42, y: 17, w: 640, h: 300 },
  ]) {
    const fit = fitCanvas(cell);
    const placed = boxAt(fit, ink);
    // A point at the middle of the ink box, taken through the mark path.
    const markX = fit.ox + (ink.x + ink.w / 2) * fit.s;
    const markY = fit.oy + (ink.y + ink.h / 2) * fit.s;
    assert.ok(Math.abs(markX - (placed.x + placed.w / 2)) < 0.02, 'x agrees');
    assert.ok(Math.abs(markY - (placed.y + placed.h / 2)) < 0.02, 'y agrees');
    // And the picture is never stretched on the way, so the aspect the asset is resolved
    // at is the aspect its element's box has.
    // Rounded to two canvas units by `boxAt`, which on a small cell is a few thousandths
    // of a unit of aspect — far below anything a leader arrow could notice.
    assert.ok(Math.abs(placed.w / placed.h - ink.w / ink.h) < 1e-4);
  }
});

test('canvas fit uses the whole canvas, where content fit would rescale the marks', () => {
  // Content fit is right for a drawing that is only its own marks and catastrophic for one
  // aimed at something else: twenty marks in the middle of the board would be blown up to
  // fill the cell while the picture under them stayed where it was.
  const cell = { x: 0, y: 0, w: 2000, h: 1120 };
  const fit = fitCanvas(cell);
  assert.equal(fit.s, 2);
  assert.deepEqual(boxAt(fit, { x: 0, y: 0, w: DRAW_W, h: DRAW_H }), {
    x: 0,
    y: 0,
    w: 2000,
    h: 1120,
  });
});

test('a name may not be written on the generated picture', () => {
  const ink = underlayInkBox({ w: 496, h: 798 });
  const marks: Mark[] = [
    mark({ id: 'av-node', kind: 'ellipse', x: 480, y: 260, w: 24, h: 24 }),
    // Placed in the middle of the organ, where `inkOf` sees nothing at all.
    mark({ id: 'av-label', kind: 'label', x: 500, y: 300, text: 'AV node', size: 30 }),
  ];

  // Blind to the picture, this is free space and the label is left exactly where it was.
  const blind = prepareMarks(marks);
  assert.equal(blind.find((m) => m.id === 'av-label')?.x, 500);
  assert.equal(
    auditDrawing(blind).some((d) => d.kind === 'label-on-ink'),
    false,
  );

  // Told about the picture, the repair moves it clear.
  const seeing = prepareMarks(marks, ink);
  const moved = seeing.find((m) => m.id === 'av-label');
  assert.ok(moved);
  const inside = (moved.x ?? 0) > ink.x && (moved.x ?? 0) < ink.x + ink.w;
  assert.equal(inside, false, 'the name is off the picture');
  assert.deepEqual(auditDrawing(seeing, ink), []);
});

test('an underlay asset is derived identically wherever it is derived', () => {
  // The seam generates the image under this id and the compiler mints an asset with it.
  // A text-to-image model is not a function, so an id that differed by one character
  // between the two would annotate a picture nobody can see any more.
  const prompt = 'a human heart, anatomical, external front view, whole organ with great vessels';
  const a = underlayAsset(prompt);
  assert.deepEqual(underlayAsset(`  ${prompt}  `), a, 'whitespace does not change the asset');
  assert.match(a.id, /^underlay-/);
  assert.equal(a.prompt, prompt, 'the prompt goes through verbatim');
});

test('a recorded ink box is only believed when it is four usable numbers', () => {
  assert.deepEqual(readInkBox([10, 20, 30, 40]), { x: 10, y: 20, w: 30, h: 40 });
  assert.equal(readInkBox(undefined), undefined);
  assert.equal(readInkBox([1, 2, 3]), undefined);
  assert.equal(readInkBox([1, 2, 0, 40]), undefined, 'a zero-width picture places nothing');
  assert.equal(readInkBox([1, 2, Number.NaN, 40]), undefined);
});
