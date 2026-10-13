/**
 * `set-camera` speaks about the board, never about the canvas — plan item 5.6, audit A-2.
 *
 * The op used to take `x`, `y` and `zoom` and write them into the IR verbatim, which made
 * it the one place in the product where a raw coordinate reached the storyboard without
 * anything checking it against the board it was pointing at. Every other coordinate in a
 * film is solved: `resolveFraming` derives each camera from what its scene draws, and A-3
 * passes because of that. A model handed `x` and `y` produces a camera nothing could be
 * wrong about — and its failure mode is a whole beat framed on empty canvas.
 *
 * What is asserted here: the raw fields are gone from the schema, the intents produce the
 * framing the *solver* would have chosen (`fitCamera`, the renderer's own arithmetic), and
 * no request — however extreme — can walk the viewport off the canvas.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { frameSize, parseStoryboard, viewRect, type Storyboard } from '@inkcast/core';
import { EDIT_OPS_SCHEMA, EditError, applyOps, parseInstruction } from '../src/ops.js';

function board(): Storyboard {
  const box = (id: string, x: number, y: number, w: number, h: number) => ({
    id,
    type: 'text' as const,
    text: id,
    at: { x, y, w, h },
    enter: { at: 0 },
  });
  return parseStoryboard({
    version: 1,
    title: 'a wide board',
    canvas: { x: 0, y: 0, w: 3920, h: 1380 },
    scenes: [
      {
        id: 's1',
        narration: 'The encoder takes the sentence apart.',
        camera: { x: 960, y: 690, zoom: 2 },
        elements: [box('encoder', 200, 300, 600, 200), box('corner', 3700, 1300, 120, 60)],
      },
      {
        id: 's2',
        narration: 'The decoder puts it back together again.',
        camera: { x: 2960, y: 690, zoom: 2 },
        elements: [box('decoder', 2400, 300, 600, 200)],
      },
    ],
  }) as Storyboard;
}

/** Is this camera's viewport inside the canvas (or centred, when it cannot fit)? */
function inside(sb: Storyboard, i: number): boolean {
  const scene = sb.scenes[i]!;
  const view = viewRect(scene.camera, sb.canvas, frameSize(sb.meta.aspect));
  if (view.w >= sb.canvas.w || view.h >= sb.canvas.h) {
    return Math.abs(scene.camera.x - (sb.canvas.x + sb.canvas.w / 2)) < 1;
  }
  return (
    view.x >= sb.canvas.x - 1 &&
    view.y >= sb.canvas.y - 1 &&
    view.x + view.w <= sb.canvas.x + sb.canvas.w + 1 &&
    view.y + view.h <= sb.canvas.y + sb.canvas.h + 1
  );
}

test('the op schema offers no coordinates at all', () => {
  const props = EDIT_OPS_SCHEMA.properties.ops.items.properties as Record<string, unknown>;
  for (const gone of ['x', 'y', 'zoom']) {
    assert.equal(props[gone], undefined, `set-camera must not offer "${gone}" any more`);
  }
  // What it does offer: the two intents and a duration.
  assert.deepEqual((props.framing as { enum: string[] }).enum, ['tighter', 'wider']);
  assert.ok(props.on && props.transition);
});

test('tighter and wider step the framing the scene already has', () => {
  const inward = applyOps(board(), [{ op: 'set-camera', scene: 's1', framing: 'tighter' }]);
  assert.equal(inward.storyboard.scenes[0]!.camera.zoom, 2.5);
  const outward = applyOps(inward.storyboard, [
    { op: 'set-camera', scene: 's1', framing: 'wider' },
  ]);
  // In then out returns to where it started, which is what makes a step reversible.
  assert.equal(outward.storyboard.scenes[0]!.camera.zoom, 2);
  assert.match(inward.applied[0]!, /scene s1 camera tighter/);
  // The other scene is untouched: framing is per scene, as the op says.
  assert.deepEqual(inward.storyboard.scenes[1]!.camera, board().scenes[1]!.camera);
});

