/**
 * Tier 2's sampler and its two pure checks (plan 3.3).
 *
 * The sampler is the part with a real bug in its history and therefore the part worth
 * pinning: **where you look decides the answer.** Sampling a quarter second before each
 * beat's end is right on an accumulating board and wrong on a wiping one, where the card
 * has already gone out — and the failure is silent, because a photograph of the gap
 * between two cards is a perfectly valid frame with nothing on it. Measured before this
 * read the fade schedule, `cardiac9` and `cardiac10` both reported a sampled frame at
 * 0.00% ink, and both are reviewed films.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonStoryboard, planWithVisuals, wipeStoryboard } from './fixture.js';
import type { Rect } from './types.js';
import { inkFloorViolations, ocrDiff, sampleTimes, textAt, MIN_INK_SHARE } from './tier2.js';

test('one sample per beat on a short film, spanning the whole film on a long one', async () => {
  const plan = await planWithVisuals(lessonStoryboard());
  const times = sampleTimes(plan);
  assert.equal(times.length, plan.scenes.length, 'a film with fewer scenes than samples');
  assert.deepEqual(
    times.map((t) => t.sceneId),
    plan.scenes.map((s) => s.id),
  );
  // Ordered, inside the film, and each inside its own beat.
  times.forEach((t, i) => {
    const s = plan.scenes[i]!;
    assert.ok(t.at >= s.start && t.at <= s.start + s.dur, `${t.sceneId} sampled inside itself`);
  });

  // Capped, and still spanning: first and last beat both represented.
  const few = sampleTimes(plan, 3);
  assert.equal(few.length, 3);
  assert.equal(few[0]?.sceneId, plan.scenes[0]?.id);
  assert.equal(few[2]?.sceneId, plan.scenes[plan.scenes.length - 1]?.id);
});

test('on a wiping board the sample lands before the card goes out, not after', async () => {
  const plan = await planWithVisuals(wipeStoryboard());
  const fading = plan.items.filter((it) => it.fadeAt !== undefined);
  assert.ok(fading.length > 0, 'the fixture is supposed to wipe');

  for (const { at, sceneId } of sampleTimes(plan)) {
    const i = plan.scenes.findIndex((s) => s.id === sceneId);
    const fades = plan.items
      .filter((it) => it.scene === i && it.fadeAt !== undefined)
      .map((it) => it.fadeAt as number);
    if (fades.length === 0) continue;
    // Before the earliest fade even begins — not merely before it completes, which is
    // what `fadeAt` is: a frame taken mid-fade is a frame of ink at half alpha.
    assert.ok(
      at < Math.min(...fades) - 0.5,
      `scene ${sceneId} sampled at ${at.toFixed(2)}s, but its ink starts leaving at ` +
        `${(Math.min(...fades) - 0.55).toFixed(2)}s`,
    );
    // And there is ink on the board at that moment, which is the whole point. Not
    // *text* — a wiping board's beat may be a picture with no words on it — but
    // something drawn and not yet leaving.
    const standing = plan.items.filter(
      (it) => it.start + it.dur <= at && (it.fadeAt === undefined || it.fadeAt > at),
    );
    assert.ok(standing.length > 0, `scene ${sceneId} has ink on the board at ${at.toFixed(2)}s`);
  }
});

test('the ink floor names the beat and the number, and passes a drawn board', () => {
  const drawn = [
    {
      index: 0,
      at: 1.5,
      sceneId: 'hook',
      png: new Uint8Array(),
      ink: MIN_INK_SHARE + 0.01,
      text: [],
    },
  ];
  assert.deepEqual(inkFloorViolations(drawn), []);

  const blank = [
    { index: 1, at: 9.25, sceneId: 'recap', png: new Uint8Array(), ink: 0.001, text: [] },
  ];
  const [v] = inkFloorViolations(blank);
  assert.equal(v?.kind, 'vacant');
  assert.match(v?.message ?? '', /at 9\.3s \(scene recap\) only 0\.10% of the frame/);

  // A frame that could not be decoded is not a frame that was empty.
  assert.deepEqual(
    inkFloorViolations([{ index: 2, at: 0, sceneId: 's', png: new Uint8Array(), text: [] }]),
    [],
  );
});

test('the board the OCR diff expects is the board the camera is pointed at', async () => {
  const plan = await planWithVisuals(lessonStoryboard());
  /** What the old, camera-blind rule expected: everything still standing on the canvas. */
  const standing = (at: number): { text: string; box: Rect }[] => {
    const out: { text: string; box: Rect }[] = [];
    for (const item of plan.items) {
      if (item.start + item.dur > at) continue;
      if (item.sceneEnd < at && !item.persist) continue;
      if (item.fadeAt !== undefined && item.fadeAt <= at) continue;
      for (const prim of item.prims) {
        if (prim.kind === 'text' && prim.text.trim())
          out.push({ text: prim.text.trim(), box: prim.box });
      }
    }
    return out;
  };
  const base = Math.min(plan.frame.w / plan.canvas.w, plan.frame.h / plan.canvas.h);

  let excluded = 0;
  for (const scene of plan.scenes) {
    // Where the sampler looks: a quarter second before the beat lets go of the screen.
    const at = scene.start + scene.dur - 0.25;
    const framed = textAt(plan, at);
    const all = standing(at);
    excluded += all.length - framed.length;

    // Everything reported as on screen really is, judged against `seek()`'s own framing
    // arithmetic in `page/runtime.js` rather than against this file's opinion of it.
    const px = base * scene.camera.zoom;
    const vw = plan.frame.w / px;
    const vh = plan.frame.h / px;
    const view = { x: scene.camera.x - vw / 2, y: scene.camera.y - vh / 2, w: vw, h: vh };
    for (const { text, box } of all) {
      const inside =
        box.x < view.x + view.w &&
        box.x + box.w > view.x &&
        box.y < view.y + view.h &&
        box.y + box.h > view.y;
      assert.equal(
        framed.includes(text),
        inside,
        `"${text}" at ${scene.id}: on screen ${inside}, expected by the check ` +
          `${framed.includes(text)}`,
      );
    }
  }

  // The fixture pans across a 3200x1800 board at zoom 1.5–2.1, so most beats have earlier
  // ink standing outside the frame. Without this the assertion above passes on a check
  // that scopes nothing.
  assert.ok(
    excluded > 0,
    'no word was ever off-camera — the scoping is inert and this test would not notice',
  );

  // And the beat that legitimately sees the whole board still expects the whole board:
  // the recap pulls back to zoom 1.0, and scoping must not start hiding what is there.
  const recap = plan.scenes[plan.scenes.length - 1]!;
  const recapAt = recap.start + recap.dur - 0.25;
  assert.equal(textAt(plan, recapAt).length, standing(recapAt).length);
});

test('the OCR diff forgives case, punctuation and short words, and nothing else', () => {
  const sample = {
    index: 0,
    at: 4,
    sceneId: 'anchor',
    png: new Uint8Array(),
    text: ['Which way do you step?', 'the valley'],
  };
  // Read back with different case and punctuation, and missing the two short words:
  // no finding, because a reader of handwriting differs on exactly those.
  assert.deepEqual(
    ocrDiff([{ index: 0, read: ['WHICH', 'way,', 'you', 'step', 'valley'] }], [sample]),
    [],
  );
  // A whole content word missing is a finding.
  const [v] = ocrDiff([{ index: 0, read: ['which', 'way', 'do', 'you', 'step'] }], [sample]);
  assert.match(v?.message ?? '', /"valley"/);
  // A model that read nothing is not evidence that the board is blank.
  assert.deepEqual(ocrDiff([{ index: 0, read: [] }], [sample]), []);
  assert.deepEqual(ocrDiff([{ index: 0 }], [sample]), []);
});
