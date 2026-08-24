import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mark } from '@inkcast/core';
import { DRAW_H, DRAW_W } from '@inkcast/core';
import {
  auditDrawing,
  defectScore,
  defectSummary,
  lessonDrawingDefects,
} from '../src/draw-audit.js';
import { inkHitsBox, inkOf, markInk } from '../src/draw-geom.js';
import { prepareMarks } from '../src/drawing.js';
import { CARDIAC } from './cardiac-lesson.js';

const mark = (m: Partial<Mark> & { id: string; kind: Mark['kind'] }): Mark => ({
  closed: false,
  smooth: false,
  dashed: false,
  ...m,
});

const kinds = (marks: Mark[]): string[] => auditDrawing(marks).map((d) => d.kind);

test('a rectangle is four edges, not a filled block', () => {
  // The distinction the whole audit rests on: a name inside a container is ordinary
  // whiteboard practice, a name lying across a line is a defect. A bounding box cannot
  // tell those apart and had to approximate it with an area cap.
  const box = mark({ id: 'outline', kind: 'rect', x: 0, y: 0, w: 400, h: 300 });
  const ink = markInk(box);
  assert.ok(ink);
  assert.equal(ink.segs.length, 4);
  // The middle is free…
  assert.equal(inkHitsBox(ink, { x: 180, y: 130, w: 40, h: 40 }), false);
  // …and the edge is not.
  assert.equal(inkHitsBox(ink, { x: 180, y: -10, w: 40, h: 40 }), true);
});

test('a long arrow obstructs its line and nothing else', () => {
  // The case the area cap got wrong every time: an arrow across the drawing has a
  // bounding box covering the drawing and lays down a line a few units wide.
  const arrow = mark({
    id: 'flow',
    kind: 'arrow',
    points: [
      [0, 0],
      [900, 500],
    ],
  });
  const ink = markInk(arrow);
  assert.ok(ink);
  // On the diagonal.
  assert.equal(inkHitsBox(ink, { x: 440, y: 240, w: 30, h: 30 }), true);
  // Inside its bounding box, far off the line.
  assert.equal(inkHitsBox(ink, { x: 700, y: 60, w: 80, h: 40 }), false);
});

test('shading is something a name may be written on', () => {
  // Measured, not assumed. When hatching counted as an obstacle, the audit reported the
  // `N` and `S` inside a hatched bar magnet as two defects, and the correction pass moved
  // both letters out of the magnet and into the field lines below it, where they named
  // nothing at all — and scored zero, because the collisions were gone.
  const magnet: Mark[] = [
    mark({ id: 'body', kind: 'rect', x: 300, y: 240, w: 400, h: 120 }),
    mark({ id: 'north-shading', kind: 'hatch', x: 300, y: 240, w: 200, h: 120, angle: 45 }),
    mark({ id: 'north', kind: 'label', x: 400, y: 300, text: 'N', size: 34 }),
  ];
  assert.deepEqual(auditDrawing(prepareMarks(magnet)), []);
  // The repair leaves it alone too: it is not an obstacle to either of them.
  const placed = prepareMarks(magnet).find((m) => m.id === 'north');
  assert.equal(placed?.x, 400);
  assert.equal(placed?.y, 300);

  // But shading still counts as something to be *near*, so a name on it is not adrift.
  const far = [...magnet.slice(0, 2), mark({ id: 'n', kind: 'label', x: 400, y: 300, text: 'N' })];
  assert.equal(kinds(prepareMarks(far)).includes('label-adrift'), false);
});

test('two names on top of each other are always reported', () => {
  const stacked: Mark[] = [
    mark({ id: 'a', kind: 'label', x: 400, y: 250, text: 'right atrium', size: 30 }),
    mark({ id: 'b', kind: 'label', x: 405, y: 252, text: 'bicuspid valve', size: 30 }),
  ];
  assert.deepEqual(kinds(stacked), ['label-on-label']);
  // And the free repair pass fixes it, so the model is never asked to.
  assert.deepEqual(auditDrawing(prepareMarks(stacked)), []);
});

