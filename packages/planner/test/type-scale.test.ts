/**
 * The type scales, held to each other by something that runs.
 *
 * Defect 0 in `docs/HANDOFF.md` is "three uncoordinated type catalogs": `FONT` in
 * `src/elements.ts`, which the compiler reserves text boxes at; `TYPE_SCALE` in
 * `@inkcast/core`, which the renderer draws at; and `ROLE_SCALE` in
 * `visuals/src/style.ts`, which sized diagram labels and plot captions. The obvious fix is
 * to delete two of them, and it has been tried from both ends:
 *
 * - making the renderer draw at the planner's numbers — reverted in `45d4ff9`, three
 *   render tests red and every film's type 21% smaller;
 * - making the planner reserve at the renderer's numbers — attempted in the launch build
 *   and reverted, because it moves all four pinned storyboard hashes and rewrites 330
 *   geometric values on `gradient-descent` alone, with no character of text changed and no
 *   frame to show it helped.
 *
 * The reason neither works is that two of the three are in different units. `TYPE_SCALE` is
 * output pixels on a 1080-tall frame; `FONT` is canvas units, and `boardMetrics` converts
 * between them by a factor the camera decides — measured at 0.511 to 1.667 across the six
 * boards in this repository. One table cannot be both.
 *
 * So one catalogue really did go (`ROLE_SCALE`, which was a *fraction of canvas height*
 * under the assumption that the whole canvas is on screen, and is therefore the same unit
 * as pixels and now derived), and the two that are left are held to each other by
 * `TYPE_RATIO` plus this file. What this catches is the failure that actually happened:
 * not a wrong number, but a number changed on one side while the other kept the old one
 * and nothing said so. `ROLE_SCALE.title` had drifted 8% below `TYPE_SCALE.title` and sat
 * there through a shipped film.
 *
 * It deliberately does **not** assert that these are the right sizes. They are not: the
 * right sizes need the framing, which does not exist until after the compiler has run, and
 * that fixed point moves all four pinned hashes by design (`docs/PLAN-LAUNCH.md` A7,
 * `docs/STATUS.md` 2026-08-09: "a decision for a person").
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { TYPE_SCALE } from '@inkcast/core';
import { FONT, TYPE_RATIO } from '../src/elements.js';

const ROLES = ['title', 'heading', 'body', 'label', 'caption'] as const;

test('every role the renderer can draw is a role the compiler can measure', () => {
  // The cheapest half of the guard, and the one a new role trips. A role in `TYPE_SCALE`
  // with no entry in `FONT` would be reserved as `undefined` and land as `NaN` in a box;
  // one in `FONT` with no `TYPE_SCALE` entry is a size the renderer has no opinion about.
  assert.deepEqual(Object.keys(TYPE_SCALE).sort(), [...ROLES].sort());
  assert.deepEqual(Object.keys(FONT).sort(), [...ROLES].sort());
  assert.deepEqual(Object.keys(TYPE_RATIO).sort(), [...ROLES].sort());
});

test('the two catalogues stay in the stated ratio, or this names the one that moved', () => {
  for (const role of ROLES) {
    const actual = FONT[role] / TYPE_SCALE[role];
    assert.ok(
      Math.abs(actual - TYPE_RATIO[role]) <= 0.04,
      `${role}: the compiler reserves ${FONT[role]} canvas units against the renderer's ` +
        `${TYPE_SCALE[role]} px, a ratio of ${actual.toFixed(3)} where ${TYPE_RATIO[role].toFixed(3)} ` +
        `is recorded in TYPE_RATIO. One of the two tables moved without the other. If that ` +
        `was the point, note in TYPE_RATIO which side changed and why; if it was not, this ` +
        `is defect 0 reopening — see the header of src/elements.ts before changing a size`,
    );
  }
});

test('the roles keep their order in both catalogues', () => {
  // A ratio band cannot see a swap: exchange `label` and `caption` on one side only and
  // every individual ratio stays inside 0.04 of nothing in particular, while a caption is
  // suddenly reserved larger than the label above it. Descending weight is the property
  // both tables are actually promising, and `TEXT_WEIGHT` in `src/compile.ts` walks the
  // roles assuming it when emphasis moves a text one step up the scale.
  for (let i = 1; i < ROLES.length; i++) {
    const [big, small] = [ROLES[i - 1]!, ROLES[i]!];
    assert.ok(FONT[big] > FONT[small], `FONT: ${big} is not larger than ${small}`);
    assert.ok(
      TYPE_SCALE[big] > TYPE_SCALE[small],
      `TYPE_SCALE: ${big} is not larger than ${small}`,
    );
  }
});

// The third catalogue's half of this lives in `visuals/test/type-scale.test.ts`: the
// planner does not depend on `@inkcast/visuals` and must not start to for a test's sake.
