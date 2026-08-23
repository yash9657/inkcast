/**
 * The board assertions (plan 2.3): each check has a red test — a constructed bad
 * plan fails — and the corpus stays green (`compile.test.ts` compiles the fixtures
 * through `compilePlan`, which now runs every check on every plan it builds).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard, resolveFraming, frameSize } from '@inkcast/core';
import type { Storyboard } from '@inkcast/core';
import {
  dwellFloor,
  dwellWarnings,
  glyphFloorViolations,
  inkOnInkViolations,
  offFrameViolations,
  overrunViolations,
  realizedTextViolations,
} from './boardcheck.js';
import { compilePlan } from './compile.js';

const FRAME = frameSize('16:9');

/** A two-scene board, bad in exactly the ways each test below asks for. */
function board(overrides: {
  elements1?: unknown[];
  elements2?: unknown[];
  camera2?: { x?: number; y?: number; zoom?: number; transition?: number };
}): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'boardcheck',
    scenes: [
      {
        id: 's1',
        narration: 'first',
        durationSec: 4,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: overrides.elements1 ?? [],
      },
      {
        id: 's2',
        narration: 'second',
        durationSec: 4,
        camera: { x: 960, y: 540, zoom: 1, ...overrides.camera2 },
        elements: overrides.elements2 ?? [],
      },
    ],
  });
}

const text = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  text: 'two words',
  at: { x, y, w: 300, h: 60 },
  ...extra,
});

test('ink on ink: two solid persistent elements sharing board space is a violation', () => {
  // Same spot, different scenes — under accumulate both are on the board at once.
  const sb = board({
    elements1: [text('a', 100, 100)],
    elements2: [text('b', 200, 120)],
  });
  const v = inkOnInkViolations(sb.scenes, false);
  assert.equal(v.length, 1);
  assert.match(v[0]!.message, /"a".*"b"|"b".*"a"/);

  // Clear of each other: no violation.
  const apart = board({
    elements1: [text('a', 100, 100)],
    elements2: [text('b', 900, 700)],
  });
  assert.equal(inkOnInkViolations(apart.scenes, false).length, 0);
});

test('ink on ink: nesting, morphs, one drawing, and transients are all exempt', () => {
  // A label inside its picture is annotation, not collision.
  const nested = board({
    elements1: [
      { id: 'pic', type: 'shape', shape: 'rect', at: { x: 100, y: 100, w: 600, h: 400 } },
      text('label', 200, 200),
    ],
  });
  assert.equal(inkOnInkViolations(nested.scenes, false).length, 0);

  // The morph target grows out of its source.
  const morphed = board({
    elements1: [
      { id: 'from', type: 'shape', shape: 'rect', at: { x: 100, y: 100, w: 300, h: 300 } },
    ],
    elements2: [
      {
        id: 'into',
        type: 'shape',
        shape: 'ellipse',
        at: { x: 150, y: 150, w: 300, h: 300 },
        morph: { fromId: 'from' },
      },
    ],
  });
  assert.equal(inkOnInkViolations(morphed.scenes, false).length, 0);

  // Two parts of one drawing (the planner's `<id>_v<n>_<mark>` convention) are one
  // picture — the drawing lane polices those against real ink, not boxes.
  const drawing = board({
    elements1: [
      { id: 'b1_v0_body', type: 'shape', shape: 'rect', at: { x: 100, y: 100, w: 400, h: 300 } },
      text('b1_v0_name', 300, 250),
    ],
  });
  assert.equal(inkOnInkViolations(drawing.scenes, false).length, 0);

  // A transient annotation is exempt: the sweep is over persistent ink, and a
  // one-beat note deliberately sits over the thing it annotates, then fades.
  const transient = board({
    elements1: [text('a', 100, 100)],
    elements2: [text('b', 200, 120, { persist: false })],
  });
  const v = inkOnInkViolations(transient.scenes, false);
  assert.equal(v.length, 0, 'a transient over persistent ink is annotation, not collision');
});

