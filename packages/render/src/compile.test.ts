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
import { parseStoryboard, sceneLength, sceneOffsets, totalDuration } from '@inkcast/core';
import { compilePlan, cueFraction, sceneDuration } from './compile.js';
import { fixtureStoryboard, lessonStoryboard } from './fixture.js';
import { layoutDiagram } from './layout.js';
import { paletteFor } from './palette.js';
import { Rng, seedOf, sketchRect } from './sketch.js';
import type { DiagramElement, Scene } from '@inkcast/core';
import type { GeomPrim, SvgPrim, TextPrim } from './types.js';

const DIR = '/tmp/inkcast-compile-test';

/**
 * The brand plate's item id.
 *
 * Named here because it is the one item in a plan that no element asked for, so every
 * test that enumerates a whole board has to say what it does about it rather than
 * quietly matching a length. `~` is the same separator a plot's phases use — element
 * ids are slugs from every author we have (`planner/src/compile.ts` `eid`, the LLM
 * schema's "stable slug"), so it keeps the plate out of their namespace.
 */
const PLATE = 'inkcast~brand';

/** Everything an element actually asked for, with the outro's watermark removed. */
function authored<T extends { id: string }>(items: readonly T[]): T[] {
  return items.filter((i) => i.id !== PLATE);
}

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
  const items = compilePlan(sb, DIR).items;
  assert.deepEqual(
    authored(items).map((i) => i.id),
    ['below', 'first', 'second', 'above'],
  );
  // The brand plate is appended after the sort, not sorted into it, and that is a
  // decision rather than an accident: a watermark has to paint over the board it signs,
  // and `z` is authored per element, so any beat that raised its own `z` would otherwise
  // draw over the mark. Last in the array is last in the DOM is on top.
  assert.equal(items[items.length - 1]?.id, PLATE);
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

test('a hold is deliberate silence the visual stays up through', () => {
  const sb = parseStoryboard({
    version: 1,
    title: 'holds',
    meta: { outroSec: 1 },
    scenes: [
      {
        id: 'ask',
        narration: 'so which way do you step?',
        durationSec: 2,
        // A question needs a pause afterwards, so the learner can try to answer.
        hold: 1.5,
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'q',
            type: 'text',
            text: 'which way?',
            persist: false,
            at: { x: 0, y: 0, w: 400, h: 100 },
            enter: { at: 0.5, duration: 0.4, style: 'write' },
          },
        ],
      },
      { id: 'next', narration: 'downhill.', durationSec: 1, camera: { x: 0, y: 0 } },
    ],
  });
  const plan = compilePlan(sb, DIR);

  // Core owns the arithmetic: scene length is narration + hold, and the offsets
  // follow from it. The renderer must not recompute either.
  assert.deepEqual(sceneOffsets(sb), [0, 3.5]);
  assert.equal(sceneLength(sb.scenes[0] as Scene), 3.5);
  assert.equal(plan.scenes[0]?.dur, 3.5);
  assert.equal(plan.scenes[0]?.speech, 2);
  assert.equal(plan.scenes[0]?.hold, 1.5);
  assert.equal(plan.scenes[1]?.start, 3.5);
  assert.equal(plan.duration, totalDuration(sb));
  assert.equal(plan.duration, 3.5 + 1 + 1);

  const q = plan.items.find((i) => i.id === 'q');
  assert.ok(q);
  // `enter.at` is a fraction of the *narration*, not of narration plus silence —
  // otherwise every cue in a scene with a hold drifts late by the length of the hold.
  assert.equal(q.start, 1, '0.5 of a 2s narration');
  // ...and the visual survives the silence, fading only at the very end of it.
  assert.equal(q.sceneEnd, 3.5);
});

