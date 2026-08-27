/**
 * The seam between the drawing author and the picture it is annotating.
 *
 * Two claims, and both are the kind that fail silently. **The author is shown the picture**
 * — a figure that reaches the board unseen gets composed under the blank-board brief and
 * comes back as a second drawing laid over the first, which is a defect nobody can see in a
 * diff and everybody can see in the film. And **the marks and the picture agree about one
 * box**, because a leader arrow aimed at a box the compiler does not use lands on empty
 * paper and reads as the model being bad at aiming.
 *
 * Nothing here needs a key, a browser or an image provider: the figure seam is a function,
 * so the test supplies one and records what it was asked for. `ANTHROPIC_API_KEY` is
 * deliberately cleared — `underlayFor` runs before any model call, and a test that could
 * reach a provider is a test that bills someone.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DRAW_H, DRAW_W, VisualIntent } from '@inkcast/core';
import type { DrawFigure } from '../src/draw-anthropic.js';
import { drawKey, underlayFor } from '../src/draw-anthropic.js';
import { FIGURE_AREA, figureBox } from '../src/underlay.js';
import type { Box } from '../src/elements.js';
import type { LessonOptions } from '../src/types.js';

delete process.env.ANTHROPIC_API_KEY;

/**
 * The options bag with the figure seam on it.
 *
 * Spelled out here because `LessonOptions` does not declare `drawFigure` yet, and an object
 * literal is checked for excess properties — so this intersection is also the smallest
 * honest statement of what the shared stage surface has to grow before any caller with an
 * image provider can supply the seam at all.
 */
type Opts = LessonOptions & { drawFigure?: DrawFigure };

/** A tiny valid-enough PNG header. Only its bytes matter — nothing here decodes it. */
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const OTHER_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9, 9]);

const HEART = 'a human heart in cross-section';

const intentFor = (kind: 'form' | 'figure', inkBox?: number[]): VisualIntent =>
  VisualIntent.parse({
    kind: 'draw',
    describe: 'name the two upper chambers with a leader to the word atria',
    underlay: { kind, prompt: HEART, ...(inkBox ? { inkBox } : {}) },
  });

/**
 * The keys every drawing on every developer's machine is already cached under.
 *
 * Pinned, not derived, and that is the point: the cache key is built from the brief's own
 * text, so if either of these numbers moves, every blank-board and every form drawing ever
 * composed has been silently thrown away — which looks like nothing at all until the next
 * run costs a model call per picture.
 *
 * Re-pinned 2026-08-22, deliberately: `DRAW_BRIEF` and `UNDERLAY_BRIEF` now advertise the
 * ninth mark, `math` (audit S5-b — the briefs said "only these eight" while the schema had
 * nine, so a drawing needing `α|0⟩` had only `label`, the exact D1 defect). Every cached
 * drawing was composed under instructions that omitted typeset mathematics, so throwing
 * the machine cache away is the change working, not collateral. Previous pins:
 * 844b9e3932d9a716 / cc912d96bf0d4df3.
 *
 * Re-pinned 2026-08-26, and **only the blank-board key moved**: `DRAW_BRIEF` gained the two
 * lines about how full a card has to be (`thin-card` in `draw-audit.ts`), while
 * `UNDERLAY_BRIEF` is untouched — so every form drawing on the machine is still served from
 * cache, and the second assertion below is what proves it. That separation is the whole
 * reason `BRIEF_VERSION` was left alone: it is hashed for all three lanes at once, so
 * bumping it would have thrown away two lanes that did not change. The blank-board drawings
 * are thrown away on purpose — they are the corpus that measured a median predicted card
 * fill of 26%, and serving them would be serving the defect the new lines exist to fix.
 * Previous blank-board pin: 9a1f337a8ecd8a07.
 */
test('the draw keys moved with the math-mark brief change, and only then', () => {
  assert.equal(drawKey(HEART), '6f842b7a19191a08');
  assert.equal(drawKey(HEART, PNG), '3d94a24a9cc2b943');
  // `form` is the default the lane has always had, so naming it has to be free.
  assert.equal(drawKey(HEART, PNG, 'form'), drawKey(HEART, PNG));
});