test('framing an element centres on that element, by the renderer’s own arithmetic', () => {
  const { storyboard, applied } = applyOps(board(), [
    { op: 'set-camera', scene: 's2', on: 'decoder' },
  ]);
  const cam = storyboard.scenes[1]!.camera;
  const view = viewRect(cam, storyboard.canvas, frameSize(storyboard.meta.aspect));
  const el = storyboard.scenes[1]!.elements.find((e) => e.id === 'decoder')!;
  // The element is inside the frame, and the frame is not much bigger than it — this is a
  // close-up, not a pull-back that happens to contain it.
  assert.ok(view.x <= el.at.x && view.x + view.w >= el.at.x + el.at.w, 'the element must fit');
  assert.ok(view.y <= el.at.y && view.y + view.h >= el.at.y + el.at.h);
  assert.ok(view.w < storyboard.canvas.w / 2, `the view is ${Math.round(view.w)} units wide`);
  assert.match(applied[0]!, /camera on decoder/);
  assert.ok(inside(storyboard, 1));

  // An element that does not exist is the caller's mistake, and is refused rather than
  // silently framing nothing.
  assert.throws(
    () => applyOps(board(), [{ op: 'set-camera', scene: 's2', on: 'nobody' }]),
    /nobody/,
  );
});

test('no request can walk the viewport off the canvas', () => {
  // `corner` sits in the bottom-right of a 3920×1380 board, and framing it tightly would
  // put half the viewport outside the canvas — the defect `layoutStoryboard`'s own clamp
  // exists to prevent, applied here so an edit cannot produce a framing the solvers never
  // would.
  const framed = applyOps(board(), [{ op: 'set-camera', scene: 's1', on: 'corner' }]);
  assert.ok(inside(framed.storyboard, 0), 'framing a corner element must stay on the board');

  // And a step so far out that the viewport exceeds the canvas centres instead of
  // sliding, because there is nothing left to slide against.
  let wide = board();
  for (let i = 0; i < 12; i++) {
    wide = applyOps(wide, [{ op: 'set-camera', scene: 's1', framing: 'wider' }]).storyboard;
  }
  assert.ok(inside(wide, 0));
});

test('retiming a scene moves nothing but the time', () => {
  // `transition` is a duration, not a framing, so it must not drag the camera through the
  // canvas clamp on its way past. An authored camera sitting partly off-canvas is somebody's
  // decision; an op that quietly recentres it while being asked about seconds is the class
  // of defect this whole item is about.
  const board_ = board();
  board_.scenes[0]!.camera = { x: 40, y: 40, zoom: 6, transition: 0.9 };
  const { storyboard } = applyOps(board_, [{ op: 'set-camera', scene: 's1', transition: 0 }]);
  assert.deepEqual(storyboard.scenes[0]!.camera, { x: 40, y: 40, zoom: 6, transition: 0 });
});

test('a set-camera that asks for nothing is refused, not silently applied', () => {
  // The old op could be sent with no fields at all and would report a camera change that
  // changed nothing. A no-op that logs as an edit is how a broken edit path looks healthy.
  assert.throws(
    () => applyOps(board(), [{ op: 'set-camera', scene: 's1' }]),
    (err: unknown) => err instanceof EditError && /asked for nothing/.test(String(err)),
  );
});

test('the zero-key parser reads "zoom in on <element>" as framing that element', () => {
  // The request people actually type, and the one the old parser could not express: `on
  // decoder` was read as a scene reference and thrown away.
  assert.deepEqual(parseInstruction(board(), 'zoom in on decoder'), [
    { op: 'set-camera', scene: 's2', on: 'decoder' },
  ]);
  // A scene reference still means the scene, and with neither it means every scene.
  assert.deepEqual(parseInstruction(board(), 'zoom in on scene 1'), [
    { op: 'set-camera', scene: '1', framing: 'tighter' },
  ]);
  assert.deepEqual(parseInstruction(board(), 'zoom out'), [
    { op: 'set-camera', scene: 's1', framing: 'wider' },
    { op: 'set-camera', scene: 's2', framing: 'wider' },
  ]);
});
