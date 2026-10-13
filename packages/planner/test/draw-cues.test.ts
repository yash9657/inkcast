import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mark } from '@inkcast/core';
import { cueMarks, markNames } from '../src/draw-cues.js';
import { buildDrawing } from '../src/drawing.js';

const mark = (m: Partial<Mark> & { id: string; kind: Mark['kind'] }): Mark => ({
  closed: false,
  smooth: false,
  dashed: false,
  ...m,
});

/** A box somewhere on the canvas, so `markBounds` accepts it and it survives cleaning. */
const box = (id: string, x = 100, tone?: Mark['tone']): Mark =>
  mark({ id, kind: 'rect', x, y: 100, w: 120, h: 120, ...(tone ? { tone } : {}) });

/** Ten boxes named after the parts of the narration below, in the order it says them. */
const NARRATION =
  'The charger drags lithium out of the cathode. Each ion crosses the liquid to the graphite. ' +
  'Electrons cannot cross, so they loop through the wire instead.';

const PARTS = [
  'charger',
  'cathode-stack',
  'cathode-hatch',
  'ion-1',
  'ion-2',
  'liquid',
  'graphite-layers',
  'electron-1',
  'wire',
  'wire-arrow',
];

const DRAWING: Mark[] = PARTS.map((id, i) => box(id, 60 + i * 80));

test('a mark is named by its id and by the words a label writes', () => {
  assert.deepEqual(markNames(mark({ id: 'damp-gap', kind: 'rect' })), ['damp', 'gap']);
  // Shape and position words are not parts, so they never anchor anything.
  assert.deepEqual(markNames(mark({ id: 'left-box-3', kind: 'rect' })), []);
  // A label says its own words, and they come first.
  assert.deepEqual(markNames(mark({ id: 'anode-label', kind: 'label', text: 'graphite' })), [
    'graphite',
    'anode',
  ]);
  // Plurals are singularised, so "stacks" in the narration can name `left-stack`.
  assert.deepEqual(markNames(mark({ id: 'stacks', kind: 'rect' })), ['stack']);
});

test('every cue is a verbatim slice of the narration', () => {
  for (const cue of cueMarks(DRAWING, NARRATION)) {
    if (!cue) continue;
    assert.ok(
      NARRATION.includes(cue),
      `cue ${JSON.stringify(cue)} is not in the narration character for character`,
    );
  }
});

test('a part lands on the words that name it', () => {
  const cues = cueMarks(DRAWING, NARRATION);
  const at = (id: string) => cues[PARTS.indexOf(id)] ?? '';
  assert.ok(at('charger').startsWith('charger'), `charger got ${JSON.stringify(at('charger'))}`);
  assert.ok(at('liquid').startsWith('liquid'), `liquid got ${JSON.stringify(at('liquid'))}`);
  assert.ok(at('wire').startsWith('wire'), `wire got ${JSON.stringify(at('wire'))}`);
});

test('cues advance through the narration and never run backwards', () => {
  const cues = cueMarks(DRAWING, NARRATION);
  let previous = -1;
  for (const cue of cues) {
    if (!cue) continue;
    const at = NARRATION.indexOf(cue);
    assert.ok(at >= previous, `"${cue}" at ${at} goes back behind ${previous}`);
    previous = at;
  }
});

test('the drawing starts near the top of the beat, whatever its first mark is called', () => {
  // The regression `tandemcheck.mts` caught: the opening mark named after a material
  // whose only mention is two sentences later dragged the whole picture with it.
  const late =
    'Two flat stacks face each other across a gap. The left one is layered carbon, called graphite.';
  const marks = [
    // Named after the material, whose only mention is in the last four words.
    box('graphite-outline', 60),
    ...['stack-b', 'gap-line', 'layer-1', 'layer-2', 'layer-3'].map((id, i) =>
      box(id, 140 + i * 80),
    ),
  ];
  const first = cueMarks(marks, late)[0];
  assert.ok(first, 'the first mark should still get a cue');
  assert.ok(
    late.indexOf(first) < late.indexOf('graphite'),
    `the first stroke landed on ${JSON.stringify(first)}, at or after "graphite"`,
  );
});

test('a drawing small enough to be one gesture keeps the beat’s own cue', () => {
  const small = [box('hill', 60), box('fog', 200), box('figure', 340)];
  assert.deepEqual(cueMarks(small, 'A figure stands on a hill in thick fog.'), [
    undefined,
    undefined,
    undefined,
  ]);
});

test('a drawing the narration names nothing in is left to its intent', () => {
  const cues = cueMarks(DRAWING, 'Nothing here has anything at all to do with that picture.');
  assert.deepEqual(new Set(cues), new Set([undefined]));
});

test('empty narration is not an error', () => {
  assert.deepEqual(cueMarks(DRAWING, ''), new Array(DRAWING.length).fill(undefined));
});

test('buildDrawing carries the cue and the tone onto the elements', () => {
  const els = buildDrawing([...DRAWING, box('charger-glow', 900, 'accent')], {
    id: 'b1_v0',
    box: { x: 0, y: 0, w: 800, h: 400 },
    narration: NARRATION,
  });
  assert.ok(
    els.some((el) => el.enter.cue),
    'no element claimed a phrase of the narration',
  );
  const glow = els.find((el) => el.id.endsWith('charger-glow'));
  assert.equal(glow?.tone, 'accent');
  // `ink` is the default and is never written down.
  assert.equal(els.find((el) => el.id.endsWith('_wire'))?.tone, undefined);
});

test('without narration a drawing is unchanged, cues and all', () => {
  const els = buildDrawing(DRAWING, { id: 'b1_v0', box: { x: 0, y: 0, w: 800, h: 400 } });
  assert.deepEqual(
    els.filter((el) => el.enter.cue),
    [],
  );
});

test('explicit spoken cues beat inferred mark order, including a small drawing', () => {
  const text = 'The receiver listens first. The satellite comes next.';
  const marks = [
    { ...box('satellite'), cue: 'satellite comes' },
    { ...box('receiver'), cue: 'receiver listens' },
  ];
  assert.deepEqual(cueMarks(marks, text), ['satellite comes', 'receiver listens']);
  assert.deepEqual(cueMarks([{ ...marks[0]!, cue: 'invented words' }], text), [undefined]);
});
