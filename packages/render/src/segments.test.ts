/**
 * The segment cut and the segment key (plan item 7.1; audit S10-b).
 *
 * These are the claims the partial re-encode rests on, and they are asserted here rather
 * than demonstrated once by hand for the reason `planrows.ts` was extracted in 7.2: a
 * cache whose correctness was established by one person running one film is a cache that
 * silently rots. Two of them are the plan's own named traps.
 *
 * The end-to-end proof is in `render.test.ts` and in the handoff; what is here is the
 * arithmetic underneath it, which is where a regression would actually land.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan } from './compile.js';
import { fixtureStoryboard, lessonStoryboard, wipeStoryboard } from './fixture.js';
import {
  MAX_SEGMENT_SEC,
  MIN_SEGMENT_FRAMES,
  itemsInSegment,
  planSegments,
  segmentKey,
  type EncoderSettings,
  type Segment,
} from './segments.js';
import type { RenderPlan } from './types.js';

const ENC: EncoderSettings = { crf: 18, preset: 'medium', threads: 2, format: 'png' };

function planFor(sb: ReturnType<typeof lessonStoryboard>): {
  plan: RenderPlan;
  frames: number;
  segs: Segment[];
} {
  const plan = compilePlan(sb, '/tmp/inkcast-segments-test');
  const frames = Math.max(1, Math.ceil(plan.duration * plan.fps));
  return { plan, frames, segs: planSegments(plan, frames, 0) };
}

test('segments tile the film exactly — no gap, no overlap, nothing lost', () => {
  const { frames, segs } = planFor(lessonStoryboard());
  assert.ok(segs.length > 1, 'a real film is more than one segment');
  assert.equal(segs[0]!.from, 0);
  assert.equal(segs.at(-1)!.to, frames);
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i]!.from, segs[i - 1]!.to, `segment ${i} does not start where ${i - 1} ends`);
  }
  // Which is the same claim from the other end: every frame is encoded exactly once, and
  // a concat of the segments is the film.
  assert.equal(
    segs.reduce((n, s) => n + (s.to - s.from), 0),
    frames,
  );
});

test('every scene boundary is a segment boundary, and no segment straddles two scenes', () => {
  // The invariant the whole cache rests on. Without it a segment is about nothing in
  // particular — editing one beat changes the pixels of a span that also holds the end of
  // the beat before it, which is why the old equal-slices cut could not be reused at all.
  const { plan, frames, segs } = planFor(lessonStoryboard());
  const starts = new Set(segs.map((s) => s.from));
  plan.scenes.forEach((scene, i) => {
    const f = Math.min(frames, Math.max(0, Math.round(scene.start * plan.fps)));
    assert.ok(starts.has(f), `scene ${i} starts at frame ${f}, which is inside a segment`);
  });
  // And each segment's own frames all belong to the scene it names.
  for (const seg of segs) {
    const scene = plan.scenes[seg.scene]!;
    const from = Math.round(scene.start * plan.fps);
    const next = plan.scenes[seg.scene + 1];
    const to = next ? Math.round(next.start * plan.fps) : frames;
    assert.ok(seg.from >= from && seg.to <= to, `segment ${seg.index} escapes scene ${seg.scene}`);
  }
});

test('a long scene is subdivided, and a short one is left alone', () => {
  const { plan, segs } = planFor(lessonStoryboard());
  const cap = Math.max(MIN_SEGMENT_FRAMES, Math.round(MAX_SEGMENT_SEC * plan.fps));
  for (const seg of segs) {
    assert.ok(seg.to - seg.from <= cap, `segment ${seg.index} is longer than the cap`);
  }
  // No runts: a subdivision that leaves a two-frame tail pays a whole encoder for it. The
  // exception is a scene that is *itself* shorter than the floor, which cannot be helped
  // and must still be encoded.
  const byScene = new Map<number, Segment[]>();
  for (const seg of segs) byScene.set(seg.scene, [...(byScene.get(seg.scene) ?? []), seg]);
  for (const [scene, group] of byScene) {
    if (group.length === 1) continue;
    for (const seg of group) {
      assert.ok(
        seg.to - seg.from >= MIN_SEGMENT_FRAMES,
        `scene ${scene} was cut into a ${seg.to - seg.from}-frame runt`,
      );
    }
  }
});

test('the cut does not depend on how many workers will run it', () => {
  // It used to: `min(workers, frames/24)` equal slices made the boundaries a property of
  // the machine, so re-rendering the same project with `--concurrency 4` instead of 8
  // would miss every cached segment for a reason no user could see. `planSegments` no
  // longer takes a worker count at all, and this test is what stops one being added back.
  const { plan, frames } = planFor(lessonStoryboard());
  const a = planSegments(plan, frames, 0);
  const b = planSegments(plan, frames, 0);
  assert.deepEqual(a, b);
  assert.equal(planSegments.length, 3, 'planSegments takes (plan, frames, posterFrame)');
});

test('the poster frame belongs to exactly one segment', () => {
  const { plan, frames } = planFor(lessonStoryboard());
  const at = Math.floor(frames * 0.4);
  const segs = planSegments(plan, frames, at);
  const owners = segs.filter((s) => s.poster !== null);
  assert.equal(owners.length, 1);
  assert.equal(owners[0]!.poster, at);
  assert.ok(at >= owners[0]!.from && at < owners[0]!.to);
});

/* ------------------------------------------------ what a segment's pixels depend on */