test('a card held across beats goes out with the beat that still needs it', () => {
  // The wipe schedule has one case it cannot honour — an anchor whose hold is shorter
  // than the fade would be, where fading from the last word finishes after the next
  // card has cut in. It used to answer that with `undefined`, which is not "no
  // schedule": it is `sceneEnd`, and `sceneEnd` is the item's *own* scene. So the one
  // element that needs `persistUntil` most, the drawing a later beat morphs, was the
  // one whose fade fell back to leaving with the beat that drew it — and the morph
  // then bent a shape already at alpha 0. Unreachable on the shipped lessons, whose
  // holds are 0.65s and up against a 0.55s maximum fade, so nothing else can see it.
  const sb = parseStoryboard({
    version: 1,
    title: 'a card two beats draw',
    meta: { board: 'wipe', outroSec: 0.2 },
    scenes: [
      {
        id: 's0',
        narration: 'You are walking downhill in fog.',
        durationSec: 2,
        hold: 0.9,
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'hill',
            type: 'shape',
            shape: 'ellipse',
            persist: false,
            // The anchor still needs it: it is the shape scene 1 reshapes.
            persistUntil: 's1',
            at: { x: 0, y: 0, w: 400, h: 200 },
            enter: { at: 0, duration: 0.3, style: 'draw' },
          },
        ],
      },
      {
        id: 's1',
        narration: 'The hill is a curve.',
        durationSec: 2,
        // 0.15s of silence against a 0.2s fade: too short to fade inside, which is the
        // branch under test.
        hold: 0.15,
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'curve',
            type: 'shape',
            shape: 'rect',
            persist: false,
            at: { x: 0, y: 0, w: 400, h: 200 },
            enter: { at: 0, duration: 0.3, style: 'draw' },
            morph: { fromId: 'hill', from: 0.12, to: 0.62, easing: 'ease', retire: true },
          },
        ],
      },
    ],
  });
  const plan = compilePlan(sb, DIR);
  const hill = plan.items.find((i) => i.id === 'hill');
  const curve = plan.items.find((i) => i.id === 'curve');
  assert.ok(hill && curve);

  const anchorEnd = (plan.scenes[1]?.start ?? 0) + (plan.scenes[1]?.dur ?? 0);
  assert.equal(hill.sceneEnd, 2.9, 'its own scene ends at 2.9s');
  assert.equal(hill.fadeAt, anchorEnd, 'and it leaves with the scene that names it');
  assert.ok(hill.fadeAt > curve.start + curve.dur, 'so the morph has something to bend');

  // The control, and the reason `fadeAt` stays absent where it would say nothing: an
  // element on the same short-held scene that no later beat needs already fades at
  // `sceneEnd`, which is that same number.
  assert.equal(curve.fadeAt, undefined);
  assert.equal(curve.sceneEnd, anchorEnd);
});

test('an enter cue lands on the word that names it', () => {
  const words = [
    { word: 'That', start: 0, end: 0.2 },
    { word: 'hillside', start: 0.2, end: 0.5 },
    { word: 'is', start: 0.5, end: 0.6 },
    { word: 'the', start: 0.6, end: 0.7 },
    { word: 'loss', start: 0.7, end: 1 },
    { word: 'curve.', start: 1, end: 1.4 },
  ];
  assert.equal(cueFraction('loss curve', words, 2), 0.35, 'the phrase starts at 0.7s of 2s');
  assert.equal(cueFraction('Hillside', words, 2), 0.1, 'case and punctuation are ignored');
  assert.equal(cueFraction('the loss curve', words, 2), 0.3);
  assert.equal(cueFraction('never said', words, 2), null);
  assert.equal(cueFraction('loss curve', [], 2), null);

  // End to end: the lesson fixture's plot carries a cue and no fraction, so its
  // frame must be drawn on the words "loss curve", not at the start of the beat.
  const sb = lessonStoryboard();
  const plan = compilePlan(sb, DIR);
  const scene = plan.scenes[2];
  const frame = plan.items.find((i) => i.id === 'loss');
  assert.ok(scene && frame);
  assert.ok(Math.abs(frame.start - (scene.start + 0.74)) < 1e-9, `landed at ${frame.start}`);

  // Without word timings the cue cannot be resolved, so `enter.at` still stands.
  const blind = parseStoryboard({
    ...sb,
    scenes: sb.scenes.map((s) => {
      const { words: _drop, ...rest } = s;
      return rest;
    }),
  });
  const fallback = compilePlan(blind, DIR).items.find((i) => i.id === 'loss');
  assert.equal(fallback?.start, compilePlan(blind, DIR).scenes[2]?.start);
});