test('a name lying across a line is reported, and names what it crosses', () => {
  const across: Mark[] = [
    mark({
      id: 'axis',
      kind: 'line',
      points: [
        [100, 300],
        [900, 300],
      ],
    }),
    mark({ id: 'name', kind: 'label', x: 500, y: 300, text: 'the axis', size: 30 }),
  ];
  const [defect] = auditDrawing(across);
  assert.equal(defect?.kind, 'label-on-ink');
  assert.deepEqual(defect?.ids, ['name', 'axis']);
  assert.match(defect?.note ?? '', /axis \(line\)/);
  // The note carries coordinates, because a model cannot act on "somewhere near the axis".
  assert.match(defect?.note ?? '', /\(\d+,\d+\)/);
});

test('a word too long for its line is reported before the board breaks it in half', () => {
  // Arithmetic, not judgement: the planner wraps at an estimate and the renderer wraps
  // again against real handwriting metrics, so a word wider than its box comes out as
  // `Cartil / age`.
  const wide = mark({
    id: 'l',
    kind: 'label',
    x: 500,
    y: 280,
    text: 'electroencephalography',
    size: 44,
  });
  const [defect] = auditDrawing([wide]);
  assert.equal(defect?.kind, 'broken-word');
  assert.match(defect?.note ?? '', /electroencephalography/);
  // The note says what size would fit, because "too long" is not actionable on its own.
  assert.match(defect?.note ?? '', /drop size to about \d+/);
  // The same word at a size it fits is not a defect.
  assert.deepEqual(auditDrawing([{ ...wide, size: 16 }]), []);
});

test('ink off the canvas is reported, and names the marks that left', () => {
  const strays: Mark[] = [
    mark({ id: 'body', kind: 'rect', x: 100, y: 100, w: 400, h: 300 }),
    mark({ id: 'stray', kind: 'label', x: DRAW_W + 180, y: 200, text: 'over here', size: 30 }),
  ];
  const found = auditDrawing(strays);
  const off = found.find((d) => d.kind === 'off-canvas');
  assert.ok(off, 'a mark 180 units off the canvas was not reported');
  assert.deepEqual(off.ids, ['stray']);
  assert.match(off.note, new RegExp(`${DRAW_W}x${DRAW_H}`));
});

test('a label with nothing near it is reported as naming nothing', () => {
  const adrift: Mark[] = [
    mark({ id: 'body', kind: 'rect', x: 60, y: 60, w: 200, h: 150 }),
    mark({ id: 'far', kind: 'label', x: 820, y: 480, text: 'the body', size: 30 }),
  ];
  assert.ok(kinds(adrift).includes('label-adrift'));
  // A label with a leader arrow reaching its part is not adrift: the arrow is ink, and its
  // own tail is what the distance is measured to.
  const led: Mark[] = [
    ...adrift,
    mark({
      id: 'leader',
      kind: 'arrow',
      points: [
        [780, 470],
        [270, 140],
      ],
    }),
  ];
  assert.equal(kinds(led).includes('label-adrift'), false);
});

test('an honest drawing measures clean, and the score orders what does not', () => {
  const honest: Mark[] = [
    mark({ id: 'cell', kind: 'rect', x: 200, y: 150, w: 400, h: 250 }),
    mark({ id: 'name', kind: 'label', x: 400, y: 275, text: 'the cell', size: 30 }),
  ];
  assert.deepEqual(auditDrawing(honest), []);
  assert.equal(defectScore([]), 0);
  assert.equal(defectSummary([]), 'clean');

  // Two names on each other outrank one name on a line, because a viewer cannot read the
  // first at all and can read the second.
  const collision = auditDrawing([
    mark({ id: 'a', kind: 'label', x: 400, y: 250, text: 'aortic valve', size: 30 }),
    mark({ id: 'b', kind: 'label', x: 404, y: 252, text: 'mitral valve', size: 30 }),
  ]);
  const crossing = auditDrawing([
    mark({
      id: 'axis',
      kind: 'line',
      points: [
        [100, 300],
        [900, 300],
      ],
    }),
    mark({ id: 'name', kind: 'label', x: 500, y: 300, text: 'the axis', size: 30 }),
  ]);
  assert.ok(defectScore(collision) > defectScore(crossing));
  assert.match(defectSummary(collision), /label-on-label×1/);
});

