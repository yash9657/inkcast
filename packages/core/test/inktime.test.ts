/**
 * How long ink takes, and when the pen may pick it up.
 *
 * Two properties are worth more than the rest of this file put together, and both
 * of them were false before `inktime.ts` existed:
 *
 *  1. **A bigger mark takes longer.** `Enter.duration`'s flat 0.8 s gave a two-stroke
 *     arrowhead and a whole labelled figure the same entrance, which made the first
 *     a smear and the second a flash.
 *  2. **Two marks are never being drawn at once.** Cues place marks independently,
 *     so a beat could and did put six of them inside one second.
 *
 * Everything else here defends a decision that would otherwise be quietly undone:
 * that the schedule may delay a mark but never advance it, that the beat's subject
 * is the last thing compression touches, and that an over-full beat still produces a
 * legal schedule rather than an exception.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_DRAW_SEC,
  MIN_DRAW_SEC,
  PEN_DOMINANT_SLACK,
  PEN_OVERLAP,
  durationFor,
  inkCost,
  inkPaceFor,
  serializePen,
} from '../src/inktime.js';
import type { InkPrim, PenSlot } from '../src/inktime.js';

/** A board the size of the corpus's, at the zoom a wiped card uses. */
const PACE = {
  ...inkPaceFor('marker', 1, { x: 0, y: 0, w: 1920, h: 1080 }, { w: 1920, h: 1080 }),
  pxPerUnit: 1,
};

/** A closed rectangle as path data, `w` × `h`. */
function boxPath(w: number, h: number): string {
  return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
}

const geom = (d: string, noDash?: boolean): InkPrim =>
  noDash === undefined ? { kind: 'geom', d } : { kind: 'geom', d, noDash };

/* ------------------------------------------------------------------ durations */

test('a mark takes longer the more ink it has', () => {
  const arrow = durationFor([geom('M 0 0 L 40 0 M 40 0 L 28 -8')], PACE);
  const box = durationFor([geom(boxPath(600, 400))], PACE);
  const figure = durationFor(
    // Twelve strokes of a real drawing rather than one long one, because that is the
    // shape the cost model has to handle: the page divides the item's window between
    // them, and a duration that ignored the count would give each a couple of frames.
    Array.from({ length: 12 }, (_, i) => geom(boxPath(300 + i * 40, 200 + i * 30))),
    PACE,
  );

  assert.ok(arrow < box, `an arrowhead (${arrow}) must be quicker than a box (${box})`);
  assert.ok(box < figure, `a box (${box}) must be quicker than a figure (${figure})`);

  // And the band is real at both ends: the smallest mark is still watched being
  // drawn, the largest still leaves the beat time to say something else.
  assert.equal(arrow, MIN_DRAW_SEC);
  assert.equal(figure, MAX_DRAW_SEC);
});

test('the same ink takes the same time however wide the shot is', () => {
  // A canvas-units-per-second model would draw the wide shot at a crawl and the
  // close-up in a blink; a viewer sees pixels, so the pace is in pixels.
  const prims = [geom(boxPath(500, 300))];
  const wide = durationFor(prims, { ...PACE, pxPerUnit: 0.5 });
  const close = durationFor(prims, { ...PACE, pxPerUnit: 2 });
  assert.ok(wide < close, 'ink that fills more of the frame takes longer to lay down');
});

test('a fill is discounted — nobody watches hachure being drawn stroke by stroke', () => {
  // The same twelve lines, once as drawn strokes and once as a fill that fades in
  // behind the outline. Both cost something; the fill costs a fraction, which is the
  // same discount `layoutAll` applies when it divides the item's window.
  const lines = Array.from({ length: 12 }, () => 'M 0 0 L 400 400');
  const drawn = inkCost(
    lines.map((d) => geom(d)),
    PACE,
  );
  const filled = inkCost(
    lines.map((d) => geom(d, true)),
    PACE,
  );
  assert.ok(
    filled < drawn,
    `a fill must cost less than the same ink drawn (${filled} vs ${drawn})`,
  );
  assert.ok(filled > 0, 'and more than nothing — it does occupy the beat');
});

test('two overlapping passes of one edge are one piece of ink', () => {
  // `sketch.passes` is how many times the hand goes over an edge. It is a property of
  // the style file, not of the drawing, and a 2-pass style must not take twice as
  // long to draw the same picture as a 1-pass one.
  const d = boxPath(900, 600);
  const once = inkCost([geom(d)], { ...PACE, passes: 1 });
  const twice = inkCost([geom(d), geom(d)], { ...PACE, passes: 2 });
  assert.ok(Math.abs(once - twice) < 1e-6, `${once} vs ${twice}`);
});