test('under accumulate a persistent item is in every later segment’s key', () => {
  // The plan's named trap, and the direction that is easy to get wrong: on an accumulating
  // board a scene's pixels depend on every scene before it, so an edit to scene 1 has to
  // re-encode the tail. If this were false the cache would be correct in testing and wrong
  // on the first real edit.
  const { plan, segs } = planFor(lessonStoryboard());
  const persistent = plan.items.find((i) => i.persist && i.fadeAt === undefined);
  assert.ok(persistent, 'the lesson fixture accumulates, so something persists');
  const later = segs.filter((s) => s.from / plan.fps > persistent.start + 1);
  assert.ok(later.length > 0, 'there are segments after it');
  for (const seg of later) {
    assert.ok(
      itemsInSegment(plan, seg).some((i) => i.id === persistent.id),
      `segment ${seg.index} does not depend on the persistent "${persistent.id}"`,
    );
  }
});

test('under wipe a faded item is in no later segment’s key', () => {
  // The other direction, and it is what makes a wipe-mode edit re-encode one scene. Note
  // there is no `meta.board` branch in `segments.ts` at all: the compiler sets `fadeAt` on
  // a wiping board and the interval test does the rest.
  const { plan, segs } = planFor(wipeStoryboard());
  const faded = plan.items.filter((i) => i.fadeAt !== undefined);
  assert.ok(faded.length > 0, 'the wipe fixture fades its cards');
  for (const item of faded) {
    for (const seg of segs) {
      if (seg.from / plan.fps <= item.fadeAt!) continue;
      assert.ok(
        !itemsInSegment(plan, seg).some((i) => i.id === item.id),
        `"${item.id}" faded at ${item.fadeAt!} but still keys segment ${seg.index}`,
      );
    }
  }
});

/* ----------------------------------------------------------------- the key itself */

test('a change to the last scene leaves every earlier segment’s key untouched', () => {
  // 7.1's done-bar, as arithmetic. The end-to-end version — a real 2:14 film where a
  // tail edit re-encoded 5 of 32 segments and the result was byte-identical to a full
  // re-render — is in the handoff; this is the part that runs on every `pnpm test`.
  const before = lessonStoryboard();
  const after = lessonStoryboard();
  const last = after.scenes.at(-1)!;
  last.hold = (last.hold ?? 0) + 1;

  const A = planFor(before);
  const B = planFor(after);
  const keysA = A.segs.map((s) => segmentKey(A.plan, s, ENC));
  const keysB = B.segs.map((s) => segmentKey(B.plan, s, ENC));

  const lastScene = A.plan.scenes.length - 1;
  const head = A.segs.filter((s) => s.scene < lastScene);
  assert.ok(head.length > 0, 'there is a head to reuse');
  for (const seg of head) {
    assert.equal(
      keysA[seg.index],
      keysB[seg.index],
      `segment ${seg.index} (scene ${seg.scene}) was re-keyed by an edit to the last scene`,
    );
  }
  // ...and the edited scene really did move, or the test above proves nothing.
  const tail = A.segs.filter((s) => s.scene === lastScene);
  assert.ok(
    tail.some((s) => keysA[s.index] !== keysB[s.index]),
    'the edit changed no key at all — the fixture is not exercising the cache',
  );
});

test('encoder settings are part of the key', () => {
  // The plan's third trap, and the one that fails invisibly: x264 at a different thread
  // count makes different bytes from identical frames, and a segment encoded by a
  // differently-configured worker concats without complaint. The film would simply not be
  // byte-identical, which is this item's own done-bar.
  const { plan, segs } = planFor(lessonStoryboard());
  const seg = segs[1] ?? segs[0]!;
  const base = segmentKey(plan, seg, ENC);
  for (const change of [
    { ...ENC, crf: 19 },
    { ...ENC, preset: 'ultrafast' },
    { ...ENC, threads: 3 },
    { ...ENC, format: 'jpeg' },
  ]) {
    assert.notEqual(segmentKey(plan, seg, change), base, `${JSON.stringify(change)} reused a key`);
  }
  // And the caller's own salt, which is where `RENDER_VERSION` goes in.
  assert.notEqual(segmentKey(plan, seg, ENC, 99), base);
});

test('two segments of the same film never share a key', () => {
  // They cover different frames and hold different ink; a collision would silently serve
  // one scene's pixels for another's.
  const { plan, segs } = planFor(lessonStoryboard());
  const keys = segs.map((s) => segmentKey(plan, s, ENC));
  assert.equal(new Set(keys).size, keys.length);
});

test('a one-scene board is still one well-formed segment', () => {
  const { frames, segs } = planFor(fixtureStoryboard({ fps: 12 }));
  assert.ok(segs.length >= 1);
  assert.equal(segs[0]!.from, 0);
  assert.equal(segs.at(-1)!.to, frames);
  for (const seg of segs) assert.ok(seg.to > seg.from, 'no empty segment');
});
