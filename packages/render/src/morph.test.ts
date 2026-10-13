/**
 * The morph: one drawn shape being reshaped into another.
 *
 * This exists for the single moment a lesson lives or dies on — the hillside the
 * learner accepted *becoming* the loss curve, rather than a second picture
 * appearing next to it while the narrator asserts they are the same thing.
 *
 * The properties worth pinning are geometric, not cosmetic: the first frame has to
 * be the source shape and the last the target, every point has to travel the short
 * way (which is what arc-length resampling buys), and the source's ink has to be
 * gone before the new shape settles or the result reads as a smudge.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard } from '@inkcast/core';
import { compilePlan } from './compile.js';
import { planWithVisuals } from './fixture.js';
import { flattenPathData } from './geom.js';
import type { Pt } from './geom.js';
import type { MorphTrack, PlanItem } from './types.js';

const DIR = '/tmp/inkcast-morph-test';

/** A descending hillside, high on the left. */
const HILL = Array.from({ length: 24 }, (_, i) => {
  const t = i / 23;
  return { x: 200 + t * 800, y: 300 + t * 400 };
});

function board(target: Record<string, unknown>): ReturnType<typeof parseStoryboard> {
  return parseStoryboard({
    version: 1,
    title: 'morph',
    meta: { fps: 30, outroSec: 0 },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's0',
        narration: 'you are standing on a hillside in the fog',
        durationSec: 4,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          {
            id: 'hill',
            type: 'path',
            points: HILL,
            at: { x: 190, y: 290, w: 820, h: 420 },
            enter: { at: 0, duration: 0.9, style: 'draw' },
            persist: true,
          },
        ],
      },
      {
        id: 's1',
        narration: 'that hillside is a graph of how wrong you are',
        durationSec: 4,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [target],
      },
    ],
  });
}

const PLOT = {
  id: 'loss',
  type: 'plot',
  at: { x: 190, y: 290, w: 820, h: 420 },
  xDomain: [-1, 5],
  yDomain: [0, 18],
  xLabel: 'where you stand',
  yLabel: 'loss',
  curves: [{ id: 'bowl', fn: { name: 'parabola', params: [1, 1, 0] } }],
  enter: { at: 0.1, duration: 0.9, style: 'draw' },
  morph: { fromId: 'hill', from: 0.1, to: 0.6 },
} as const;

async function planFor(target: Record<string, unknown> = { ...PLOT }): Promise<PlanItem[]> {
  return (await planWithVisuals(board(target))).items;
}

function morphOf(items: PlanItem[]): { item: PlanItem; track: MorphTrack } {
  const item = items.find((i) => i.morph !== undefined);
  assert.ok(item?.morph, 'something should carry a baked morph track');
  return { item, track: item.morph };
}

