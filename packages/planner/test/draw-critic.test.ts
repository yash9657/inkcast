import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mark } from '@inkcast/core';
import type { Client, Message } from '../src/anthropic.js';
import { reviseDrawing } from '../src/draw-critic.js';

const mark = (m: Partial<Mark> & { id: string; kind: Mark['kind'] }): Mark => ({
  closed: false,
  smooth: false,
  dashed: false,
  ...m,
});

const axis = mark({
  id: 'axis',
  kind: 'line',
  points: [
    [100, 450],
    [900, 450],
  ],
});
const name = mark({ id: 'name', kind: 'label', x: 300, y: 400, text: 'the body', size: 30 });

/**
 * A drawing whose defect the free repair cannot fix: a shape 200 units off the canvas.
 *
 * Deliberately not a label lying across a line — `repairLabels` moves those before the audit
 * ever sees them, which is the whole point of the gate and is what makes a mis-built fixture
 * look like a broken critic. What is left for a model is the geometry nothing can nudge.
 */
const DIRTY: Mark[] = [
  mark({ id: 'body', kind: 'rect', x: 700, y: 100, w: 500, h: 300 }),
  axis,
  name,
];

/** The same drawing, brought back inside the canvas. */
const CLEAN: Mark[] = [
  mark({ id: 'body', kind: 'rect', x: 400, y: 100, w: 500, h: 300 }),
  axis,
  name,
];

/**
 * Still off the canvas, and now naming it in type so big the board must break the word.
 *
 * A broken word, deliberately: it is the one defect the free repair pass cannot touch
 * (the repair moves labels, it never resizes them), so this reply measures worse no
 * matter what `repairLabels` does first. The previous fixture's two stacked names
 * stopped working as "worse" when footprints became honest (plan item 2.1) — their
 * escape got cheap enough that the repair simply fixed them, and the veto saw a tie.
 */
const WORSE: Mark[] = [
  mark({ id: 'body', kind: 'rect', x: 900, y: 100, w: 500, h: 300 }),
  axis,
  mark({
    id: 'name',
    kind: 'label',
    x: 500,
    y: 250,
    text: 'electroencephalographically',
    size: 60,
  }),
];

type Call = { system: string; messages: Message[] };

/** A client that answers with `reply` and records what it was asked. */
function stub(reply: Mark[]): { client: Client; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (body) => {
          calls.push({ system: body.system, messages: body.messages });
          return {
            content: [{ type: 'tool_use', name: 'emit_drawing', input: { elements: reply } }],
          };
        },
      },
    },
  };
}

/** A stand-in render. The critic refuses to work blind, so every test that expects a
 * model call has to bring a picture — exactly the contract production has. */
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

const opts = (client: Client, extra: Record<string, unknown> = {}) => ({
  client,
  model: 'test-model',
  schema: { type: 'object' as const },
  instruction: 'a curve over an axis, with the axis named',
  preview: async () => PNG,
  ...extra,
});

test('a drawing with nothing measurably wrong is never sent to a model', () => {
  // The gate. Half the drawings in the machine-wide cache are already clean, and a loop
  // that called on those would double the cost of the lane to change nothing.
  const { client, calls } = stub(CLEAN);
  return reviseDrawing(CLEAN, opts(client)).then((revision) => {
    assert.equal(revision, undefined);
    assert.equal(calls.length, 0, 'a clean drawing paid for a call');
  });
});

test('a correction that fixes the defect is kept', async () => {
  const { client, calls } = stub(CLEAN);
  const revision = await reviseDrawing(DIRTY, opts(client));
  assert.ok(revision);
  assert.equal(calls.length, 1);
  assert.equal(revision.kept, true);
  assert.ok(revision.after < revision.before, `${revision.before} -> ${revision.after}`);
  assert.deepEqual(revision.marks, CLEAN);
});

test('a correction that measures worse is thrown away', async () => {
  // The veto. A model asked to move one label will sometimes redraw a third thing worse,
  // and without this the loop would change drawings rather than improve them.
  const { client } = stub(WORSE);
  const revision = await reviseDrawing(DIRTY, opts(client));
  assert.ok(revision);
  assert.equal(revision.kept, false);
  assert.ok(revision.after > revision.before);
  assert.deepEqual(revision.marks, DIRTY, 'the original drawing was not kept');
});

test('a tie goes to the model, because the model has seen the picture', async () => {
  // The score knows about labels and bounds; the model has looked at the render. A revision
  // that measures the same may have fixed something no measurement can see — which is what
  // the heart did, where demanding a strictly better score threw away the correction and
  // kept a septum labelled inside the wrong ventricle.
  // Off the canvas by the same amount, on the other side: exactly as measurably wrong.
  const sameScore: Mark[] = [
    mark({ id: 'body', kind: 'rect', x: -200, y: 60, w: 500, h: 200 }),
    axis,
    name,
  ];
  const { client } = stub(sameScore);
  const revision = await reviseDrawing(DIRTY, opts(client));
  assert.ok(revision);
  assert.equal(revision.after, revision.before);
  assert.equal(revision.kept, true);
  assert.deepEqual(revision.marks, sameScore);
});

