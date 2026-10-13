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
import {
  blankRunViolations,
  inkFloorViolations,
  ocrDiff,
  sampleTimes,
  textAt,
  timelineTimes,
  MIN_INK_SHARE,
  type FrameSample,
} from './tier2.js';

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

/* ------------------------------------------------------------------- blank-run */

/** A synthetic timeline: one sample a second, each with the ink share given. */
function timeline(shares: readonly (number | undefined)[], from = 1.5): FrameSample[] {
  return shares.map((ink, i) => ({
    index: i,
    at: from + i,
    sceneId: `s${Math.floor(i / 3)}`,
    png: new Uint8Array(),
    ...(ink === undefined ? {} : { ink }),
    text: [],
  }));
}

test('a held scene whose ink has all faded is reported, with where and for how long', () => {
  // Two beats of drawn board, then four seconds of nothing, then a beat that draws
  // again. This is the shape of `projects/c5caa09eb153`: the wipe took the card out and
  // the reading-time extension kept the film running over the empty paper.
  const runs = blankRunViolations(timeline([0.04, 0.03, 0, 0, 0.001, 0, 0.05]), 1);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.kind, 'blank-run');
  // From 3.0s (the first blank sample stands for the second either side of it) for 4.0s.
  assert.match(runs[0]?.message ?? '', /^4\.0s of blank paper from 3\.0s /);
  assert.match(runs[0]?.message ?? '', /4 consecutive frames under 0\.5% ink/);

  // A drawn board of any density is not a run, however sparse.
  assert.deepEqual(blankRunViolations(timeline([0.006, 0.006, 0.006, 0.006]), 1), []);
  // Nor is a fade: one sample under the floor stands for one second, and the ceiling is
  // two. A card change has to be allowed to be punctuation.
  assert.deepEqual(blankRunViolations(timeline([0.04, 0, 0.04, 0, 0.04]), 1), []);
  // The run's length is what the samples stand for, so a coarser cadence finds it sooner.
  assert.equal(blankRunViolations(timeline([0.04, 0, 0.04]), 2.5).length, 1);

  // A frame that could not be decoded ends the run rather than joining it — the same
  // posture `inkFloorViolations` takes. Two blanks either side of one unmeasured frame
  // are two two-second runs, not one five-second one.
  const split = blankRunViolations(timeline([0, 0, undefined, 0, 0]), 1);
  assert.equal(split.length, 2);
  assert.match(split[0]?.message ?? '', /^2\.0s of blank paper from 1\.0s /);
  assert.match(split[1]?.message ?? '', /^2\.0s of blank paper from 4\.0s /);
});

test('the timeline skips the first second and the whole outro', async () => {
  const plan = await planWithVisuals(lessonStoryboard());
  const outroSec = 1.2;
  const { cadence, times } = timelineTimes(plan, outroSec);
  assert.ok(times.length > 0);
  const first = times[0] as number;
  const last = times[times.length - 1] as number;
  // Inside the window at both ends, by half a sample — every sample stands for the
  // seconds around it and none of them may stand for film outside the window.
  assert.ok(first - cadence / 2 >= 1 - 1e-9, `first sample at ${first.toFixed(2)}s`);
  assert.ok(
    last + cadence / 2 <= plan.duration - outroSec + 1e-9,
    `last sample at ${last.toFixed(2)}s of a ${plan.duration.toFixed(2)}s film`,
  );
  // The outro is a deliberate held frame belonging to no beat, so a blank one is not a
  // finding: with the whole film excluded there is nothing to sample and nothing to say.
  assert.deepEqual(timelineTimes(plan, plan.duration).times, []);
  assert.deepEqual(blankRunViolations([], cadence), []);
});
