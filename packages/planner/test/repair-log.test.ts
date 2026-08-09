/**
 * What `repairLabels` says when it does nothing.
 *
 * The repair has two ways of leaving a colliding label exactly where the author put it,
 * and they mean opposite things. One is the scoring deciding the move is not worth making.
 * The other is the `inside` gate rejecting every candidate — the gate is checked in
 * authoring units while a label's footprint grows as 1/scale, so a narrow cell can put the
 * whole ring search out of bounds — and that one is the repair being unable to run at all.
 * Only the second is a line in the log, and telling them apart is the whole point of it:
 * a log that blames the canvas for a decision the weights made is a false cause in the
 * record, which is worse than no line.
 *
 * Its own file because `@inkcast/core` reads `INKCAST_LOG` once, at import, so the level
 * has to be set before anything pulls it in — hence the environment line above the import
 * and the dynamic `import()` below it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
// Type-only, so it is erased rather than imported and the line below still runs first.
import type { Mark } from '@inkcast/core';

process.env.INKCAST_LOG = 'debug';

const { repairLabels } = await import('../src/drawing.js');
const { TYPICAL_FIT } = await import('../src/draw-geom.js');

const mark = (m: Partial<Mark> & { id: string; kind: Mark['kind'] }): Mark => ({
  closed: false,
  smooth: false,
  dashed: false,
  ...m,
});

/** Everything the repair wrote to stdout while it ran. */
function logged(fn: () => void): string {
  const out: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = real;
  }
  return out.join('');
}

/** Three lines at `TYPICAL_FIT`, which is what makes the displacement floor bite. */
const LONG = 'the atrioventricular node sits at the junction of the atria and ventricles';

test('a label the weights decided not to move is not reported as having nowhere to go', () => {
  // One crossed stroke scores 50. This name's footprint is 179 units tall, so the ring
  // step is 143 and ring 1 is already charged 71 for displacement alone — the loop never
  // runs an iteration, and no candidate is ever tested against the canvas bounds. The
  // label is perfectly placeable; the repair simply priced the move above the collision.
  const marks: Mark[] = [
    mark({
      id: 'rail',
      kind: 'stroke',
      points: [
        [250, 300],
        [750, 300],
      ],
    }),
    mark({ id: 'name', kind: 'label', x: 500, y: 300, size: 34, text: LONG }),
  ];
  let out: Mark[] = [];
  const text = logged(() => {
    out = repairLabels(marks, undefined, TYPICAL_FIT);
  });
  assert.deepEqual(out, marks, 'the label was expected to stay where it was');
  assert.ok(
    !text.includes('nowhere to go'),
    `the canvas was blamed for a decision the weights made: ${text.trim()}`,
  );
});

test('a label with no admissible candidate at all says so', () => {
  // At s=0.3 this name wraps at the 280-unit floor and comes back 1375 authoring units
  // wide, on a canvas 1000 wide: no offset in any ring can put it inside, so the second
  // copy stays written on top of the first. That is the repair being unable to run, and it
  // is the case the line exists for.
  const marks: Mark[] = [
    mark({ id: 'first', kind: 'label', x: 500, y: 280, size: 30, text: LONG }),
    mark({ id: 'second', kind: 'label', x: 500, y: 280, size: 30, text: LONG }),
  ];
  let out: Mark[] = [];
  const text = logged(() => {
    out = repairLabels(marks, undefined, 0.3);
  });
  assert.deepEqual(out, marks, 'nothing could have moved');
  assert.ok(text.includes('nowhere to go'), `the silent no-op went unreported: ${text.trim()}`);
});
