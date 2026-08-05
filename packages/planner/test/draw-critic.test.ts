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

/** Still off the canvas, and now with two names written on top of each other. */
const WORSE: Mark[] = [
  mark({ id: 'body', kind: 'rect', x: 900, y: 100, w: 500, h: 300 }),
  mark({ id: 'name', kind: 'label', x: 1300, y: 250, text: 'the body', size: 30 }),
  mark({ id: 'other', kind: 'label', x: 1304, y: 252, text: 'the axis', size: 30 }),
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

const opts = (client: Client, extra: Record<string, unknown> = {}) => ({
  client,
  model: 'test-model',
  schema: { type: 'object' as const },
  instruction: 'a curve over an axis, with the axis named',
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

test('without a renderer it still corrects, from the measurements alone', async () => {
  // Weaker, and deliberately not fatal: a missing browser must never be the reason a
  // drawing goes out uncorrected.
  const { client, calls } = stub(CLEAN);
  const revision = await reviseDrawing(DIRTY, opts(client, { preview: async () => undefined }));
  assert.equal(revision?.kept, true);
  const content = calls[0]?.messages[0]?.content;
  assert.equal(typeof content, 'string', 'a text-only call should not carry content blocks');
  assert.match(String(content), /No render is available/);
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
  const content = calls[0]?.messages[0]?.content;
  assert.match(String(content), /NOTHING MEASURED WRONG/);
});
