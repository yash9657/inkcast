/**
 * Where the film is cut for encoding, and what makes one cut reusable (plan item 7.1;
 * audit S10-b).
 *
 * ## Why the old cut could not be cached
 *
 * `planSegments` used to divide the whole frame range into `min(workers, frames/24)` equal
 * spans. That is the right shape for *parallelism* and the wrong shape for *reuse*: the
 * boundaries fall wherever the arithmetic puts them, so a segment straddles two scenes,
 * and editing the narration of the last beat changes the pixels of a span that also
 * contains the end of the beat before it. Nothing could be reused because nothing was
 * about anything.
 *
 * ## The cut
 *
 * **Every scene boundary is a segment boundary, and long scenes are subdivided.** So the
 * boundary set is a *superset* of the scene boundaries and every segment lies inside
 * exactly one scene. That is what makes a segment's contents nameable, and it dissolves
 * the tension the item looked like it had: cutting only on scene boundaries would put an
 * eight-second scene and a ninety-second one in one worker each and let the long one own
 * the wall clock, so the subdivision buys the parallelism back without coarsening the
 * cache — a re-render still redoes only the sub-segments whose pixels moved.
 *
 * **The subdivision is deterministic and does not depend on the worker count.** It would
 * have been natural to split until there are exactly `concurrency` segments; that would
 * make the boundaries a property of the machine, so the same project re-rendered with
 * `--concurrency 4` instead of 8 would miss every cached segment for no reason a user
 * could see. `MAX_SEGMENT_SEC` fixes the boundaries; the worker pool then runs however
 * many segments there are, however many workers exist.
 *
 * ## What a segment's pixels depend on
 *
 * `segmentKey` answers it, and the answer is smaller than "the plan": an item that is not
 * on the board during a span cannot change a frame in it. So the key is every `PlanItem`
 * whose *visible interval* intersects the segment, plus the cameras that frame it, plus
 * the board-wide look, plus the encoder settings.
 *
 * **The plan asked for "a hash of the accumulated prior board state", and the interval
 * test gives it for free rather than as a special case.** Under `accumulate` a persistent
 * item from scene 1 has no end, so it intersects every later segment and is in all their
 * keys — edit scene 1's picture and the whole tail re-encodes, which is the honest mapping
 * and the plan says so. Under `wipe` that item has faded by `fadeAt`, so it intersects
 * nothing after its own scene and a wipe-mode edit re-encodes one scene. One rule, both
 * behaviours, and no `meta.board` switch to get backwards.
 */
import { hash } from '@inkcast/core';
import type { PlanItem, RenderPlan } from './types.js';

/**
 * Longest span one segment may cover, in seconds.
 *
 * Two forces meet here and neither is subtle. Longer segments mean fewer ffmpeg processes
 * and less concat overhead; shorter ones mean a narration edit re-encodes less, and mean a
 * long scene can be worked on by more than one core. Five seconds is a beat's own order of
 * magnitude — the corpus's beats run 6–16s — so a typical scene becomes two or three
 * segments and the longest scene in a film stops being the wall clock.
 *
 * Not tuned against a benchmark, and this comment is where that is admitted: it is a
 * shape, chosen so that no segment is a large fraction of a film. Re-derive it by timing
 * a real render if segment overhead ever shows up in the stage timings.
 */
export const MAX_SEGMENT_SEC = 5;

/**
 * Shortest span worth cutting, in frames.
 *
 * A scene shorter than this is one segment whatever `MAX_SEGMENT_SEC` says, and a
 * subdivision never leaves a runt: the encoder and the concat cost the same for two frames
 * as for fifty, so a one-frame tail segment is pure overhead. Inherited from the old
 * `planSegments`, which used the same number for the same reason.
 */
export const MIN_SEGMENT_FRAMES = 24;

export type Segment = {
  index: number;
  /** First frame, inclusive. */
  from: number;
  /** Last frame, exclusive. */
  to: number;
  /**
   * Index into `plan.scenes` of the scene this segment lies inside.
   *
   * Always exactly one — that is the invariant the whole cache rests on, and
   * `segmentsCoverEveryScene` in the tests asserts it rather than trusting this sentence.
   */
  scene: number;
  /** The frame to save as the poster, when it falls in this segment. */
  poster: number | null;
};

/** Frame index a scene starts on, rounded the way the capture loop seeks. */
function sceneStartFrame(plan: RenderPlan, i: number, frames: number): number {
  const scene = plan.scenes[i];
  if (!scene) return frames;
  return Math.min(frames, Math.max(0, Math.round(scene.start * plan.fps)));
}

/**
 * Cut the film into segments on scene boundaries, subdividing anything long.
 *
 * `frames` is the whole film; the last scene's segment runs to it, so the outro — which is
 * board time after the last scene's `dur` — belongs to the last scene rather than becoming
 * a segment with no scene to name it.
 */
