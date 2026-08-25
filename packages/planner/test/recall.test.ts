/**
 * The build half of `refer.ts`, which for two releases did not exist.
 *
 * `findRecall` decided that a recap re-labels parts the board already carries and handed
 * it the host beat's cell; `buildBeat` declared neither `recalls` nor `refers` on its
 * context and read neither, and TypeScript stayed quiet because excess-property checks do
 * not reach a property that arrives by spread. So the recap built its whole picture into
 * a cell that already held one. `projects/deb81002b073` is what that produced: six
 * ink-on-ink violations between the recap's chain and beat 3's box, plus one recap label
 * shrunk to 9.8 output pixels — a board the strict gate refused, from a feature whose
 * entire purpose was to stop the recap drawing anything.
 *
 * Two tests, one per half of that failure:
 *
 * 1. the recall recap emits circles and no solid ink of its own, and its remaining
 *    furniture (the caption, its rule) does not land on any earlier beat's ink;
 * 2. two beats asking for the same generated picture stay in their **own** cells while
 *    still minting one asset — the stopgap that keeps `refers` from repeating the bug
 *    now that the decision exists and the build support does not.
 *
 * The overlap arithmetic is reimplemented here rather than imported: `@inkcast/render`
 * owns `boardcheck.ts` and the planner must not depend on the renderer to know that two
 * boxes intersect.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Element, Mark, Scene, VisualIntent } from '@inkcast/core';
import { Lesson, elementBounds, lessonBeats } from '@inkcast/core';
import { compileLesson } from '../src/compile.js';
import { findReferrals } from '../src/refer.js';

/** Element types that put solid ink on the board — `boardcheck.ts`'s `SOLID`, verbatim. */
const SOLID = new Set(['text', 'equation', 'code', 'asset', 'diagram', 'plot', 'shape']);

/** A labelled box, as a drawing author writes one. */
function part(id: string, x: number, y: number, name: string): Mark[] {
  return [
    { id, kind: 'rect', x, y, w: 240, h: 150, closed: false, smooth: false, dashed: false },
    {
      id: `${id}-label`,
      kind: 'label',
      x: x + 20,
      y: y + 170,
      text: name,
      closed: false,
      smooth: false,
      dashed: false,
    },
  ] as Mark[];
}

function drawing(describe: string, marks: Mark[]): VisualIntent {
  return { describe, kind: 'draw', marks } as VisualIntent;
}

/**
 * A lesson whose recap re-labels three parts the earlier beats already named.
 *
 * Three is `RECALL_MIN`, and the recap names exactly three, so it also clears the
 * majority test in `findRecall` — the two thresholds this fixture exists to sit above.
 * The names are spread across two earlier beats deliberately: the host is the one that
 * named the most of them, and a recap that circled only its host's parts would be the
 * same amnesia in a smaller panel.
 */
const RECALLED = Lesson.parse({
  version: 1,
  topic: 'How a lock works',
  objective: 'Explain why the right key turns a pin tumbler lock and a wrong one does not',
  audience: 'a curious beginner with no background',
  hook: {
    idea: 'A lock is a row of broken pins',
    because: 'The whole mechanism is one idea repeated five times',
    narration: 'Every lock you own is the same trick, five times over. A row of broken pins.',
    visuals: [drawing('A keyhole seen from the front', part('keyhole', 60, 80, 'keyhole'))],
  },
  anchor: {
    idea: 'Each pin is cut in two',
    because: 'The cut is the only thing that matters, and it is in the wrong place at rest',
    narration: 'Each pin is cut in two. A driver pin on top, a key pin below.',
    visuals: [
      drawing('Two stacked pins in a chamber', [
        ...part('driver', 60, 60, 'driver pin'),
        ...part('keypin', 380, 60, 'key pin'),
      ]),
    ],
  },
  steps: [
    {
      idea: 'The shear line is where the plug can turn',
      because: 'A pin crossing the shear line jams the plug against the housing',
      narration: 'There is a line where the plug meets the housing. That is the shear line.',
      visuals: [drawing('The plug inside its housing', part('shear', 60, 60, 'shear line'))],
    },
    {
      idea: 'The right key lifts every cut to the shear line at once',
      because: 'Only a key whose bitting matches all five depths clears the line everywhere',
      narration: 'The right key lifts every cut to that line at once, and the plug turns.',
      visuals: [drawing('A key raising five pins', part('bitting', 60, 60, 'bitting'))],
    },
  ],
  recap: {
    idea: 'A key is a row of depths that clears one line',
    because: 'Retracing it once with every part already on the board is what makes it stick',
    narration:
      'So: a driver pin above, a key pin below, and a shear line between them. The key is only a row of depths.',
    visuals: [
      drawing('A three-link chain naming the parts again', [
        ...part('again-driver', 40, 40, 'driver pin'),
        ...part('again-keypin', 340, 40, 'key pin'),
        ...part('again-shear', 640, 40, 'shear line'),
      ]),
    ],
  },
});