test('an unresolvable cue only warns when there was no audio to resolve against', () => {
  // The voice stage resolves cues and writes `enter.at`; a cue on the opening
  // words of a beat resolves to exactly 0, which is indistinguishable from
  // "never set". The compiler therefore re-resolves, and its matcher is stricter
  // about contractions than the voice stage's — so it used to warn "run the voice
  // stage so cues resolve" one line after the voice stage reported placing that
  // very cue word-exactly. Word timings on the scene are the proof that it ran.
  const base = lessonStoryboard();
  const withCue = parseStoryboard({
    ...base,
    scenes: base.scenes.map((s, i) =>
      i === 0
        ? {
            ...s,
            words: [
              { word: 'You', start: 0, end: 0.3 },
              { word: 'are', start: 0.3, end: 0.6 },
            ],
            elements: s.elements.map((el) =>
              el.id === 'hill' ? { ...el, enter: { ...el.enter, cue: "Here's the idea" } } : el,
            ),
          }
        : s,
    ),
  });

  const warnings = capture(() => compilePlan(withCue, DIR));
  assert.ok(
    !warnings.includes('could not be placed on a word'),
    `warned despite measured audio: ${warnings}`,
  );
  // The fallback is still `enter.at`, so the visual keeps its timing either way.
  const plan = compilePlan(withCue, DIR);
  assert.equal(plan.items.find((i) => i.id === 'hill')?.start, plan.scenes[0]?.start);

  // With no word timings the advice is correct, so the warning must survive.
  const blind = parseStoryboard({
    ...withCue,
    scenes: withCue.scenes.map((s) => {
      const { words: _drop, ...rest } = s;
      return rest;
    }),
  });
  assert.ok(
    capture(() => compilePlan(blind, DIR)).includes('could not be placed on a word'),
    'a cue with nothing to resolve against must still be reported',
  );
});

/** Everything written to stderr while `fn` runs — the logger's warn channel. */
function capture(fn: () => unknown): string {
  const original = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stderr.write = ((chunk: unknown) => {
    out += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return out;
}

test('the plan records how much of the frame carries ink', () => {
  const plan = compilePlan(lessonStoryboard(), DIR);
  assert.equal(plan.fill.length, plan.scenes.length);
  assert.ok(plan.fill.every((v) => v >= 0 && v <= 1));
  assert.equal(plan.aspect, '16:9');
  assert.equal(plan.typeScale, plan.scale, '16:9 needs no type gain');
  assert.ok(plan.safe.left > 0 && plan.safe.bottom > 0);
});

test('an equation with no typeset geometry falls back to its TeX as text', () => {
  // `DIR` has no `visuals.json`, so this is the real degradation path: a project whose
  // visuals stage has not run. Drawing nothing where the worked example belongs is the
  // one outcome that is not allowed, so the source goes up as handwriting instead.
  const sb = parseStoryboard({
    version: 1,
    title: 'eq fallback',
    scenes: [
      {
        id: 's0',
        narration: 'three minus a tenth of four is two point six',
        camera: { x: 960, y: 540 },
        elements: [
          {
            id: 'sum',
            type: 'equation',
            tex: 'w \\leftarrow 3 - 0.1 \\times 4 = 2.6',
            at: { x: 460, y: 420, w: 1000, h: 200 },
          },
        ],
      },
    ],
  });
  let plan!: ReturnType<typeof compilePlan>;
  const warned = capture(() => {
    plan = compilePlan(sb, DIR);
  });
  const prims = authored(plan.items).flatMap((i) => i.prims);
  assert.equal(prims.length, 1, 'expected exactly one fallback prim');
  const prim = prims[0] as TextPrim;
  assert.equal(prim.kind, 'text');
  assert.equal(prim.text, 'w \\leftarrow 3 - 0.1 \\times 4 = 2.6');
  assert.match(warned, /no typeset geometry/, 'the fallback must say why it happened');

  // The same board under the strict gate: raw TeX in the handwriting font is the D1
  // defect, so the compile stops and names the equation instead of shipping it.
  assert.throws(
    () => compilePlan(sb, DIR, { gates: 'strict' }),
    /no typeset geometry.*strict quality gate/s,
  );
});

test('a listing with no set geometry stops the strict compile', () => {
  // The code lane's half of the same rule (plan item 6.2), and it is the sharper one: an
  // equation drawn as raw TeX is bad notation, while a listing drawn as handwriting has
  // lost its *indentation*, which is the block structure of the program. `DIR` has no
  // `visuals.json`, so this is the real degradation path — a project whose visuals stage
  // has not run, or a listing that would not set.
  const sb = parseStoryboard({
    version: 1,
    title: 'code fallback',
    scenes: [
      {
        id: 's0',
        narration: 'the remainder lands you on one slot',
        camera: { x: 960, y: 540 },
        elements: [
          {
            id: 'lookup',
            type: 'code',
            lang: 'python',
            code: 'def get(self, key):\n    return self.slots[hash(key) % 8]',
            at: { x: 460, y: 420, w: 1000, h: 200 },
          },
        ],
      },
    ],
  });
  let plan!: ReturnType<typeof compilePlan>;
  const warned = capture(() => {
    plan = compilePlan(sb, DIR);
  });
  const prims = authored(plan.items).flatMap((i) => i.prims);
  assert.equal(prims.length, 1, 'expected exactly one fallback prim');
  const prim = prims[0] as TextPrim;
  assert.equal(prim.kind, 'text');
  assert.match(prim.text, /^def get\(self, key\):/, 'the source goes up, not a placeholder');
  assert.match(warned, /has no set geometry/, 'the fallback must say why it happened');

  assert.throws(
    () => compilePlan(sb, DIR, { gates: 'strict' }),
    /has no set geometry.*strict quality gate/s,
  );
});

/* ------------------------------------------------- A6: the professional-at-a-glance layer */

/**
 * Every coordinate pair in a path `d`, in order.
 *
 * The sketch primitives emit `M x y C x y x y x y ...` and nothing else, so pulling
 * the numbers out pairwise and reading the first and last pair is enough to answer
 * the only questions these tests ask of a stroke: where did the hand start, where did
 * it stop, and did it stay level on the way. Parsing rather than string-matching
 * because the roughening is seeded — the digits change whenever a seed does, and a
 * test that pinned them would fail for a reason that has nothing to do with A6.
 */
function pointsOf(d: string): [number, number][] {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] as number, nums[i + 1] as number]);
  return out;
}