test('off frame: an authored camera that misses its own reveal is an error; derived warns', () => {
  // The camera looks at the middle; the text sits far outside its view.
  const sb = board({
    elements2: [text('lost', 4000, 3000)],
    camera2: { x: 960, y: 540, zoom: 2 },
  });
  const framing = resolveFraming(sb, FRAME);
  assert.equal(framing[1]?.derived, false, 'no region: the author camera stands');
  const { errors, warnings } = offFrameViolations(sb.scenes, framing, sb.canvas, FRAME);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /"lost".*authored camera/s);
  assert.equal(warnings.length, 0);

  // The same miss on a derived framing is the system's own trade — a warning.
  const derived = framing.map((f) => ({ ...f, derived: true }));
  const soft = offFrameViolations(sb.scenes, derived, sb.canvas, FRAME);
  assert.equal(soft.errors.length, 0);
  assert.equal(soft.warnings.length, 1);
});

test('overrun: an item drawn past its scene end is a violation', () => {
  const bad = { id: 'late', start: 3.8, dur: 0.5, sceneEnd: 4, persist: true };
  const ok = { id: 'fits', start: 3.5, dur: 0.5, sceneEnd: 4, persist: true };
  const v = overrunViolations([bad, ok]);
  assert.equal(v.length, 1);
  assert.match(v[0]!.message, /"late"/);
});

test('dwell: thin residence warns for board text, never for a drawing mark', () => {
  assert.equal(dwellFloor(1), 1.2);
  assert.equal(dwellFloor(10), 2.5);
  const thin = { id: 'idea', start: 3, dur: 0.8, sceneEnd: 4, persist: true, words: 8 };
  const roomy = { id: 'calm', start: 0, dur: 0.8, sceneEnd: 4, persist: true, words: 8 };
  const mark = { id: 'b1_v0_plus', start: 3.8, dur: 0.2, sceneEnd: 4, persist: true, words: 1 };
  const v = dwellWarnings([thin, roomy, mark]);
  assert.equal(v.length, 1);
  assert.match(v[0]!.message, /"idea"/);
});

test('compilePlan blocks a bad board under strict and only warns under degrade', () => {
  const sb = board({
    elements1: [text('a', 100, 100)],
    elements2: [text('b', 200, 120)],
  });
  assert.throws(() => compilePlan(sb, '/tmp', { gates: 'strict' }), /board assertion|ink-on-ink/);
  // Degrade (and the bare default) still compiles — today's behaviour, said out loud.
  assert.ok(compilePlan(sb, '/tmp', { gates: 'degrade' }).items.length > 0);
  assert.ok(compilePlan(sb, '/tmp').items.length > 0);
});

test('a fraction-0 reveal of persistent ink waits for the camera to settle', () => {
  const sb = board({
    elements2: [text('idea', 800, 500, { enter: { at: 0, duration: 0.8, style: 'write' } })],
    camera2: { transition: 0.9 },
  });
  const plan = compilePlan(sb, '/tmp');
  const idea = plan.items.find((i) => i.id === 'idea');
  assert.ok(idea);
  const sceneStart = plan.scenes[1]!.start;
  assert.ok(
    Math.abs(idea.start - (sceneStart + 0.9)) < 1e-9,
    `revealed at ${idea.start}, expected ${sceneStart + 0.9} — after the 0.9s transition`,
  );

  // A transient annotation does not wait: its whole life is inside the beat.
  const transient = board({
    elements2: [
      text('note', 800, 500, { persist: false, enter: { at: 0, duration: 0.8, style: 'fade' } }),
    ],
    camera2: { transition: 0.9 },
  });
  const note = compilePlan(transient, '/tmp').items.find((i) => i.id === 'note');
  assert.equal(note?.start, compilePlan(transient, '/tmp').scenes[1]!.start);
});