test('every mark kind resolves to ink or is honestly nothing', () => {
  // A kind that silently resolved to no ink would be a kind labels could be placed on top
  // of for ever without anything noticing.
  const one = (kind: Mark['kind']): Mark =>
    mark({
      id: kind,
      kind,
      x: 100,
      y: 100,
      w: 200,
      h: 150,
      points: [
        [100, 100],
        [300, 250],
      ],
      text: 'x',
      count: 6,
      angle: 45,
    });
  const drawable: Mark['kind'][] = ['rect', 'ellipse', 'line', 'stroke', 'arrow', 'hatch', 'dots'];
  assert.equal(inkOf(drawable.map(one)).length, drawable.length);
  // A label is not an obstacle: it is what we are placing.
  assert.equal(markInk(one('label')), undefined);
});

/* ---------------------------------------- the lesson-level audit (plan 3.4) */

/**
 * `lessonDrawingDefects` recovers the drawing lane's history from `lesson.json`.
 *
 * The reason it exists is that the lane's own tally is a log line inside a keyed run,
 * and every later run of the same project serves the lesson from cache and prints
 * nothing at all — so the pictures were known to be flawed exactly once. These two
 * tests are the both-directions pin: a lesson whose marks are clean must produce
 * silence (or the record is noise), and a lesson carrying a real defect must name it,
 * with the drawing identified well enough to go and look at it.
 */
test('a lesson whose drawings are clean has no drawing history to report', () => {
  const lesson = structuredClone(CARDIAC);
  lesson.hook.visuals = [
    {
      kind: 'draw',
      describe: 'two stacked bags of water, the top draining into the bottom',
      marks: [
        mark({ id: 'top', kind: 'ellipse', x: 300, y: 120, w: 200, h: 140 }),
        mark({ id: 'name', kind: 'label', x: 300, y: 320, text: 'top bag', size: 28 }),
      ],
    },
  ] as never;
  assert.deepEqual(lessonDrawingDefects(lesson), []);
});

test("a defect standing in a lesson's marks is named, with the drawing it is in", () => {
  const lesson = structuredClone(CARDIAC);
  // A word too long for its line, which is the class the free repair pass cannot fix:
  // it moves labels, and no amount of moving makes a word fit. So it is exactly what
  // *stands* in a finished lesson — the defect that reaches the board as `sternocleido
  // / mastoideus` — which is what this record exists to report.
  lesson.hook.visuals = [
    {
      kind: 'draw',
      describe: 'a neck muscle with its full anatomical name written beside it',
      marks: [
        mark({ id: 'muscle', kind: 'rect', x: 200, y: 200, w: 400, h: 200 }),
        mark({
          id: 'name',
          kind: 'label',
          x: 700,
          y: 100,
          text: 'sternocleidomastoideus',
          size: 48,
        }),
      ],
    },
  ] as never;
  const [line, ...rest] = lessonDrawingDefects(lesson);
  assert.deepEqual(rest, [], 'one drawing, one line');
  assert.match(line ?? '', /a neck muscle with its full anatomical name/);
  assert.match(line ?? '', /1 standing defect \(broken-word×1\)/);
  assert.match(line ?? '', /sternocleidomastoideus/);
});

test('a drawing intent with no marks is not audited — there is nothing on the board yet', () => {
  const lesson = structuredClone(CARDIAC);
  lesson.hook.visuals = [{ kind: 'draw', describe: 'a picture nobody drew' }] as never;
  assert.deepEqual(lessonDrawingDefects(lesson), []);
});