const board = compileLesson(RECALLED, { board: 'accumulate' });
const recap = board.scenes.at(-1)!;

/** Boxes intersect — `boardcheck.ts`'s test, reimplemented so planner tests stay planner-only. */
function intersects(a: Element, b: Element, boxes: Map<string, ReturnType<typeof elementBounds>>) {
  const p = elementBounds(a, boxes);
  const q = elementBounds(b, boxes);
  return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
}

function boxIndex(scenes: readonly Scene[]) {
  const boxes = new Map<string, ReturnType<typeof elementBounds>>();
  for (const s of scenes) for (const el of s.elements) boxes.set(el.id, { ...el.at });
  return boxes;
}

test('a recall recap circles the board instead of redrawing it', () => {
  // The precondition: `findRecall` fired at all. If it did not, everything below passes
  // vacuously and the test is worthless — which is how the original defect survived.
  const circles = recap.elements.filter((el) => el.type === 'emphasis');
  assert.ok(
    circles.length >= 3,
    `the recap emitted ${circles.length} emphasis elements, so findRecall did not fire — ` +
      `this fixture no longer clears RECALL_MIN and the rest of this test proves nothing`,
  );

  // No figure ink. `b9_v0_*` and friends are what `buildIntent` names a built picture;
  // the caption, its rule and the vocabulary strip are furniture and are allowed.
  const figures = recap.elements.filter((el) => /^b\d+_v\d+/.test(el.id) && SOLID.has(el.type));
  assert.deepEqual(
    figures.map((el) => el.id),
    [],
    "the recap built a picture into its host's cell — the whole point of a recall is that it does not",
  );

  // Every circle points at an element an *earlier* scene wrote.
  const earlier = new Map<string, number>();
  board.scenes.forEach((s, i) => {
    if (s === recap) return;
    for (const el of s.elements) earlier.set(el.id, i);
  });
  for (const circle of circles) {
    assert.ok(
      earlier.has((circle as { targetId: string }).targetId),
      `${circle.id} circles "${(circle as { targetId: string }).targetId}", which no earlier scene wrote`,
    );
  }

  // Distinct targets: three names the board wrote in three places should be three rings,
  // not the same label ringed three times.
  const targets = new Set(circles.map((el) => (el as { targetId: string }).targetId));
  assert.equal(targets.size, circles.length, 'two circles landed on the same element');

  // And what the recap *does* still write stays off everyone else's ink.
  const boxes = boxIndex(board.scenes);
  const mine = recap.elements.filter((el) => SOLID.has(el.type));
  const theirs = board.scenes
    .filter((s) => s !== recap)
    .flatMap((s) => s.elements.filter((el) => SOLID.has(el.type)));
  for (const a of mine) {
    for (const b of theirs) {
      assert.ok(
        !intersects(a, b, boxes),
        `the recap's "${a.id}" is written through "${b.id}" — the ink-on-ink failure this fixes`,
      );
    }
  }
});

/**
 * The `refers` stopgap.
 *
 * Two beats ask for the same subject in the same box — `subjectOf` coarsens away the
 * view clause, so `findReferrals` pairs them — and until `buildBeat` can draw only the
 * second beat's *added* marks over the first's picture, sharing the cell would mean
 * redrawing the whole picture on top of it. So they keep their own cells.
 *
 * The asset saving is asserted separately below, and deliberately not here, because the
 * two identities are not the same one: `registry.mint` keys on the exact prompt, so
 * *this* lesson mints two images even though it is one subject. That gap is what
 * `subjectOf` was invented to name, and closing it needs the same drawing-lane work as
 * `refers` itself. Asserting "one asset" here would be asserting a saving the compiler
 * does not make.
 */