test('a mostly-empty board fails the fill floor; --degrade records it on the plan', () => {
  // One small caption on a full-HD canvas: fill under 1%, unmistakably vacant.
  const vacant = board({ elements1: [text('lonely', 800, 500)] });
  assert.throws(() => compilePlan(vacant, '/tmp', { gates: 'strict' }), /mostly whitespace/);
  const plan = compilePlan(vacant, '/tmp', { gates: 'degrade' });
  assert.ok(plan.problems?.some((p) => p.includes('mostly whitespace')));

  // A composed board clears the floor: one real block of content per scene.
  const composed = board({
    elements1: [
      { id: 'big1', type: 'shape', shape: 'rect', at: { x: 100, y: 50, w: 1100, h: 500 } },
    ],
    elements2: [
      { id: 'big2', type: 'shape', shape: 'rect', at: { x: 400, y: 560, w: 1100, h: 500 } },
    ],
  });
  const ok = compilePlan(composed, '/tmp', { gates: 'strict' });
  assert.equal(ok.problems, undefined);
});

test('text introduced below the legibility floor blocks; readable type passes', () => {
  // A caption on a camera zoomed far out: 26px × 0.3 zoom = 7.8 output px of
  // handwriting. The corpus's shipped minimum is 10.9px (recap reveals) — the floor
  // at 10 passes everything reviewed and fails exactly this class.
  const make = (zoom: number) =>
    board({
      elements2: [
        {
          id: 'cap',
          type: 'text',
          text: 'tiny words',
          role: 'caption',
          at: { x: 800, y: 500, w: 300, h: 60 },
        },
      ],
      camera2: { zoom },
    });
  const wide = make(0.3);
  const wideFraming = resolveFraming(wide, FRAME);
  const v = glyphFloorViolations(wide.scenes, wideFraming, wide.canvas, FRAME, 1);
  assert.equal(v.length, 1);
  assert.match(v[0]!.message, /"cap".*legibility floor/s);

  const near = make(1);
  assert.equal(
    glyphFloorViolations(near.scenes, resolveFraming(near, FRAME), near.canvas, FRAME, 1).length,
    0,
  );
});

test('the realized report catches the shrink the estimate cannot see', () => {
  const plan = {
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    frame: { w: 1920, h: 1080 },
    scenes: [{ camera: { zoom: 1 } }],
    items: [
      { id: 'squeezed', scene: 0 },
      { id: 'overflowing', scene: 0 },
      { id: 'calm', scene: 0 },
    ],
  };
  const reports = [
    // Shrunk from 34 to 9 canvas units = 9px at zoom 1: below the floor.
    {
      id: 'squeezed',
      text: 'long words',
      asked: 34,
      size: 9,
      lines: 4,
      boxW: 120,
      boxH: 100,
      blockH: 46.8,
      fits: true,
    },
    // Does not fit even at the shrink floor: the browser will overflow the box.
    {
      id: 'overflowing',
      text: 'far too much',
      asked: 34,
      size: 14.3,
      lines: 6,
      boxW: 120,
      boxH: 46,
      blockH: 111,
      fits: false,
    },
    // Lettered exactly as asked: nothing to report.
    {
      id: 'calm',
      text: 'fits fine',
      asked: 34,
      size: 34,
      lines: 1,
      boxW: 500,
      boxH: 60,
      blockH: 44.2,
      fits: true,
    },
  ];
  const v = realizedTextViolations(reports, plan);
  assert.equal(v.length, 2);
  assert.ok(v.some((x) => x.message.includes('"squeezed"') && x.message.includes('legibility')));
  assert.ok(v.some((x) => x.message.includes('"overflowing"') && x.message.includes('fit its')));
});

test('a NaN coordinate or a zero-sized box never parses', () => {
  const bad = (at: Record<string, number>) => ({
    version: 1,
    title: 'x',
    scenes: [
      {
        id: 's',
        narration: 'a',
        durationSec: 1,
        camera: { x: 0, y: 0 },
        elements: [{ id: 't', type: 'text', text: 'hi', at }],
      },
    ],
  });
  assert.throws(() => parseStoryboard(bad({ x: NaN, y: 0, w: 100, h: 40 })));
  assert.throws(() => parseStoryboard(bad({ x: 0, y: 0, w: 0, h: 40 })));
  assert.throws(() => parseStoryboard(bad({ x: 0, y: 0, w: 100, h: -5 })));
});