test('handwriting is measured with the board’s own hand, and longer text takes longer', () => {
  const short = durationFor([{ kind: 'text', text: 'Free fall', box: box(), size: 90 }], PACE);
  const long = durationFor(
    [
      {
        kind: 'text',
        text: 'Falling is a tug of war between a bigger pull and a bigger reluctance',
        box: box(),
        size: 90,
      },
    ],
    PACE,
  );
  assert.ok(short < long);
});

function box() {
  return { x: 0, y: 0, w: 1200, h: 200 };
}

/* -------------------------------------------------------------------- the pen */

/** Marks whose `at` values are the firehose the dissection measured in scene s2. */
function firehose(): PenSlot[] {
  return [
    { id: 'title', at: 0.4, dur: 1.2, ink: 400 },
    { id: 'floor', at: 0.9, dur: 0.8, ink: 300 },
    { id: 'small-box', at: 1.26, dur: 0.5, ink: 120 },
    { id: 'push-small', at: 1.31, dur: 0.5, ink: 60 },
    { id: 'trail-small', at: 1.4, dur: 0.6, ink: 140 },
    { id: 'arrowhead', at: 1.57, dur: 0.5, ink: 50 },
    { id: 'large-box', at: 1.61, dur: 0.9, ink: 380 },
    { id: 'push-large', at: 1.67, dur: 0.5, ink: 70 },
  ];
}

/** Every pair, in schedule order, obeys the single-writer rule. */
function assertOnePen(schedule: { slots: { id: string; at: number; dur: number }[] }): void {
  const ordered = [...schedule.slots].sort((a, b) => a.at - b.at);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const next = ordered[i]!;
    assert.ok(
      next.at + 1e-6 >= prev.at + prev.dur * (1 - PEN_OVERLAP),
      `"${next.id}" starts at ${next.at.toFixed(3)} while "${prev.id}" runs to ` +
        `${(prev.at + prev.dur).toFixed(3)}`,
    );
  }
}

test('six marks cued inside one second are drawn one at a time', () => {
  const before = firehose();
  // The defect, stated as a measurement so the fix has something to be better than.
  let concurrent = 0;
  for (const a of before) {
    for (const b of before) {
      if (a.id !== b.id && b.at > a.at && b.at < a.at + a.dur) concurrent++;
    }
  }
  assert.ok(concurrent >= 6, `the fixture must actually collide (got ${concurrent})`);

  const schedule = serializePen(before, { length: 14, speech: 12 });
  assertOnePen(schedule);
  assert.equal(schedule.slots.length, before.length, 'no mark is dropped');
});

test('a beat with room delays marks and never advances one', () => {
  const before = firehose();
  const schedule = serializePen(before, { length: 14, speech: 12 });
  const cue = new Map(before.map((s) => [s.id, s.at]));
  for (const slot of schedule.slots) {
    assert.ok(
      slot.at + 1e-9 >= cue.get(slot.id)!,
      `"${slot.id}" was moved earlier than its cue — a reveal must never precede the words`,
    );
  }
});

test('a mark cued past the reading tail is pulled back, not packed to the front', () => {
  // Scene s9 of the corpus: a recap whose last two marks are cued at 90% and 91% of
  // the narration. They cannot be honoured *and* leave the finished board time to be
  // read, so something has to move — and the something is the two late marks, by a
  // second or so, rather than the whole beat back to zero.
  const slots: PenSlot[] = [
    { id: 'title', at: 0.36, dur: 1.2, ink: 300 },
    { id: 'one', at: 4.87, dur: 0.6, ink: 90 },
    { id: 'two', at: 6.05, dur: 0.6, ink: 90 },
    { id: 'three', at: 10.68, dur: 0.6, ink: 90 },
    { id: 'four', at: 10.8, dur: 0.6, ink: 90 },
  ];
  const schedule = serializePen(slots, { length: 12.5, speech: 11.87, tail: 3.5 });
  const by = new Map(schedule.slots.map((s) => [s.id, s]));

  assertOnePen(schedule);
  assert.ok(schedule.lastFinish <= 12.5 - 3.5 + 1e-6, 'the reading tail is not negotiable');
  // Pulled back by about a second and a half, not reset: the recap still happens
  // where the recap is spoken.
  assert.ok(by.get('four')!.at > 8, `"four" landed at ${by.get('four')!.at} — the beat was reset`);
  // And the marks that were never in trouble did not move at all.
  assert.equal(by.get('title')!.at, 0.36);
  assert.equal(by.get('one')!.at, 4.87);
  // Nothing was compressed: this was a cue problem, and shortening the drawing would
  // have spent the beat's legibility on a defect it cannot fix.
  assert.ok(!schedule.compressed);
});