/**
 * A one-scene board with a heading and the level accent rule under it.
 *
 * The rule is authored exactly as `planner/src/compile.ts` `titleRule` authors it —
 * a two-point accent path, level, no wider than the heading's box and centred on it —
 * because `titleRules` matches on that geometry rather than on an id, and a fixture
 * that cheated by naming the element `..._rule` would pass while the shipped planner
 * output failed.
 */
function signedBoard(outroSec: number, extra: unknown[] = [], role = 'heading') {
  return parseStoryboard({
    version: 1,
    title: 'signed board',
    meta: { fps: 30, outroSec, style: 'marker', palette: 'color' },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's0',
        narration: 'a patch of cells at the top fires',
        durationSec: 2,
        camera: { x: 960, y: 540 },
        elements: [
          {
            id: 'head',
            type: 'text',
            text: 'A patch of cells at the top fires',
            role,
            at: { x: 200, y: 100, w: 900, h: 80 },
          },
          {
            id: 'rule',
            type: 'path',
            tone: 'accent',
            points: [
              { x: 200, y: 200 },
              { x: 1100, y: 200 },
            ],
            at: { x: 200, y: 196, w: 900, h: 8 },
          },
          ...extra,
        ],
      },
    ],
  });
}

test('the outro is signed, and only when there is outro enough to sign it', () => {
  // A6 was written, tested at the primitive level, and never called — `sketchBrandMark`
  // and `BRAND_MARK` sat in `sketch.ts` with zero call sites while a rendered outro frame
  // carried no plate at all. So this test is deliberately about the *wiring*, not the
  // geometry: that `compilePlan` emits the item, inside the window A6 specifies, on a
  // board that asked for nothing. `sketch.test.ts` owns whether the mark is shaped right.
  assert.equal(
    compilePlan(signedBoard(0.4), DIR).items.find((i) => i.id === PLATE),
    undefined,
    'a 0.4s outro is too short to sign — the mark would land on the last spoken word',
  );

  const plan = compilePlan(signedBoard(1.6), DIR);
  const plate = plan.items.find((i) => i.id === PLATE);
  assert.ok(plate, 'a 1.6s outro must carry the brand plate');
  assert.ok(
    plate.start >= plan.duration - 1.2 - 1e-6,
    `plate starts at ${plate.start}s of ${plan.duration}s — A6 gives it the last 1.2s only`,
  );
  // Finished strictly before the end, which is the whole point of drawing for less time
  // than the window lasts: the frame a viewer screenshots is the last one, and a mark
  // still being drawn on it is not a watermark.
  assert.ok(
    plate.start + plate.dur < plan.duration,
    `plate is still being drawn at the final frame (${plate.start}+${plate.dur} vs ${plan.duration})`,
  );
  assert.equal(plate.persist, true, 'the board ends with the mark, so it never fades');
  // Four tile edges, the cast stroke, and the nib — the nib filled, because a closed
  // filled path is what lets the runtime ramp it in as ink instead of switching it on.
  assert.ok(plate.prims.length >= 6, `expected tile + cast + nib, got ${plate.prims.length} prims`);
  const filled = plate.prims.filter((p) => (p as GeomPrim).fill !== 'none');
  assert.equal(filled.length, 1, 'exactly one filled prim: the nib');
});

