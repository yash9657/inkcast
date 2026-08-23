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
  inkOnInkViolations,
  offFrameViolations,
  overrunViolations,
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