/** Endpoints of a roughened `d`, which is what identifies the shape it came from. */
function ends(d: string): { first: Pt; last: Pt } {
  const runs = flattenPathData(d);
  const pts = runs.flat();
  assert.ok(pts.length >= 2, `no geometry in ${d.slice(0, 60)}`);
  return { first: pts[0] as Pt, last: pts[pts.length - 1] as Pt };
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

/* ---------------------------------------------------------------- the basics */

test('a plot morphs out of the path it names', async () => {
  const { track } = morphOf(await planFor());
  assert.ok(track.frames.length > 1, 'a morph is more than one frame');
  assert.deepEqual(track.retire, ['hill'], 'the hillside is retired as the curve takes over');
  assert.ok(track.end > track.start);
});

test('the morph attaches to the curve, not the axes', async () => {
  // The axes are drawn *around* the reshaping curve, so they must keep their own
  // entry. Hanging the morph on the axes item would reshape the wrong ink and
  // leave the curve to blink on afterwards.
  const { item } = morphOf(await planFor());
  assert.equal(item.id, 'loss~curve-bowl', `morph landed on "${item.id}"`);
  const axes = (await planFor()).find((i) => i.id === 'loss');
  assert.ok(axes, 'the plot still has an axes item');
  assert.equal(axes.morph, undefined, 'the axes do not morph');
});

test('the first frame is the hillside and the last is the curve', async () => {
  const { track } = morphOf(await planFor());
  const first = ends(track.frames[0] as string);
  const last = ends(track.frames[track.frames.length - 1] as string);

  // The source descends left-to-right by 400 units over 800.
  assert.ok(
    near(first.first[0], HILL[0]!.x, 24) && near(first.first[1], HILL[0]!.y, 24),
    `first frame does not start on the hill: ${JSON.stringify(first.first)}`,
  );
  assert.ok(
    first.last[1] > first.first[1] + 200,
    'the first frame should still be descending like the hill',
  );

  // The target is a parabola with its minimum inside the domain, so it comes back
  // up: the last frame must end *higher* on the board than it dips.
  const lastFrameEndsUp = last.last[1] < first.last[1];
  assert.ok(
    lastFrameEndsUp,
    `the final frame should be the bowl, not the hill: ${JSON.stringify(last)}`,
  );
});

test('every frame is a drawable path', async () => {
  const { track } = morphOf(await planFor());
  for (let i = 0; i < track.frames.length; i++) {
    const d = track.frames[i] as string;
    assert.ok(d.length > 0, `frame ${i} is empty`);
    assert.ok(/^M/.test(d.trim()), `frame ${i} does not start with a moveto: ${d.slice(0, 40)}`);
    assert.ok(!/NaN|Infinity/.test(d), `frame ${i} has non-finite coordinates`);
  }
});

/* ------------------------------------------------------------------- motion */

test('points travel the short way, so the shape bends instead of sliding', async () => {
  // This is the arc-length resampling property. Matching source to target by index
  // pairs the dense end of one polyline with the sparse end of the other, and the
  // hill appears to slide sideways as it flattens. Evenly spaced points mean the
  // left end stays left: horizontal drift across the whole morph stays small
  // compared with the vertical reshaping that is the actual point.
  const { track } = morphOf(await planFor());
  const first = ends(track.frames[0] as string);
  const last = ends(track.frames[track.frames.length - 1] as string);
  const driftLeft = Math.abs(last.first[0] - first.first[0]);
  const reshape = Math.abs(last.last[1] - first.last[1]);
  assert.ok(
    driftLeft < reshape,
    `the shape slid (${driftLeft.toFixed(1)}) more than it bent (${reshape.toFixed(1)})`,
  );
});

test('the hand-drawn wobble is held steady across the morph', async () => {
  // One seed for the whole morph. Re-seeding per frame makes the stroke boil, which
  // a viewer reads as noise rather than as one line being bent — so consecutive
  // frames must differ by roughly the interpolation step, not by a fresh wobble.
  const { track } = morphOf(await planFor());
  const n = track.frames.length;
  assert.ok(n >= 6, `too few frames to compare: ${n}`);
  const a = ends(track.frames[2] as string);
  const b = ends(track.frames[3] as string);
  const step = Math.hypot(b.last[0] - a.last[0], b.last[1] - a.last[1]);
  const total = (() => {
    const f0 = ends(track.frames[0] as string);
    const fn = ends(track.frames[n - 1] as string);
    return Math.hypot(fn.last[0] - f0.last[0], fn.last[1] - f0.last[1]);
  })();
  // A boiling stroke would jump a large fraction of the whole travel every frame.
  assert.ok(
    step <= total * 0.5 + 8,
    `frame-to-frame jump of ${step.toFixed(1)} looks like reseeding`,
  );
});

/* -------------------------------------------------------------- the handoff */

test("the item's own ink takes over by fading where the morph ends", async () => {
  const { item, track } = morphOf(await planFor());
  // A dash-reveal here would re-draw the curve the viewer just watched bend into
  // place, stroke by stroke.
  assert.equal(item.style, 'fade');
  assert.ok(
    near(item.start, track.end, 1e-6),
    `own ink starts at ${item.start}, morph ends at ${track.end}`,
  );
  assert.ok(item.dur > 0 && item.dur < 0.5, `handoff should be short, got ${item.dur}`);
});

/* ------------------------------------------------------------ degrade safely */

test('a morph naming something absent is dropped, not fatal', async () => {
  // A hand-edited storyboard or an LLM patch can name an element that is not there.
  // Losing the transition is acceptable; failing the render is not.
  const items = await planFor({ ...PLOT, morph: { fromId: 'nope', from: 0.1, to: 0.6 } });
  assert.ok(items.length > 0, 'the plot still renders');
  assert.equal(
    items.find((i) => i.morph !== undefined),
    undefined,
    'no morph track is baked',
  );
});

test('a morph out of something with no geometry is dropped', async () => {
  const withText = parseStoryboard({
    version: 1,
    title: 'morph',
    meta: { fps: 30, outroSec: 0 },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's0',
        narration: 'a caption',
        durationSec: 3,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          {
            id: 'words',
            type: 'text',
            text: 'not a shape',
            at: { x: 200, y: 200, w: 400, h: 80 },
          },
        ],
      },
      {
        id: 's1',
        narration: 'now a graph',
        durationSec: 3,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [{ ...PLOT, morph: { fromId: 'words', from: 0.1, to: 0.6 } }],
      },
    ],
  });
  const items = (await planWithVisuals(withText)).items;
  assert.ok(
    items.some((i) => i.id === 'loss'),
    'the plot still renders',
  );
  assert.equal(
    items.find((i) => i.morph !== undefined),
    undefined,
  );
});

test('a path can morph into another path', async () => {
  // The plot case is the one the benchmark needs, but the capability is not
  // plot-specific: any two shapes with interpolable geometry can be bent together.
  const items = await planFor({
    id: 'bowl',
    type: 'path',
    points: Array.from({ length: 20 }, (_, i) => {
      const t = -1 + (2 * i) / 19;
      return { x: 200 + ((t + 1) / 2) * 800, y: 300 + (1 - t * t) * 400 };
    }),
    at: { x: 190, y: 290, w: 820, h: 420 },
    enter: { at: 0.1, duration: 0.9, style: 'draw' },
    morph: { fromId: 'hill', from: 0.1, to: 0.6 },
  });
  const { item, track } = morphOf(items);
  assert.equal(item.id, 'bowl');
  assert.ok(track.frames.length > 1);
});

test('a morph retires the whole drawing, not just the one stroke', async () => {
  // A hillside comes with fog across it and a figure standing on it. Left up, the
  // fog lies over the finished axes and the walker stands in mid-air where the slope
  // used to be — so the morph has to take its companions with it.
  const withCompanions = parseStoryboard({
    version: 1,
    title: 'morph',
    meta: { fps: 30, outroSec: 0 },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's0',
        narration: 'a hillside in fog',
        durationSec: 4,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          { id: 'hill', type: 'path', points: HILL, at: { x: 190, y: 290, w: 820, h: 420 } },
          {
            id: 'fog',
            type: 'path',
            points: [
              { x: 200, y: 360 },
              { x: 1000, y: 360 },
            ],
            at: { x: 200, y: 350, w: 800, h: 20 },
          },
        ],
      },
      {
        id: 's1',
        narration: 'that hillside is a graph',
        durationSec: 4,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [{ ...PLOT, morph: { fromId: 'hill', from: 0.1, to: 0.6, retires: ['fog'] } }],
      },
    ],
  });
  const items = (await planWithVisuals(withCompanions)).items;
  const { track } = morphOf(items);
  assert.deepEqual(track.retire, ['hill', 'fog']);
});