const REFERRED = Lesson.parse({
  version: 1,
  topic: 'The human heart',
  objective: 'Name the chambers and trace the beat through them',
  audience: 'a curious beginner with no background',
  hook: {
    idea: 'A heart is two pumps stacked',
    because: 'The stacking is what makes the timing matter',
    narration: 'Your heart is two pumps stacked one on the other.',
    visuals: [drawing('Two stacked bags', part('bags', 60, 60, 'two bags'))],
  },
  anchor: {
    idea: 'Here is the real organ',
    because: 'The learner has to see the thing itself before its parts mean anything',
    narration: 'Here is the real thing, cut open. Four chambers, two on top and two below.',
    visuals: [
      {
        describe: 'The heart, cut open, with its four chambers marked',
        kind: 'draw',
        marks: part('atria', 60, 60, 'atria'),
        underlay: {
          prompt: 'cutaway cross-section of a human heart showing all four chambers',
          kind: 'form',
          inkBox: [40, 40, 900, 500],
        },
      },
    ],
  },
  steps: [
    {
      idea: 'The upper chambers squeeze first',
      because: 'They fill the lower ones, so they have to finish before the lower ones start',
      narration: 'The two upper chambers squeeze first, filling the two below them.',
      visuals: [
        {
          describe: 'The same heart, with the upper chambers contracting',
          kind: 'draw',
          marks: part('squeeze', 60, 60, 'squeeze'),
          underlay: {
            prompt: 'cutaway cross-section of a human heart, upper chambers contracting',
            kind: 'form',
            inkBox: [40, 40, 900, 500],
          },
        },
      ],
    },
  ],
  recap: {
    idea: 'Two pumps, in order',
    because: 'The order is the whole lesson',
    narration: 'Two pumps, and the order between them is the whole trick.',
    visuals: [drawing('The two pumps once more', part('order', 60, 60, 'order'))],
  },
});

test('two beats drawing one subject keep their own cells', () => {
  const sb = compileLesson(REFERRED, { board: 'accumulate' });

  // The precondition, for the same reason the recall test asserts its own: if the two
  // beats are not paired at all there is no referral to gate off and everything below
  // passes for the wrong reason.
  const paired = findReferrals(lessonBeats(REFERRED), 'accumulate').pictures;
  assert.equal(paired.size, 1, 'findReferrals no longer pairs these two beats');
  assert.equal(paired.get(2)?.host, 1, 'the step should refer to the anchor');

  // Beat 1 (anchor) and beat 2 (the step) both draw the heart. Their pictures must not be
  // in the same place: sharing a cell without the build support is the ink-on-ink bug.
  const boxes = boxIndex(sb.scenes);
  const pictureOf = (i: number) =>
    sb.scenes[i]!.elements.filter((el) => /^b\d+_v\d+/.test(el.id) && SOLID.has(el.type));
  const host = pictureOf(1);
  const referrer = pictureOf(2);
  assert.ok(host.length > 0 && referrer.length > 0, 'both beats should have drawn a picture');
  for (const a of host) {
    for (const b of referrer) {
      assert.ok(
        !intersects(a, b, boxes),
        `"${b.id}" is drawn through "${a.id}" — the referring beat took the host's cell and ` +
          `redrew the whole picture into it`,
      );
    }
  }
});

test('two beats asking for a picture in the same words still share one image', () => {
  // The saving the stopgap leans on, and the one it does not touch: the registry mints on
  // the prompt, so word-identical requests are one asset however the cells fall out. This
  // is the guarantee `findReferrals`' header claims for `wipe` mode, where there is no
  // shared cell to lean on at all — asserted here so removing referrals from `shares`
  // cannot be read as having removed it.
  const same = JSON.parse(JSON.stringify(REFERRED)) as typeof REFERRED;
  const prompt = same.anchor.visuals[0]!.underlay!.prompt;
  same.steps[0]!.visuals[0]!.underlay!.prompt = prompt;
  const sb = compileLesson(Lesson.parse(same), { board: 'accumulate' });
  const underlays = sb.assets.filter((a) => a.id.startsWith('underlay-'));
  assert.equal(
    underlays.length,
    1,
    `${underlays.length} underlay assets for one prompt — the generator would be paid twice ` +
      `for the same image`,
  );

  // And the differently-worded pair above is two, which is the honest cost of the gap
  // `subjectOf` names: same subject, different words, two images.
  const apart = compileLesson(REFERRED, { board: 'accumulate' });
  assert.equal(apart.assets.filter((a) => a.id.startsWith('underlay-')).length, 2);
});
