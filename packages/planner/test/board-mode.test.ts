/**
 * The wiping board: one idea, one card.
 *
 * Two things are being pinned here and they pull in opposite directions. The first
 * is that `board: 'wipe'` really changes the board — one cell, no grid, ink that
 * goes out, a recap that draws a summary instead of pulling back over one. The
 * second is that it changes *nothing at all* at the default, byte for byte,
 * because the two shipped lessons are the only proof this repo has that a
 * presentation change did not silently rewrite every existing video.
 *
 * The second half is not covered by `sbhash.mts`: that tool hashes
 * `compileLesson()`'s output, and the risk it cannot see is a zod default on
 * `meta.board` — which would be injected by the `parseStoryboard` that `cast.ts`
 * runs the compiled storyboard back through, land in every project's
 * `storyboard.json`, and move `renderFingerprint` for every cached render.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { Element, Scene, Storyboard } from '@inkcast/core';
import { parseStoryboard } from '@inkcast/core';
import { applyBoardMode, compileLesson } from '../src/compile.js';
import { readLessonFile } from '../src/lesson-io.js';
import { PRESETS } from '../src/presets.js';

const lessonPath = (name: string): string =>
  path.resolve(import.meta.dirname, `../../../examples/lessons/${name}.lesson.json`);
const gradient = await readLessonFile(lessonPath('gradient-descent'));
const longitude = await readLessonFile(lessonPath('longitude'));

const wiped = compileLesson(gradient, { preset: 'standard', board: 'wipe' });
const kept = compileLesson(gradient, { preset: 'standard' });

const every = (sb: Storyboard): Element[] => sb.scenes.flatMap((s) => s.elements);

test('a wiping board is one card, drawn in the same place every beat', () => {
  const regions = new Set(wiped.scenes.map((s) => s.region));
  assert.deepEqual([...regions], ['board'], 'one region, and every beat is in it');
  // Non-vacuous: the same lesson at the default lays a grid of several regions.
  assert.ok(new Set(kept.scenes.map((s) => s.region)).size > 1, 'accumulate still grids');

  // `scene.region` must stay set: `resolveFraming` keeps the authored camera and
  // reports `derived: false` for a non-recap scene with no region, which would hand
  // framing back to the planner and undo the whole phase.
  for (const scene of wiped.scenes) assert.ok(scene.region, `${scene.id} kept its region key`);

  // The canvas is one cell plus its border, so there is nowhere else to draw.
  assert.ok(
    wiped.canvas.w < kept.canvas.w / 3 && wiped.canvas.h < kept.canvas.h / 3,
    `wiped canvas ${wiped.canvas.w}x${wiped.canvas.h} vs ${kept.canvas.w}x${kept.canvas.h}`,
  );
  const shots = new Set(wiped.scenes.map((s) => `${s.camera.x},${s.camera.y},${s.camera.zoom}`));
  assert.equal(shots.size, 1, 'every beat is the same shot of the same cell');
});

test('every element goes out, and the ones a later beat needs go out later', () => {
  assert.equal(
    every(kept).filter((el) => !el.persist).length,
    0,
    'nothing on the accumulating board is non-persistent — the control is clean',
  );
  const closing = new Set((wiped.scenes.at(-1) as Scene).elements.map((el) => el.id));
  assert.deepEqual(
    every(wiped)
      .filter((el) => el.persist && !closing.has(el.id))
      .map((el) => el.id),
    [],
    'a wiping board keeps nothing but the card it ends on',
  );
  // And it does end on one: wiping the last card spends the closing hold and the
  // whole outro on an empty board, which is a fade nobody is waiting for.
  assert.ok(
    (wiped.scenes.at(-1) as Scene).elements.every((el) => el.persist),
    'the closing card stays up — there is no next card to make room for',
  );

  // The keep-set. `findReuse` puts the beat that annotates a drawing and the beat
  // that morphs it into the same cell, and `morph.fromId` reshapes ink drawn two
  // scenes earlier: fading it at its own scene's end bends a shape whose alpha is
  // already zero, and every existing test still passes.
  const indexOf = new Map(wiped.scenes.map((s, i) => [s.id, i]));
  const aliveAt = (el: Element, own: number): number =>
    el.persistUntil === undefined ? own : (indexOf.get(el.persistUntil) ?? -1);
  const home = new Map<string, number>();
  wiped.scenes.forEach((s, i) => {
    for (const el of s.elements) home.set(el.id, i);
  });

  let morphs = 0;
  wiped.scenes.forEach((scene, i) => {
    for (const el of scene.elements) {
      const pointed: string[] = [];
      if (el.type === 'emphasis') pointed.push(el.targetId);
      if (el.morph) {
        morphs++;
        pointed.push(el.morph.fromId, ...(el.morph.retires ?? []));
      }
      for (const id of pointed) {
        const at = home.get(id);
        if (at === undefined) continue;
        const target = wiped.scenes[at]?.elements.find((e) => e.id === id);
        assert.ok(target, `${id} is on scene ${at}`);
        assert.ok(
          aliveAt(target, at) >= i,
          `${el.id} points at ${id}, which left the board at scene ${aliveAt(target, at)}`,
        );
      }
    }
  });
  // The gradient-descent bridge beat is the reason this test exists.
  assert.ok(morphs > 0, 'this lesson still morphs one beat into another');

  // And an element only carries the field when it changes something.
  for (const [id, at] of home) {
    const el = wiped.scenes[at]?.elements.find((e) => e.id === id) as Element;
    if (el.persistUntil !== undefined) {
      assert.ok(aliveAt(el, at) > at, `${id} names its own scene, which says nothing`);
    }
  }
});

test('only the closing card is exempt — not everything the closing card names', () => {
  // Straight at `applyBoardMode`, because `compileLesson` cannot build this board: the
  // only beat that points backwards is the bridge, and `findReuse` will only make a
  // `step` the bridge, never the recap. That is why the broadened test — keep anything
  // whose keep-set *reaches* the last scene, rather than the last scene's own ink —
  // passed every check in this file while pinning ink from beat 0 across the whole film.
  const scenes = parseStoryboard({
    version: 1,
    title: 'a recap that points backwards',
    meta: { board: 'wipe' },
    scenes: [
      {
        id: 's0',
        narration: 'The ground under you slopes away.',
        durationSec: 2,
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'hill',
            type: 'path',
            points: [
              { x: 0, y: 0 },
              { x: 400, y: 200 },
            ],
            at: { x: 0, y: 0, w: 400, h: 200 },
          },
        ],
      },
      {
        id: 's1',
        narration: 'Step where it drops fastest.',
        durationSec: 2,
        camera: { x: 0, y: 0 },
        elements: [
          { id: 'step', type: 'text', text: 'downhill', at: { x: 0, y: 300, w: 400, h: 80 } },
        ],
      },
      {
        id: 's2',
        narration: 'That slope was the whole idea.',
        role: 'recap',
        durationSec: 2,
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'summary',
            type: 'text',
            text: 'follow the slope',
            at: { x: 0, y: 600, w: 400, h: 80 },
          },
          {
            id: 'ring',
            type: 'emphasis',
            targetId: 'hill',
            effect: 'circle',
            at: { x: 0, y: 0, w: 400, h: 200 },
          },
        ],
      },
    ],
  }).scenes;
  applyBoardMode(
    scenes,
    new Map([
      [0, [0]],
      [1, [1]],
      [2, [2]],
    ]),
  );

  const el = (scene: number, id: string): Element => {
    const found = scenes[scene]?.elements.find((e) => e.id === id);
    assert.ok(found, `no ${id} on scene ${scene}`);
    return found;
  };
  // The hillside is wanted until the recap circles it, and not one card longer. Kept
  // `persist: true` it never leaves at all: it is drawn across every intervening card,
  // and core's framing history holds it `until: Infinity`, which widens the frame for
  // ink that is meant to be gone — the accumulation this mode exists to remove.
  assert.equal(el(0, 'hill').persist, false, 'the recap naming it is not a reprieve');
  assert.equal(el(0, 'hill').persistUntil, 's2', 'it stays until the card that names it');
  assert.equal(el(1, 'step').persist, false);
  assert.equal(el(1, 'step').persistUntil, undefined, 'nothing points at it — its own beat');
  // And the exemption still applies where it was always meant to: the last card.
  for (const closing of scenes[2]!.elements) {
    assert.equal(closing.persist, true, `${closing.id} is on the closing card and stays`);
    assert.equal(closing.persistUntil, undefined);
  }
});

test('a wiped recap draws its own summary, because there is no board behind it', () => {
  const recap = wiped.scenes.at(-1) as Scene;
  assert.equal(recap.role, 'recap');
  // Furniture does not count: a heading and a rule over an empty cell is the frame
  // this phase exists to stop. The mechanism is `recapChain`, which already fires for
  // a recap that asked for no picture of its own — the point of pinning it here is
  // that under `wipe` it is the only thing between the film and ending on nothing,
  // where under `accumulate` the board itself was the summary.
  const drawn = recap.elements.filter((el) => el.type !== 'text' && el.type !== 'emphasis');
  assert.ok(
    drawn.length > 0,
    `the recap drew only ${recap.elements.map((e) => e.type).join(', ')}`,
  );

  // And it takes the ordinary pan. The 1.3s pull-back is a crossfade between two
  // shots of the same cell when there is nothing behind the card to reveal.
  assert.equal(recap.camera.transition, 0.45, 'no slow pull-back over a board that is not there');
  assert.equal(
    (kept.scenes.at(-1) as Scene).camera.transition,
    1.3,
    'the accumulating recap still gets the slowest shot in the film',
  );
});

test('at the default the mode is absent, not defaulted, in every storyboard', () => {
  // A `.default('accumulate')` on `StoryboardMeta` would pass every assertion above
  // and still rewrite every `storyboard.json` on disk through `cast.ts`'s reparse.
  for (const lesson of [gradient, longitude]) {
    for (const preset of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const sb = compileLesson(lesson, { preset });
      assert.equal('board' in sb.meta, false, `${preset} wrote a board key nobody asked for`);
      assert.deepEqual(
        JSON.parse(JSON.stringify(parseStoryboard(sb))),
        JSON.parse(JSON.stringify(sb)),
        `${preset} does not survive the reparse cast.ts performs`,
      );
      assert.equal(
        every(sb).some((el) => el.persistUntil !== undefined),
        false,
        `${preset} wrote persistUntil onto an accumulating board`,
      );
    }
  }
});

test('a wiped storyboard survives the same reparse', () => {
  const again = parseStoryboard(wiped);
  assert.equal(again.meta.board, 'wipe');
  assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(wiped)));
});