export function planSegments(plan: RenderPlan, frames: number, posterFrame: number): Segment[] {
  const bounds: { from: number; to: number; scene: number }[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const from = sceneStartFrame(plan, i, frames);
    // The next scene's start, not this scene's `start + dur`: the two agree to within
    // rounding, and using the neighbour's own number is what guarantees the segments tile
    // the film with no gap and no overlap.
    const to = i + 1 < plan.scenes.length ? sceneStartFrame(plan, i + 1, frames) : frames;
    if (to > from) bounds.push({ from, to, scene: i });
  }
  // A plan with no scenes still renders — `frames` is at least 1 — and it is one segment
  // belonging to scene 0, which is what every downstream index expects.
  if (!bounds.length) bounds.push({ from: 0, to: frames, scene: 0 });

  const max = Math.max(MIN_SEGMENT_FRAMES, Math.round(MAX_SEGMENT_SEC * plan.fps));
  const segs: Segment[] = [];
  for (const span of bounds) {
    const len = span.to - span.from;
    // Equal parts rather than `max`-sized parts with a remainder: three 4-second segments
    // read better in a progress line than two 5s and a 2s, and an even split is also the
    // one that keeps the workers busy for the same length of time.
    const parts = Math.max(1, Math.min(Math.ceil(len / max), Math.floor(len / MIN_SEGMENT_FRAMES)));
    const per = Math.ceil(len / parts);
    for (let from = span.from; from < span.to; from += per) {
      segs.push({
        index: segs.length,
        from,
        to: Math.min(span.to, from + per),
        scene: span.scene,
        poster: null,
      });
    }
  }
  const owner = segs.find((s) => posterFrame >= s.from && posterFrame < s.to) ?? segs[0];
  if (owner) owner.poster = posterFrame;
  return segs;
}

/**
 * When an item is on the board, in absolute seconds.
 *
 * `end` is `Infinity` for a persistent item on an accumulating board, and that is the
 * whole of the accumulate/wipe distinction as far as this file is concerned — see the
 * header. `fadeAt` wins where the compiler set one, because that is the compiler saying
 * exactly when the item stops being drawn.
 */
function visible(item: PlanItem): { start: number; end: number } {
  // `start` rather than `start - transition`: an item cannot be seen before it is drawn,
  // and the camera move that brings it into frame is keyed separately through the scenes.
  const end = item.fadeAt ?? (item.persist ? Infinity : item.sceneEnd);
  return { start: item.start, end };
}

/**
 * Every item that can put ink in this segment's frames.
 *
 * Exported for the tests, which assert the two directions that matter: a persistent item
 * from an earlier scene is in a later segment's set under `accumulate`, and is not under
 * `wipe`. Getting that backwards is the trap the plan names — a cache that is correct in
 * testing and wrong on the first real edit.
 */
export function itemsInSegment(plan: RenderPlan, seg: Segment): PlanItem[] {
  const t0 = seg.from / plan.fps;
  const t1 = seg.to / plan.fps;
  return plan.items.filter((item) => {
    const v = visible(item);
    // Half-open both ways: an item that finishes exactly as the segment opens drew its
    // last frame in the segment before.
    return v.start < t1 && v.end > t0;
  });
}

/** What the encoder was configured with. A different setting is a different picture. */
export type EncoderSettings = {
  crf: number;
  preset: string;
  threads: number;
  format: string;
};

/**
 * The cache key for one segment.
 *
 * Everything that can change a byte of this segment's mp4 and nothing that cannot. The
 * encoder settings are in it because they must be: x264 at a different `threads` makes
 * different bytes from identical frames, and a segment encoded by a differently-configured
 * worker concats without complaint and is not byte-identical — which would fail 7.1's own
 * done-bar in the least visible way possible.
 *
 * `RENDER_VERSION` is *not* folded in here; the caller does it, for the same reason the
 * whole-render key does — this file should not have an opinion about when the renderer's
 * output changes wholesale.
 */
export function segmentKey(
  plan: RenderPlan,
  seg: Segment,
  enc: EncoderSettings,
  extra?: unknown,
): string {
  return hash(
    seg.from,
    seg.to,
    // The frame range is in absolute frames, so a beat that got *longer* earlier in the
    // film moves this segment's frames even when its own contents did not change. That is
    // correct and it is why a tail edit re-encodes the tail: the tail's frames are
    // different frames now.
    plan.fps,
    plan.frame,
    plan.canvas,
    plan.aspect,
    plan.paper,
    plan.ink,
    plan.grid,
    plan.gridStep,
    plan.style,
    plan.fontFamily,
    plan.scale,
    plan.typeScale,
    plan.safe,
    plan.pen,
    // The scene that frames these pixels, and the one before it — a segment at the head of
    // a scene is mid camera-transition, and the transition reads the previous camera.
    plan.scenes[seg.scene],
    seg.scene > 0 ? plan.scenes[seg.scene - 1] : null,
    itemsInSegment(plan, seg),
    enc,
    extra ?? null,
  );
}
