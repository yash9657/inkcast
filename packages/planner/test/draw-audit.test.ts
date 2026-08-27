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
import { cardFill, inkHitsBox, inkOf, markInk } from '../src/draw-geom.js';
import { cleanMarks, prepareMarks } from '../src/drawing.js';
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

test('the repair does not leave a name further off the canvas than it found it', () => {
  // The other half of the same contradiction as `label-on-ink`: the repair had its own
  // idea of how far outside was acceptable — 4% of the axis, 40 units of the width, five
  // times `OFF_CANVAS_SLACK` — so it could slide a name into a seat the audit then billed
  // a correction call to undo. Measured over the 238 cached drawings before the rule
  // changed: 76 ended off-canvas after the repair and 35 of those were on-canvas as
  // authored. Here the name at x=90 has its own leader's tail through it, so the repair
  // has a reason to move, and left is the near escape — and left is off the canvas.
  const crowded: Mark[] = [
    mark({ id: 'edge-name', kind: 'label', x: 90, y: 300, text: 'same height', size: 26 }),
    mark({
      id: 'edge-leader',
      kind: 'arrow',
      points: [
        [180, 296],
        [420, 200],
      ],
    }),
    mark({ id: 'body', kind: 'ellipse', x: 400, y: 160, w: 200, h: 200 }),
  ];
  const before = auditDrawing(cleanMarks(crowded)).some((d) => d.kind === 'off-canvas');
  const after = auditDrawing(prepareMarks(crowded)).some((d) => d.kind === 'off-canvas');
  assert.equal(before, false, 'the authored marks are on the canvas');
  assert.equal(after, false, 'the repair pushed a name off the canvas the author kept on it');

  // And a name the author already put over the edge is still placeable — the rule is "no
  // further out", not "inside", so this pass never refuses to move a name it should move.
  const authoredOut: Mark[] = [
    mark({ id: 'a', kind: 'label', x: -60, y: 300, text: 'one', size: 26 }),
    mark({ id: 'b', kind: 'label', x: -60, y: 306, text: 'two', size: 26 }),
    mark({ id: 'body', kind: 'ellipse', x: 400, y: 160, w: 200, h: 200 }),
  ];
  assert.equal(
    auditDrawing(prepareMarks(authoredOut)).some((d) => d.kind === 'label-on-label'),
    false,
    'two names stacked outside the canvas were left on top of each other',
  );
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

/* ------------------------------------------- the card's own fill (gate 1's half) */

/**
 * A card of small marks strewn across the board: the shape is right and the ink is not.
 * These are the proportions of the acceptance film's thinnest beats — 15 marks whose boxes
 * cover a sixth of the box they span — reproduced at round numbers.
 */
const strewn: Mark[] = [
  mark({ id: 'ball', kind: 'ellipse', x: 120, y: 230, w: 90, h: 90 }),
  mark({ id: 'apple', kind: 'ellipse', x: 800, y: 250, w: 60, h: 60 }),
  mark({
    id: 'big-pull',
    kind: 'arrow',
    points: [
      [165, 360],
      [165, 500],
    ],
  }),
  mark({
    id: 'small-pull',
    kind: 'arrow',
    points: [
      [830, 330],
      [830, 470],
    ],
  }),
  mark({ id: 'ball-name', kind: 'label', x: 165, y: 70, text: 'ball', size: 28 }),
  mark({ id: 'apple-name', kind: 'label', x: 830, y: 80, text: 'apple', size: 28 }),
];

test('a card that will reach the frame as mostly paper is reported, with both its factors', () => {
  const [defect] = auditDrawing(prepareMarks(strewn));
  assert.equal(defect?.kind, 'thin-card');
  // The note carries the number gate 1 will read, the two shares it is made of, and the box
  // they were measured on — a model cannot act on "your drawing is thin".
  assert.match(defect?.note ?? '', /carry about \d+% of the frame/);
  assert.match(defect?.note ?? '', /marks cover \d+% of the \d+x\d+ box they span/);
  assert.match(defect?.note ?? '', /holds \d+% of a 1000x560 board/);
  // Here the ink is the thin factor, not the shape, so the advice is about the parts.
  assert.match(defect?.note ?? '', /bigger where it stands/);
  assert.doesNotMatch(defect?.note ?? '', /use the whole 1000x560 canvas/);
});

test('the fill a card will reach cannot be changed by drawing it larger', () => {
  // The fact the whole check rests on. `fitDrawing` is a *content* fit and the camera is
  // fitted to the ink, so a drawing scaled up is a camera pulled back by the same ratio —
  // which is why the advice says to grow the parts against the gaps and not the drawing.
  //
  // Measured on the ink alone, because the one thing that does not scale with a drawing is
  // its names: the board writes those in its own hand and will not write below caption size,
  // so a drawing authored small reaches the board with relatively *larger* words on it. That
  // is real, and `cardFill` says so; it is not what this test is about.
  const ink = strewn.filter((m) => m.kind !== 'label');
  const scaled = ink.map((m) => ({
    ...m,
    x: m.x === undefined ? undefined : m.x * 0.5 + 200,
    y: m.y === undefined ? undefined : m.y * 0.5 + 100,
    w: m.w === undefined ? undefined : m.w * 0.5,
    h: m.h === undefined ? undefined : m.h * 0.5,
    points: m.points?.map(([x, y]) => [(x as number) * 0.5 + 200, (y as number) * 0.5 + 100]),
  })) as Mark[];
  const before = cardFill(ink);
  const after = cardFill(scaled);
  assert.ok(before && after);
  assert.ok(
    Math.abs(before.fill - after.fill) < 0.005,
    `halving the drawing moved its fill from ${before.fill} to ${after.fill}`,
  );
});

test('a card drawn big, in the board’s own shape, is not a defect', () => {
  const full: Mark[] = [
    mark({ id: 'left-stack', kind: 'rect', x: 60, y: 60, w: 380, h: 440 }),
    mark({ id: 'right-stack', kind: 'rect', x: 560, y: 60, w: 380, h: 440 }),
    mark({ id: 'gap-shading', kind: 'hatch', x: 450, y: 60, w: 100, h: 440, angle: 45 }),
    mark({
      id: 'crossing',
      kind: 'arrow',
      points: [
        [440, 280],
        [560, 280],
      ],
    }),
    mark({ id: 'left-name', kind: 'label', x: 250, y: 30, text: 'anode', size: 30 }),
    mark({ id: 'right-name', kind: 'label', x: 750, y: 30, text: 'cathode', size: 30 }),
  ];
  const card = cardFill(prepareMarks(full));
  assert.ok((card?.fill ?? 0) > 0.5, `a full card measured ${card?.fill}`);
  assert.equal(
    auditDrawing(prepareMarks(full)).some((d) => d.kind === 'thin-card'),
    false,
  );
});

test('a drawing composed over a picture is never reported thin', () => {
  // `FIGURE_BRIEF` asks that lane for names and the leaders that reach them and for nothing
  // else: its marks are meant to be a tenth of the card, and the picture underneath — which
  // is not measurable from here — is what fills it. Reporting these would spend a correction
  // call asking a model to undo its own brief.
  const box = { box: { x: 80, y: 0, w: 840, h: 560 }, traced: false };
  const names: Mark[] = [
    mark({ id: 'feather-name', kind: 'label', x: 200, y: 30, text: 'feather', size: 28 }),
    mark({ id: 'hammer-name', kind: 'label', x: 700, y: 30, text: 'hammer', size: 28 }),
    mark({
      id: 'feather-leader',
      kind: 'arrow',
      points: [
        [200, 60],
        [240, 200],
      ],
    }),
    mark({
      id: 'hammer-leader',
      kind: 'arrow',
      points: [
        [700, 60],
        [660, 200],
      ],
    }),
    mark({
      id: 'floor',
      kind: 'line',
      points: [
        [120, 520],
        [880, 520],
      ],
    }),
  ];
  assert.equal(
    auditDrawing(prepareMarks(names, box), box).some((d) => d.kind === 'thin-card'),
    false,
  );
  // And the same marks on a blank board are a thin card, so the guard is the underlay and
  // not the marks.
  assert.equal(
    auditDrawing(prepareMarks(names)).some((d) => d.kind === 'thin-card'),
    true,
  );
});

test('a name written on a figure is not written on ink', () => {
  // The contradiction this pins, and it stood for the whole life of the figure lane.
  // `FIGURE_BRIEF` tells the author that the 80-unit flanks are "narrower than one word —
  // so the flanks are not where the names live", and to write on the pale paper inside the
  // picture. `underlayInk` called the whole figure box solid, so every name that obeyed was
  // a `label-on-ink` defect and the only clean drawing was a disobedient one. Measured on
  // `projects/f3ac9c760194`: ten findings, all ten on its three figure beats.
  //
  // A figure's box is not a measurement — a figure is never traced, so `figureBox()` is a
  // constant handed out before the picture exists. It is the same "a box is not ink"
  // argument that took `leader-misses` out of this file; see `underlayInk`.
  const figure = { box: { x: 80, y: 0, w: 840, h: 560 }, traced: false };
  const named: Mark[] = [
    mark({ id: 'heavy-ball', kind: 'label', x: 300, y: 300, text: 'heavy ball', size: 28 }),
    mark({
      id: 'ball-leader',
      kind: 'arrow',
      points: [
        [300, 330],
        [380, 420],
      ],
    }),
  ];
  assert.deepEqual(auditDrawing(prepareMarks(named, figure), figure), []);

  // The traced lane keeps the check, and that is the half worth keeping: `underlayInkBox`
  // measures a form's box from a trace of its own raster, so ink really is there.
  const form = { box: { x: 300, y: 30, w: 400, h: 500 }, traced: true };
  assert.equal(
    auditDrawing(named, form).some((d) => d.kind === 'label-on-ink'),
    true,
  );

  // And the repair reads the same distinction: it does not spend the 400-unit escape price
  // hunting for a seat in a margin one word wide.
  const [name] = prepareMarks(named, figure);
  assert.equal(name?.x, 300, 'the name stays where the brief asked for it');
});

test('a stub of two or three marks is a beat’s problem, not a card’s', () => {
  const stub: Mark[] = [
    mark({ id: 'cell', kind: 'rect', x: 420, y: 240, w: 120, h: 80 }),
    mark({ id: 'name', kind: 'label', x: 480, y: 200, text: 'the cell', size: 28 }),
  ];
  assert.deepEqual(auditDrawing(prepareMarks(stub)), []);
});

test('a thin card never outranks a name nobody can read', () => {
  // The veto in `draw-critic.ts` keeps a revision only when it scores no worse, so these
  // weights decide what a correction is allowed to trade. Filling the card at the price of
  // writing a name across an arrow has to lose; fixing the name and leaving the card as thin
  // as it was found has to win.
  const thin = defectScore([{ kind: 'thin-card', ids: [], note: '' }]);
  const onInk = defectScore([{ kind: 'label-on-ink', ids: [], note: '' }]);
  assert.ok(thin < onInk, `thin-card ${thin} must weigh less than label-on-ink ${onInk}`);
});