test('the beat’s subject keeps its cue; the decorations in front of it give way', () => {
  // A figure cued early, behind a queue of small marks that would otherwise push it
  // three seconds late — the "eight seconds of a title in an empty frame" failure
  // `cue.ts` describes, arriving through the schedule instead of through the cue.
  const slots: PenSlot[] = [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `mark${i}`,
      at: 0.1 * i,
      dur: 0.9,
      ink: 40,
    })),
    { id: 'figure', at: 1.0, dur: 3.0, ink: 4000 },
  ];

  const naive = serializePen(
    slots.map((s) => (s.id === 'figure' ? { ...s, ink: 40 } : s)),
    { length: 20, speech: 18 },
  );
  const guarded = serializePen(slots, { length: 20, speech: 18 });

  const lateWhenOrdinary = naive.slots.find((s) => s.id === 'figure')!.at;
  const withGuard = guarded.slots.find((s) => s.id === 'figure')!.at;

  assert.ok(lateWhenOrdinary - 1.0 > PEN_DOMINANT_SLACK, 'the fixture must actually push it late');
  assert.ok(
    withGuard - 1.0 <= PEN_DOMINANT_SLACK + 1e-6,
    `the subject landed ${(withGuard - 1.0).toFixed(2)}s after its cue`,
  );
  // Paid for by the marks in front of it, not by the subject's own length.
  assert.equal(guarded.slots.find((s) => s.id === 'figure')!.dur, 3.0);
  assertOnePen(guarded);
});

test('a beat with more marks than seconds still produces a legal schedule', () => {
  // Scene s7 of the corpus: 26 marks in a beat that has no room for them. The right
  // fix is the element ceiling upstream; the schedule's job is to stay legal and let
  // the dwell gate report the real problem.
  const slots: PenSlot[] = Array.from({ length: 26 }, (_, i) => ({
    id: `m${i}`,
    at: i * 0.12,
    dur: 0.8,
    ink: 100,
  }));
  const schedule = serializePen(slots, { length: 6, speech: 5 });

  assertOnePen(schedule);
  assert.ok(schedule.compressed, 'it had to shorten them');
  assert.ok(schedule.lastFinish <= 6 + 1e-6, `overran its beat: ${schedule.lastFinish}`);
  assert.equal(schedule.slots.length, 26);
  for (const slot of schedule.slots) assert.ok(slot.dur > 0);
});

test('marks that do not fit inside the narration settle during the hold', () => {
  const slots: PenSlot[] = Array.from({ length: 6 }, (_, i) => ({
    id: `m${i}`,
    at: 2 + i * 0.05,
    dur: 1.0,
    ink: 100,
  }));
  // 6 × 1s of drawing, all cued into one tenth of a second at t=2, in a beat whose
  // narration stops at 4 and whose hold runs to 9.
  const schedule = serializePen(slots, { length: 9, speech: 4 });

  assertOnePen(schedule);
  assert.ok(schedule.settled.length > 0, 'the tail of the beat assembles during the hold');
  assert.ok(!schedule.compressed, 'and it did so without shortening anything');
  assert.ok(schedule.lastFinish <= 9 + 1e-6);
});

test('a reserved tail is time the schedule may not spend', () => {
  const slots: PenSlot[] = Array.from({ length: 5 }, (_, i) => ({
    id: `m${i}`,
    at: i * 1.5,
    dur: 1.2,
    ink: 100,
  }));
  const loose = serializePen(slots, { length: 8, speech: 7 });
  const reserved = serializePen(slots, { length: 8, speech: 7, tail: 2.5 });

  assert.ok(reserved.lastFinish <= 8 - 2.5 + 1e-6, `${reserved.lastFinish} left no reading time`);
  assert.ok(reserved.lastFinish < loose.lastFinish);
  assertOnePen(reserved);
});

test('one mark, or none, is left exactly alone', () => {
  assert.deepEqual(serializePen([], { length: 5, speech: 4 }).slots, []);
  const one = serializePen([{ id: 'a', at: 1.5, dur: 2, ink: 10 }], { length: 5, speech: 4 });
  assert.deepEqual(one.slots, [{ id: 'a', at: 1.5, dur: 2 }]);
  assert.equal(one.lastFinish, 3.5);
});
