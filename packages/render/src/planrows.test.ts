/**
 * `planhash`'s two modes, and the property that makes the second one worth having.
 *
 * The done-bar of plan item 7.2 is a claim about what each mode is blind to: a `hold`
 * change is a schedule change and nothing else, so it must be invisible in the default
 * mode (which exists to answer "did the drawn geometry move?") and visible in `--timing`.
 * Both halves are asserted here, because either one failing alone makes the tool lie in a
 * different direction — a default mode that saw timing would cry wolf on every
 * re-narration, and a timing mode that missed a hold would be a mode with no reason to
 * exist.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard, type Storyboard } from '@inkcast/core';
import type { RenderPlan } from './types.js';
import { lessonStoryboard, planWithVisuals } from './fixture.js';
import { planRows } from './planrows.js';

/** The same storyboard with one scene held longer. Nothing else moves. */
function held(sb: Storyboard, scene: number, extra: number): Storyboard {
  const next = structuredClone(sb) as Storyboard;
  const target = next.scenes[scene];
  assert.ok(target, `no scene ${scene} in the fixture`);
  target.hold = target.hold + extra;
  return parseStoryboard(next);
}

test('a hold change shows in --timing and not in the default mode', async () => {
  const sb = lessonStoryboard();
  const before = await planWithVisuals(sb);
  const after = await planWithVisuals(held(sb, 1, 1.5));

  assert.deepEqual(
    planRows('fixture', after),
    planRows('fixture', before),
    'a longer hold draws exactly the same ink — the default mode must stay silent, or it ' +
      'reports a diff on every re-narration and nobody trusts it',
  );

  const timedBefore = planRows('fixture', before, { timing: true });
  const timedAfter = planRows('fixture', after, { timing: true });
  assert.notDeepEqual(timedAfter, timedBefore, 'the schedule moved and --timing must say so');

  // Specifically: the film is 1.5s longer, the held scene says so, and every item after
  // it starts later. A mode that only changed the board line would pass `notDeepEqual`
  // and still be useless.
  const board = (rows: string[]): string => rows.find((r) => r.includes('\t(board)\twhen\t')) ?? '';
  assert.notEqual(board(timedAfter), board(timedBefore));
  const moved = timedAfter.filter((row, i) => row !== timedBefore[i]);
  assert.ok(moved.length > 3, `only ${moved.length} row(s) moved for a 1.5s hold`);
});

test('the default rows carry no timing at all, and --timing only appends', () => {
  // The compatibility rule the header states: both modes emit the same first five
  // columns, so a `before.txt` from one still diffs line-for-line against an `after.txt`
  // from the other. Only the extra columns are new.
  const plan: RenderPlan = {
    version: 1,
    fps: 30,
    duration: 10,
    frame: { w: 1920, h: 1080 },
    aspect: '16:9',
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    paper: '#fff',
    ink: '#000',
    grid: null,
    gridStep: 40,
    style: 'marker',
    fontFamily: 'InkcastHand, cursive',
    scale: 1,
    typeScale: 1,
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    fill: [0.2],
    scenes: [
      {
        id: 's0',
        start: 0,
        dur: 10,
        speech: 9,
        hold: 1,
        camera: { x: 0, y: 0, zoom: 1, transition: 0 },
      },
    ],
    items: [
      {
        id: 'a',
        scene: 0,
        order: [0, 0],
        start: 1.5,
        dur: 0.8,
        style: 'draw',
        persist: true,
        sceneEnd: 10,
        center: [0, 0],
        prims: [{ kind: 'geom', d: 'M0 0 L1 1', stroke: '#000', strokeWidth: 2, fill: 'none' }],
      },
    ],
    pen: { parts: [], unit: 1, baseAngle: 0, follow: 1 },
  };

  const plain = planRows('x', plan);
  const timed = planRows('x', plan, { timing: true });
  assert.equal(plain.length, 2, 'a board line and one item');
  assert.equal(timed.length, 4, 'plus the board timing line and one scene line');

  const item = plain[1]?.split('\t') ?? [];
  const timedItem = timed[3]?.split('\t') ?? [];
  assert.deepEqual(timedItem.slice(0, 6), item, 'the shared columns must be identical');
  assert.equal(timedItem[6], '1.500+0.800', 'start and duration, in milliseconds');
  assert.equal(timedItem.length, 8, 'and one hash for the rest of the schedule');
  assert.ok(
    !plain.some((r) => /\t1\.5|\t10\.000s/.test(r)),
    'no timing may leak into the default rows',
  );
});