test('the brand plate goes to the emptiest corner of the last frame', () => {
  // Stated as a rule rather than a fixed corner because a fixed corner is how a
  // watermark ends up on top of a recap. Only ink that is still up can collide, so the
  // blocker has to persist — a faded element is not in the way of anything.
  // The canvas is 1920×1080 and the camera holds all of it at zoom 1, so the canvas
  // midpoint is the frame midpoint and a `center` tuple names its own quadrant.
  const cornerOf = (item: { center: [number, number] }) =>
    `${item.center[1] > 540 ? 'bottom' : 'top'}-${item.center[0] > 960 ? 'right' : 'left'}`;

  const empty = compilePlan(signedBoard(1.6), DIR).items.find((i) => i.id === PLATE);
  assert.ok(empty);
  assert.equal(cornerOf(empty), 'bottom-right', 'four empty corners tie toward the signature');

  const blocked = compilePlan(
    signedBoard(1.6, [
      {
        id: 'recap',
        type: 'shape',
        shape: 'rect',
        persist: true,
        at: { x: 1200, y: 700, w: 600, h: 300 },
      },
    ]),
    DIR,
  ).items.find((i) => i.id === PLATE);
  assert.ok(blocked);
  assert.notEqual(
    cornerOf(blocked),
    'bottom-right',
    'held ink in the bottom-right must push the mark out of it',
  );
});

test("a heading's accent rule is drawn as an underline, not as a level rule", () => {
  // This replaces a treatment rather than adding one. The failure mode it guards is
  // two rules on the board — the generic two-point branch drawing its level stroke and
  // the underline drawing a second one over it — so the assertion is on the *only*
  // stroke the element produces, and its identity is checked by shape.
  const ruleOf = (sb: ReturnType<typeof signedBoard>) => {
    const item = compilePlan(sb, DIR).items.find((i) => i.id === 'rule');
    assert.ok(item, 'the accent rule must still be an item');
    assert.equal(item.prims.length, 1, 'one gesture, one stroke — never a rule plus an underline');
    return pointsOf((item.prims[0] as GeomPrim).d);
  };

  const pts = ruleOf(signedBoard(1.6));
  const first = pts[0] as [number, number];
  const last = pts[pts.length - 1] as [number, number];
  // Overshoot: the hand runs past the last letter. 0.22 of a 62-unit heading is ~13
  // canvas units, well clear of the roughening's own jitter.
  assert.ok(
    last[0] > 1100 + 5,
    `underline must run past the words (ends at x=${last[0]}, words end at 1100)`,
  );
  // Lift: the right end sits higher than the left. This is the assertion that a level
  // `sketchAlong` stroke cannot pass, and so it is the one that proves which primitive ran.
  assert.ok(
    first[1] - last[1] > 4,
    `underline must lift to the right (left y=${first[1]}, right y=${last[1]})`,
  );

  // The same path under a body line is not a title rule and keeps today's treatment.
  // `titleRules` matches on geometry, so this is what stops it claiming every level
  // accent stroke on the board — a plot's baseline, a timeline's axis.
  const plain = ruleOf(signedBoard(1.6, [], 'body'));
  const plainFirst = plain[0] as [number, number];
  const plainLast = plain[plain.length - 1] as [number, number];
  assert.ok(
    Math.abs(plainFirst[1] - plainLast[1]) < 4,
    `a non-heading rule must stay level (${plainFirst[1]} vs ${plainLast[1]})`,
  );
});