test('the drawing is shown to the model as a picture when there is one', async () => {
  const { client, calls } = stub(CLEAN);
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  await reviseDrawing(DIRTY, opts(client, { preview: async () => png }));
  const content = calls[0]?.messages[0]?.content;
  assert.ok(Array.isArray(content), 'the request carried no content blocks, so no image');
  const image = content.find((part) => part.type === 'image');
  assert.ok(image && image.type === 'image');
  assert.equal(image.source.media_type, 'image/png');
  assert.equal(image.source.data, Buffer.from(png).toString('base64'));
  // The picture comes first: the marks and the measurements are what it is *about*.
  assert.equal(content[0]?.type, 'image');
  const text = content.find((part) => part.type === 'text');
  assert.ok(text && text.type === 'text');
  assert.match(text.text, /runs 200 past x=1000/, 'the measured defect was not passed on');
  assert.match(text.text, /THE MARKS THAT DREW IT/);
});

test('without a renderer it skips the correction instead of revising blind', async () => {
  // The old behaviour — correcting from the mark list alone, logged at debug — was the
  // audit's S9-c/X-e: it undermined the pass's whole justification (the model can SEE
  // what it drew) and was nearly invisible. Now the defects stand, loudly, and the
  // model is never asked to fix coordinates it cannot look at.
  const { client, calls } = stub(CLEAN);
  const revision = await reviseDrawing(DIRTY, opts(client, { preview: async () => undefined }));
  assert.equal(revision, undefined, 'a blind revision was made');
  assert.equal(calls.length, 0, 'a model was called without a picture to show it');
});

test('a model that answers with nothing usable leaves the drawing alone', async () => {
  const broken: Client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'here you go' }] }),
    },
  };
  assert.equal(await reviseDrawing(DIRTY, opts(broken)), undefined);

  const nonsense: Client = {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', name: 'emit_drawing', input: { elements: 'not a drawing' } }],
      }),
    },
  };
  assert.equal(await reviseDrawing(DIRTY, opts(nonsense)), undefined);
});

test('a clean drawing is looked at when the caller insists', async () => {
  // `INKCAST_DRAW_FIX=all`: the gate is arithmetic and geometry is not arithmetic, so the
  // unconditional pass has to be runnable even though it is not the default.
  const { client, calls } = stub(CLEAN);
  const revision = await reviseDrawing(CLEAN, opts(client, { always: true }));
  assert.equal(calls.length, 1);
  assert.equal(revision?.kept, true);
  // Every call now carries the render, so the words live in the text block.
  const content = calls[0]?.messages[0]?.content;
  assert.ok(Array.isArray(content));
  const text = content.find((part) => part.type === 'text');
  assert.ok(text && text.type === 'text');
  assert.match(text.text, /NOTHING MEASURED WRONG/);
});

test('a thin card is told, never bought', async () => {
  // The economics half of `thin-card`. A third of the drawings in the machine cache are
  // thin, so letting one open the gate would spend a vision call on every third picture —
  // and the first run under this check spent two of them, on the knee joint and the neuron,
  // and got a worse drawing back both times. So a thin card alone buys nothing…
  const thin: Mark[] = [
    mark({ id: 'left', kind: 'ellipse', x: 60, y: 220, w: 90, h: 90 }),
    mark({ id: 'right', kind: 'ellipse', x: 860, y: 240, w: 60, h: 60 }),
    mark({
      id: 'left-pull',
      kind: 'arrow',
      points: [
        [105, 340],
        [105, 470],
      ],
    }),
    mark({
      id: 'right-pull',
      kind: 'arrow',
      points: [
        [890, 320],
        [890, 420],
      ],
    }),
    mark({ id: 'left-name', kind: 'label', x: 105, y: 90, text: 'ball', size: 28 }),
    mark({ id: 'right-name', kind: 'label', x: 890, y: 100, text: 'apple', size: 28 }),
  ];
  const quiet = stub(thin);
  assert.equal(await reviseDrawing(thin, opts(quiet.client)), undefined);
  assert.equal(quiet.calls.length, 0, 'a thin card bought a call on its own');

  // …but a drawing that is paying for a call anyway is told about it, so the model can fix
  // it for free while it is looking at the picture.
  const alsoDirty = [...thin, ...DIRTY];
  const loud = stub(alsoDirty);
  await reviseDrawing(alsoDirty, opts(loud.client));
  assert.equal(loud.calls.length, 1);
  const text = JSON.stringify(loud.calls[0]?.messages ?? []);
  assert.match(
    text,
    /carry about \d+% of the frame/,
    'the call that was bought did not mention the thin card',
  );
});
