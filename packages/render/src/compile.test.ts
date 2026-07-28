/**
 * Compiler-level tests: no browser, no ffmpeg. These cover the parts of
 * determinism that live in Node — seeded geometry and the fraction-to-seconds
 * timing maths.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStoryboard } from '@inkcast/core';
import { compilePlan, sceneDuration } from './compile.js';
import { fixtureStoryboard } from './fixture.js';
import { layoutDiagram } from './layout.js';
import { paletteFor } from './palette.js';
import { Rng, seedOf, sketchRect } from './sketch.js';
import type { DiagramElement } from '@inkcast/core';
import type { GeomPrim, SvgPrim, TextPrim } from './types.js';

const DIR = '/tmp/inkcast-compile-test';

test('the same storyboard compiles to a byte-identical plan', () => {
  const sb = fixtureStoryboard();
  const a = JSON.stringify(compilePlan(sb, DIR));
  const b = JSON.stringify(compilePlan(sb, DIR));
  assert.equal(a, b);
  assert.ok(a.length > 5000, 'plan should contain real geometry');
});

test('seeded sketch geometry repeats and is seed-sensitive', () => {
  const st = { roughness: 1.1, bowing: 1, passes: 2, scale: 1 };
  const box = { x: 0, y: 0, w: 200, h: 120 };
  const one = sketchRect(new Rng(seedOf('box')), st, box).join('|');
  const two = sketchRect(new Rng(seedOf('box')), st, box).join('|');
  const other = sketchRect(new Rng(seedOf('box2')), st, box).join('|');
  assert.equal(one, two);
  assert.notEqual(one, other);
  assert.equal(one.split('|').length, 8, 'four edges, two passes each');
});

test('scene timings become absolute seconds and include the outro', () => {
  const sb = fixtureStoryboard();
  const plan = compilePlan(sb, DIR);
  assert.equal(plan.scenes.length, 2);
  assert.equal(plan.scenes[0]?.start, 0);
  assert.equal(plan.scenes[0]?.dur, 0.8);
  assert.equal(plan.scenes[1]?.start, 0.8);
  assert.equal(plan.duration, 0.8 + 0.8 + 0.4);
  assert.equal(plan.fps, 30);
  assert.deepEqual(plan.frame, { w: 1920, h: 1080 });
});

test('enter.at is a fraction of its own scene, clamped inside it', () => {
  const sb = fixtureStoryboard();
  const plan = compilePlan(sb, DIR);
  const byId = new Map(plan.items.map((i) => [i.id, i]));

  const title = byId.get('title');
  assert.ok(title);
  assert.equal(title.start, 0);
  assert.equal(title.dur, 0.45);

  // at: 0.55 of an 0.8s scene.
  const link = byId.get('link');
  assert.ok(link);
  assert.ok(Math.abs(link.start - 0.44) < 1e-9);
  // 0.3s would run 0.06s past the end of the scene, so it is clamped to fit.
  assert.ok(link.dur <= 0.8 - link.start + 1e-9);

  // Scene 2 elements are offset by scene 1's measured duration.
  const note = byId.get('note');
  assert.ok(note);
  assert.equal(note.start, 0.8);
  assert.equal(note.sceneEnd, 1.6);
  assert.equal(note.persist, false);
});

test('items are ordered by explicit z, then declaration order', () => {
  const sb = parseStoryboard({
    version: 1,
    title: 'z',
    scenes: [
      {
        id: 's',
        narration: 'a',
        durationSec: 1,
        camera: { x: 0, y: 0 },
        elements: [
          { id: 'first', type: 'text', text: 'one', at: { x: 0, y: 0, w: 100, h: 40 } },
          { id: 'below', type: 'text', text: 'two', z: -2, at: { x: 0, y: 0, w: 100, h: 40 } },
          { id: 'above', type: 'text', text: 'three', z: 5, at: { x: 0, y: 0, w: 100, h: 40 } },
          { id: 'second', type: 'text', text: 'four', at: { x: 0, y: 0, w: 100, h: 40 } },
        ],
      },
    ],
  });
  assert.deepEqual(
    compilePlan(sb, DIR).items.map((i) => i.id),
    ['below', 'first', 'second', 'above'],
  );
});

test('emphasis effects resolve against their target, and survive a bad target', () => {
  const sb = fixtureStoryboard();
  const plan = compilePlan(sb, DIR);
  const mark = plan.items.find((i) => i.id === 'mark');
  assert.ok(mark);
  assert.ok(mark.prims.length >= 2, 'circle emphasis draws around the target');
  // Drawn around `title` (canvas x 180..1120), not around its own box.
  const d = (mark.prims[0] as GeomPrim).d;
  assert.match(d, /^M/);

  const beat = plan.items.find((i) => i.id === 'beat');
  assert.equal(beat?.pulseTarget, 'flow');
  assert.equal(beat?.prims.length, 0, 'pulse draws nothing of its own');

  const broken = parseStoryboard({
    version: 1,
    title: 'broken',
    scenes: [
      {
        id: 's',
        narration: 'a',
        durationSec: 1,
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'e',
            type: 'emphasis',
            targetId: 'nope',
            effect: 'circle',
            at: { x: 0, y: 0, w: 10, h: 10 },
          },
        ],
      },
    ],
  });
  assert.equal(compilePlan(broken, DIR).items[0]?.prims.length, 0);
});

test('text roles map onto the type scale and shrink to fit', () => {
  const sb = fixtureStoryboard();
  const plan = compilePlan(sb, DIR);
  const title = plan.items.find((i) => i.id === 'title');
  const note = plan.items.find((i) => i.id === 'note');
  const titleSize = (title?.prims[0] as TextPrim).size;
  const noteSize = (note?.prims[0] as TextPrim).size;
  // The type scale is quoted in output *pixels*, so it converts through the
  // camera, not the canvas: 2400×1350 into a 1920×1080 frame is 0.8 px/unit
  // before zoom, the two scenes zoom 1.5 and 1.8 (median 1.65), so a canvas unit
  // is 1.32 px and the multiplier is 1/1.32. A 96 px title therefore lands as
  // ~72.7 canvas units — which is what fits the 150-unit box the author drew.
  const expected = 1 / (0.8 * 1.65);
  assert.equal(plan.scale, expected);
  assert.equal(titleSize, 96 * expected);
  assert.equal(noteSize, 42 * expected);
  assert.equal((title?.prims[0] as TextPrim).shrink, true);
});

test('the unit scale follows the camera, not the canvas size', () => {
  // A big canvas toured region by region must not inflate the ink: the planner
  // emits a 9440-wide canvas for 24 scenes and then zooms ~5.4x into each one,
  // so a canvas unit stays ~1 px. Reading the multiplier off the canvas made it
  // ~4.9 and every title six times too tall for its box.
  const wide = parseStoryboard({
    version: 1,
    title: 'toured',
    canvas: { x: 0, y: 0, w: 9440, h: 5940 },
    scenes: [
      { id: 'a', narration: 'one', durationSec: 1, camera: { x: 1040, y: 690, zoom: 5.4253 } },
      { id: 'b', narration: 'two', durationSec: 1, camera: { x: 2880, y: 690, zoom: 5.4253 } },
    ],
  });
  const scale = compilePlan(wide, DIR).scale;
  assert.ok(scale > 0.9 && scale < 1.15, `expected ~1 canvas unit per pixel, got ${scale}`);
});

test('missing durationSec falls back to a narration estimate', () => {
  const short = { id: 'x', narration: 'Two words.', camera: { x: 0, y: 0 }, elements: [] };
  const long = {
    id: 'y',
    narration: new Array(40).fill('word').join(' '),
    camera: { x: 0, y: 0 },
    elements: [],
  };
  const sb = parseStoryboard({ version: 1, title: 't', scenes: [short, long] });
  const s0 = sb.scenes[0];
  const s1 = sb.scenes[1];
  assert.ok(s0 && s1);
  assert.equal(sceneDuration(s0), 1.8, 'a floor keeps very short beats watchable');
  assert.ok(sceneDuration(s1) > 15);
  const plan = compilePlan(sb, DIR);
  assert.equal(plan.scenes[1]?.start, sceneDuration(s0));
});

test('diagram layout fills its box and routes every edge', () => {
  const el = {
    id: 'd',
    type: 'diagram' as const,
    layout: 'flow' as const,
    nodes: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'b' },
    ],
    at: { x: 100, y: 200, w: 800, h: 400 },
    enter: { at: 0, duration: 0.8, style: 'draw' as const },
    persist: true,
  } satisfies DiagramElement;

  const laid = layoutDiagram(el);
  assert.equal(laid.nodes.length, 4);
  assert.equal(laid.edges.length, 4, 'the cycle d->b is still drawn');
  for (const nd of laid.nodes) {
    assert.ok(nd.box.x >= el.at.x - 1e-6, `${nd.id} inside the box on x`);
    assert.ok(nd.box.x + nd.box.w <= el.at.x + el.at.w + 1e-6);
    assert.ok(nd.box.y >= el.at.y - 1e-6, `${nd.id} inside the box on y`);
    assert.ok(nd.box.y + nd.box.h <= el.at.y + el.at.h + 1e-6);
    assert.ok(nd.box.w > 0 && nd.box.h > 0);
  }
  // a -> b -> c -> d ranks left to right.
  const xs = laid.nodes.map((nd) => nd.box.x);
  assert.deepEqual(
    [...xs].sort((p, q) => p - q),
    xs,
  );
  for (const e of laid.edges) assert.equal(e.points.length, 3);

  const empty = layoutDiagram({ ...el, nodes: [], edges: [] });
  assert.deepEqual(empty, { nodes: [], edges: [] });

  // An edgeless flow is a row of peers, not one node per row.
  const peers = layoutDiagram({ ...el, edges: [] });
  const peerXs = peers.nodes.map((nd) => nd.box.x);
  assert.equal(new Set(peerXs).size, 4, 'edgeless flow spreads along x');
});

test('an asset resolves from inline markup or from a project-relative file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inkcast-asset-'));
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor"><circle cx="12" cy="12" r="9"/></svg>';
  writeFileSync(path.join(dir, 'assets', 'ring.svg'), markup);

  const build = (svg: string) =>
    parseStoryboard({
      version: 1,
      title: 'asset',
      canvas: { x: 0, y: 0, w: 1920, h: 1080 },
      assets: [{ id: 'ring', kind: 'icon', svg }],
      scenes: [
        {
          id: 'a',
          narration: 'one',
          durationSec: 1,
          camera: { x: 960, y: 540, zoom: 1 },
          elements: [
            { id: 'r', type: 'asset', assetId: 'ring', at: { x: 0, y: 0, w: 200, h: 200 } },
          ],
        },
      ],
    });

  for (const value of [markup, 'assets/ring.svg']) {
    const prims = compilePlan(build(value), dir).items[0]?.prims ?? [];
    // `@inkcast/visuals` writes the *path* here (the contract keeps project files
    // relative); the page can only parse markup. Both forms must reach the board —
    // treating a path as markup left `DOMParser` with nothing and drew no icon.
    assert.equal(prims.length, 1, `one svg prim for ${value.slice(0, 20)}`);
    assert.equal(prims[0]?.kind, 'svg');
    assert.ok((prims[0] as SvgPrim).svg.includes('<circle'));
  }

  // An unresolvable reference still leaves an honest labelled frame behind.
  const missing = compilePlan(build('assets/nope.svg'), dir).items[0]?.prims ?? [];
  assert.ok(missing.length > 1);
  assert.ok(missing.some((p) => p.kind === 'text'));
  rmSync(dir, { recursive: true, force: true });
});

test('a stack is a column, edges or no edges', () => {
  // The planner emits edgeless `stack` diagrams for bullet lists and the recap.
  // Ranking them put all five in a single *row* of a 400-unit-wide box, which
  // gave 60-unit nodes with labels spilling out of them.
  const el = {
    id: 'd',
    type: 'diagram' as const,
    layout: 'stack' as const,
    nodes: [
      { id: 'a', label: 'The loss surface' },
      { id: 'b', label: 'Which way is downhill' },
      { id: 'c', label: 'What can go wrong' },
    ],
    edges: [],
    at: { x: 100, y: 200, w: 400, h: 560 },
    enter: { at: 0, duration: 0.8, style: 'draw' as const },
    persist: true,
  } satisfies DiagramElement;

  const laid = layoutDiagram(el);
  assert.equal(laid.nodes.length, 3);
  const xs = new Set(laid.nodes.map((nd) => nd.box.x));
  assert.equal(xs.size, 1, 'every node shares one column');
  const ys = laid.nodes.map((nd) => nd.box.y);
  assert.deepEqual(
    [...ys].sort((p, q) => p - q),
    ys,
    'declaration order runs top to bottom',
  );
  for (const nd of laid.nodes) {
    assert.ok(nd.box.w > el.at.w * 0.9, 'a stacked node spans its box');
    assert.ok(nd.box.h > 100, `${nd.id} is tall enough to hold a label`);
    assert.ok(nd.box.y + nd.box.h <= el.at.y + el.at.h + 1e-6);
  }
});

test('one accent for the whole board, and none at all in mono', () => {
  const base = fixtureStoryboard();
  const strokes = (sb: ReturnType<typeof fixtureStoryboard>): Set<string> => {
    const plan = compilePlan(sb, DIR);
    const out = new Set<string>();
    for (const item of plan.items) {
      for (const prim of item.prims) if (prim.kind === 'geom') out.add(prim.stroke);
    }
    return out;
  };

  // Scene 1 and scene 2 both draw accented marks; they must be the same hue, and
  // nothing may introduce a colour that is not in the palette.
  const pal = paletteFor('color');
  const allowed = new Set([pal.ink, pal.inkSoft, pal.accent]);
  const colour = strokes(base);
  assert.ok(colour.has(pal.accent), 'the accent is used');
  for (const c of colour) assert.ok(allowed.has(c), `unexpected ink colour ${c}`);

  const mono = parseStoryboard({ ...base, meta: { ...base.meta, palette: 'mono' } });
  const monoSpot = compilePlan(mono, DIR).items.find((i) => i.id === 'spot');
  const monoColours = new Set(
    (monoSpot?.prims ?? []).filter((p): p is GeomPrim => p.kind === 'geom').map((p) => p.stroke),
  );
  assert.equal(monoColours.size, 1, 'mono draws the highlight in one ink');
});

test('grid can be switched off', () => {
  const sb = fixtureStoryboard();
  assert.ok(compilePlan(sb, DIR, { grid: true }).grid);
  assert.equal(compilePlan(sb, DIR, { grid: false }).grid, null);
});