test('a figure is keyed apart from a form, and apart from another figure', () => {
  const figure = drawKey(HEART, PNG, 'figure');
  assert.notEqual(figure, drawKey(HEART, PNG, 'form'));
  assert.notEqual(figure, drawKey(HEART));
  // The picture is in the key. Two figures for the same words are two different hearts, and
  // marks aimed at the first are wrong about the second.
  assert.notEqual(figure, drawKey(HEART, OTHER_PNG, 'figure'));
});

test('a figure is shown to its author, at the box the compiler will place it in', async () => {
  const asked: { prompt: string; box: Box }[] = [];
  const intent = intentFor('figure');
  const opts: Opts = {
    drawFigure: async (prompt, box) => {
      asked.push({ prompt, box });
      return PNG;
    },
    // Present and must go untouched: a figure is not a form and asking the form seam for one
    // would generate line art under a different cache key, bill for it, and hand the author
    // a picture the film never shows.
    drawUnderlay: async () => {
      assert.fail('a figure must not be routed through the traced-underlay seam');
    },
  };
  const under = await underlayFor(intent, opts);

  assert.ok(under, 'the author gets a picture');
  assert.equal(under.kind, 'figure');
  assert.equal(under.png, PNG);

  // One box, three places: what the seam was asked to draw, what the author is told it is
  // looking at, and what `lesson.json` records for the compiler to place the picture at.
  const box = figureBox();
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.prompt, HEART);
  assert.deepEqual(asked[0]?.box, box);
  assert.deepEqual(under.box, box);
  assert.deepEqual(intent.underlay?.inkBox, [box.x, box.y, box.w, box.h]);

  // And it is a figure's box rather than a form's: most of the board, full height, centred.
  assert.equal(box.w, FIGURE_AREA.w);
  assert.equal(box.h, DRAW_H);
  assert.equal(box.x + box.w / 2, DRAW_W / 2);
});

test('a figure with no seam behaves exactly as it did before it could be seen', async () => {
  const intent = intentFor('figure');
  const under = await underlayFor(intent, {
    drawUnderlay: async () => {
      assert.fail('a figure must not be routed through the traced-underlay seam');
    },
  });
  assert.equal(under, undefined, 'no picture, so the marks are composed as they always were');
  // The box is recorded regardless, because it is what makes the compiler emit the figure at
  // all. Recording it only on success would delete the lane on every unkeyed machine.
  const box = figureBox();
  assert.deepEqual(intent.underlay?.inkBox, [box.x, box.y, box.w, box.h]);
});

test('a figure seam that fails costs the drawing nothing but the picture', async () => {
  const box = figureBox();
  const seams: DrawFigure[] = [
    async () => undefined,
    async () => {
      throw new Error('the provider said no');
    },
  ];
  for (const drawFigure of seams) {
    const intent = intentFor('figure');
    const opts: Opts = { drawFigure };
    assert.equal(await underlayFor(intent, opts), undefined);
    assert.deepEqual(intent.underlay?.inkBox, [box.x, box.y, box.w, box.h]);
  }
});

test('a form still goes to the traced seam, and comes back saying so', async () => {
  const ink = [200, 10, 300, 540];
  const intent = intentFor('form');
  const opts: Opts = {
    drawFigure: async () => {
      assert.fail('a form must not be routed through the figure seam');
    },
    drawUnderlay: async (prompt) => {
      assert.equal(prompt, HEART);
      return { png: PNG, inkBox: ink };
    },
  };
  const under = await underlayFor(intent, opts);
  assert.ok(under);
  assert.equal(under.kind, 'form');
  // The measured box, not a decided one — which is the whole difference between the lanes.
  assert.deepEqual(under.box, { x: 200, y: 10, w: 300, h: 540 });
  assert.deepEqual(intent.underlay?.inkBox, ink);
});

/**
 * A box left over from a picture this run did not generate would place an image the marks
 * never saw. It is cleared before anything is asked for, so it cannot survive a failure.
 */
test('a stale ink box never outlives the run that recorded it', async () => {
  const stale = [1, 2, 3, 4];
  const form = intentFor('form', stale);
  assert.equal(await underlayFor(form, {}), undefined, 'no seam, so no picture');
  assert.equal(form.underlay?.inkBox, undefined);

  // A figure's box is not stale — it is decided from the canvas, so it is rewritten rather
  // than dropped, and the value that lands is the one the compiler agrees with.
  const figure = intentFor('figure', stale);
  await underlayFor(figure, {});
  const box = figureBox();
  assert.deepEqual(figure.underlay?.inkBox, [box.x, box.y, box.w, box.h]);
});
