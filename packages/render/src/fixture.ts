/**
 * Storyboards used by the tests.
 *
 * `fixtureStoryboard` is the original two-second board: one of every classic
 * element and enter style, authored cameras, no regions. `lessonStoryboard` is the
 * lesson-engine shape — regions that accumulate, holds, cues, a plot, a hand-drawn
 * path and a ball that rolls down it. `verticalStoryboard` is the same idea
 * composed for 9:16.
 *
 * Not exported from the package's public API — these are test fixtures, not
 * content.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseStoryboard } from '@inkcast/core';
import type { Storyboard } from '@inkcast/core';
import { resolveVisuals } from '@inkcast/visuals';
import { compilePlan } from './compile.js';

const RING_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M7 12h10"/></svg>';

export function fixtureStoryboard(overrides: { fps?: number } = {}): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'Render smoke test',
    meta: { fps: overrides.fps ?? 30, outroSec: 0.4, style: 'marker', palette: 'color' },
    canvas: { x: 0, y: 0, w: 2400, h: 1350 },
    assets: [{ id: 'ring', kind: 'icon', svg: RING_SVG, source: 'builtin' }],
    scenes: [
      {
        id: 's1',
        narration: 'Gradient descent walks downhill.',
        durationSec: 0.8,
        camera: { x: 700, y: 450, zoom: 1.5, transition: 0 },
        elements: [
          {
            id: 'title',
            type: 'text',
            text: 'Gradient descent',
            role: 'title',
            align: 'left',
            at: { x: 180, y: 140, w: 940, h: 150 },
            enter: { at: 0, duration: 0.45, style: 'write' },
          },
          {
            id: 'rule',
            type: 'shape',
            shape: 'underline',
            at: { x: 180, y: 280, w: 860, h: 8 },
            enter: { at: 0.3, duration: 0.25, style: 'draw' },
          },
          {
            id: 'flow',
            type: 'diagram',
            layout: 'flow',
            nodes: [
              { id: 'a', label: 'Loss' },
              { id: 'b', label: 'Gradient' },
              { id: 'c', label: 'Step' },
            ],
            edges: [
              { from: 'a', to: 'b', label: 'differentiate' },
              { from: 'b', to: 'c' },
            ],
            at: { x: 180, y: 380, w: 900, h: 420 },
            enter: { at: 0.35, duration: 0.4, style: 'draw' },
          },
          {
            id: 'ring',
            type: 'asset',
            assetId: 'ring',
            at: { x: 1240, y: 180, w: 220, h: 220 },
            enter: { at: 0.2, duration: 0.35, style: 'pop' },
          },
          {
            id: 'link',
            type: 'arrow',
            from: { x: 1100, y: 290 },
            to: { x: 1230, y: 290 },
            curve: 0.3,
            label: 'step',
            enter: { at: 0.55, duration: 0.3, style: 'draw' },
            at: { x: 1100, y: 240, w: 130, h: 100 },
          },
        ],
      },
      {
        id: 's2',
        narration: 'It follows the slope to the minimum.',
        durationSec: 0.8,
        camera: { x: 1700, y: 900, zoom: 1.8, transition: 0.5 },
        elements: [
          {
            id: 'note',
            type: 'text',
            text: 'follow the slope downhill, one small step at a time, until the gradient goes quiet',
            role: 'body',
            align: 'center',
            persist: false,
            at: { x: 1300, y: 760, w: 900, h: 220 },
            enter: { at: 0, duration: 0.4, style: 'fade' },
          },
          {
            id: 'spot',
            type: 'shape',
            shape: 'circle-highlight',
            fill: true,
            at: { x: 1420, y: 980, w: 360, h: 180 },
            enter: { at: 0.25, duration: 0.35, style: 'grow' },
          },
          {
            id: 'mark',
            type: 'emphasis',
            targetId: 'title',
            effect: 'circle',
            at: { x: 180, y: 140, w: 940, h: 150 },
            enter: { at: 0.4, duration: 0.35, style: 'draw' },
          },
          {
            id: 'beat',
            type: 'emphasis',
            targetId: 'flow',
            effect: 'pulse',
            at: { x: 180, y: 380, w: 900, h: 420 },
            enter: { at: 0.5, duration: 0.3, style: 'fade' },
          },
        ],
      },
    ],
  });
}

/**
 * A hillside, as canvas-unit waypoints: high on the left, flattening into a valley
 * on the right. Shared by the `path` that draws it and the `motion` that rolls a
 * ball down it, so the ball is provably on the ink rather than near it.
 */
export function hillPoints(): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = 180 + t * 1080;
    // A decaying slope: steep at the top, almost level at the bottom.
    const y = 420 + 520 * (1 - Math.pow(1 - t, 2.2));
    pts.push({ x: Math.round(x), y: Math.round(y) });
  }
  return pts;
}

/**
 * The lesson-engine storyboard: two accumulating regions and a recap.
 *
 * Scenes 1–2 share the `hill` region, so the camera must frame the union of both
 * beats rather than each in turn; scenes 3–4 share `loss`; scene 5 is a `recap`,
 * which must pull back over everything drawn. Scene 3 carries word timings and an
 * `enter.cue`, so cue resolution is exercised end to end.
 */
export function lessonStoryboard(overrides: { fps?: number } = {}): Storyboard {
  const hill = hillPoints();
  const roll = hill.slice(1, 10);
  return parseStoryboard({
    version: 1,
    title: 'Gradient descent (lesson fixture)',
    meta: { fps: overrides.fps ?? 30, outroSec: 0.4, style: 'marker', palette: 'color' },
    canvas: { x: 0, y: 0, w: 3200, h: 1800 },
    scenes: [
      {
        id: 'hook',
        role: 'hook',
        region: 'hill',
        narration: 'You are on a foggy hillside and you want to reach the valley.',
        durationSec: 1.2,
        hold: 0.3,
        camera: { x: 700, y: 700, zoom: 2, transition: 0 },
        elements: [
          {
            id: 'hill',
            type: 'path',
            points: hill,
            weight: 1.2,
            at: { x: 180, y: 420, w: 1080, h: 520 },
            enter: { at: 0, duration: 0.5, style: 'draw' },
          },
          {
            id: 'ask',
            type: 'text',
            text: 'Which way do you step?',
            role: 'heading',
            align: 'left',
            at: { x: 200, y: 200, w: 900, h: 130 },
            enter: { at: 0.5, duration: 0.4, style: 'write' },
          },
        ],
      },
      {
        id: 'anchor',
        role: 'anchor',
        region: 'hill',
        narration: 'You feel the ground, step downhill, and repeat.',
        durationSec: 1.0,
        hold: 0.2,
        camera: { x: 700, y: 700, zoom: 2, transition: 0.4 },
        elements: [
          {
            id: 'ball',
            type: 'shape',
            shape: 'ellipse',
            fill: true,
            at: { x: 240, y: 380, w: 78, h: 78 },
            motion: { path: roll, from: 0.15, to: 0.95, easing: 'ease', trail: true },
            enter: { at: 0, duration: 0.3, style: 'pop' },
          },
          {
            id: 'valley',
            type: 'text',
            text: 'downhill, one step at a time',
            role: 'label',
            align: 'center',
            at: { x: 640, y: 1020, w: 640, h: 90 },
            enter: { at: 0.6, duration: 0.35, style: 'fade' },
          },
        ],
      },
      {
        id: 'plot',
        role: 'step',
        region: 'loss',
        narration: 'That hillside is the loss curve for one weight.',
        durationSec: 1.6,
        hold: 0.2,
        camera: { x: 2300, y: 800, zoom: 2, transition: 0.6 },
        words: [
          { word: 'That', start: 0, end: 0.22 },
          { word: 'hillside', start: 0.22, end: 0.55 },
          { word: 'is', start: 0.55, end: 0.66 },
          { word: 'the', start: 0.66, end: 0.74 },
          { word: 'loss', start: 0.74, end: 1.0 },
          { word: 'curve', start: 1.0, end: 1.28 },
          { word: 'for', start: 1.28, end: 1.4 },
          { word: 'one', start: 1.4, end: 1.5 },
          { word: 'weight.', start: 1.5, end: 1.6 },
        ],
        elements: [
          {
            id: 'loss',
            type: 'plot',
            xDomain: [-3, 3],
            yDomain: [0, 10],
            xLabel: 'weight',
            yLabel: 'loss',
            axes: 'both',
            curves: [{ id: 'bowl', fn: { name: 'parabola', params: [1, 0, 0.5] }, accent: 0 }],
            overlays: [
              { kind: 'point', curveId: 'bowl', x: -2.4, label: 'here' },
              { kind: 'dropline', curveId: 'bowl', x: -2.4, to: 'both' },
            ],
            // No `at` fraction: the cue below must place it on the words "loss curve".
            at: { x: 1780, y: 320, w: 1240, h: 900 },
            enter: { cue: 'loss curve', duration: 0.35, style: 'draw' },
          },
        ],
      },
      {
        id: 'slope',
        role: 'step',
        region: 'loss',
        narration: 'The tangent tells you which way is downhill, so you step against it.',
        durationSec: 1.6,
        camera: { x: 2300, y: 800, zoom: 2, transition: 0.5 },
        elements: [
          {
            id: 'tan',
            // The same frame and curve as the beat before: the IR's way of saying
            // "annotate the plot already on the board". The compiler must ink the
            // frame and curve once and draw only the new overlays here.
            type: 'plot',
            xDomain: [-3, 3],
            yDomain: [0, 10],
            xLabel: 'weight',
            yLabel: 'loss',
            axes: 'both',
            curves: [{ id: 'bowl', fn: { name: 'parabola', params: [1, 0, 0.5] }, accent: 0 }],
            overlays: [
              { kind: 'tangent', curveId: 'bowl', x: -2.4, span: 1.1, label: 'slope', at: 0.25 },
              { kind: 'steps', curveId: 'bowl', xs: [-2.4, -1.6, -1, -0.6], at: 0.6 },
            ],
            at: { x: 1780, y: 320, w: 1240, h: 900 },
            enter: { at: 0, duration: 0.3, style: 'draw' },
          },
          {
            id: 'rule',
            type: 'text',
            text: 'step against the slope',
            role: 'label',
            align: 'center',
            at: { x: 1860, y: 1280, w: 1080, h: 90 },
            enter: { at: 0.8, duration: 0.3, style: 'fade' },
          },
        ],
      },
      {
        id: 'recap',
        role: 'recap',
        narration: 'Feel the slope, step downhill, repeat until it goes flat.',
        durationSec: 1.0,
        hold: 0.4,
        camera: { x: 1600, y: 900, zoom: 1, transition: 0.9 },
        elements: [
          {
            id: 'chain',
            type: 'text',
            text: 'slope -> step -> repeat',
            role: 'heading',
            align: 'center',
            at: { x: 900, y: 1500, w: 1400, h: 130 },
            enter: { at: 0.2, duration: 0.4, style: 'write' },
          },
        ],
      },
    ],
  });
}

/**
 * The same board, wiping: one card at a time, and the ink goes out with the words.
 *
 * Derived from `lessonStoryboard` rather than authored beside it so the two differ
 * in exactly the thing under test — the mode, the persistence and the holds — and a
 * geometry change cannot make a wipe assertion pass by accident.
 *
 * Three deliberate choices:
 *
 * - **Holds of 0.9s.** The wipe fade lands inside the silence rather than after it,
 *   so it needs a silence to land in. Compiled lessons hold 0.6–2.55s; the
 *   accumulate fixture holds 0–0.4s, which is below the 0.2–0.55s fade and would
 *   test the fallback instead of the feature.
 * - **`persistUntil` on the hook's hillside.** The next beat rolls a ball down that
 *   path. A card several beats draw together goes out with the last of them, and
 *   this is the fixture's instance of it.
 * - **A drawn recap, which then stays.** Under `wipe` there is no board behind the
 *   recap to pull back over, so it has to draw a summary or the film ends on a
 *   heading over nothing — and that closing card keeps `persist: true`, exactly as
 *   the compiler leaves it, because a wipe makes room for the next card and there is
 *   no next card. This is also what makes the fixture a mixed board rather than a
 *   uniform one: the renderer has to fade some items and hold others.
 */
export function wipeStoryboard(overrides: { fps?: number } = {}): Storyboard {
  const base = lessonStoryboard(overrides);
  // The hill is drawn by the hook and ridden by the anchor: one card, two beats.
  const heldUntil: Record<string, string> = { hill: 'anchor', ask: 'anchor', loss: 'slope' };
  const last = base.scenes.length - 1;
  const scenes = base.scenes.map((scene, i) => ({
    ...scene,
    hold: 0.9,
    elements: scene.elements.map((el) => ({
      ...el,
      persist: i === last,
      ...(heldUntil[el.id] ? { persistUntil: heldUntil[el.id] } : {}),
    })),
  }));
  const recap = scenes.at(-1);
  if (recap) {
    recap.elements = [
      ...recap.elements,
      {
        id: 'summary',
        type: 'diagram',
        layout: 'flow',
        nodes: [
          { id: 'a', label: 'slope' },
          { id: 'b', label: 'step' },
          { id: 'c', label: 'flat' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
        ],
        persist: true,
        at: { x: 900, y: 1140, w: 1400, h: 320 },
        enter: { at: 0, duration: 0.4, style: 'draw' },
      } as (typeof recap.elements)[number],
    ];
  }
  return parseStoryboard({ ...base, meta: { ...base.meta, board: 'wipe' }, scenes });
}

/**
 * The same lesson composed for 9:16: a tall canvas the camera walks down.
 *
 * Deliberately not a crop of the landscape board — the ink is stacked vertically,
 * each beat sits below the last, and the recap pulls back over the column.
 */
export function verticalStoryboard(overrides: { fps?: number } = {}): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'Gradient descent, vertical',
    meta: {
      fps: overrides.fps ?? 12,
      outroSec: 0.3,
      style: 'marker',
      palette: 'color',
      aspect: '9:16',
    },
    canvas: { x: 0, y: 0, w: 1080, h: 2600 },
    scenes: [
      {
        id: 'v-hook',
        role: 'hook',
        region: 'column',
        narration: 'You are walking downhill in fog.',
        durationSec: 0.9,
        hold: 0.2,
        camera: { x: 540, y: 700, zoom: 1.4, transition: 0 },
        elements: [
          {
            id: 'v-title',
            type: 'text',
            text: 'Which way is downhill?',
            role: 'heading',
            align: 'center',
            at: { x: 90, y: 150, w: 900, h: 300 },
            enter: { at: 0, duration: 0.4, style: 'write' },
          },
          {
            id: 'v-hill',
            type: 'path',
            points: [
              { x: 110, y: 640 },
              { x: 320, y: 720 },
              { x: 530, y: 880 },
              { x: 750, y: 1010 },
              { x: 970, y: 1060 },
            ],
            weight: 1.2,
            at: { x: 110, y: 640, w: 860, h: 420 },
            enter: { at: 0.4, duration: 0.4, style: 'draw' },
          },
          {
            id: 'v-fog',
            type: 'text',
            text: 'you cannot see the valley',
            role: 'label',
            align: 'center',
            at: { x: 90, y: 1160, w: 900, h: 170 },
            enter: { at: 0.75, duration: 0.3, style: 'fade' },
          },
        ],
      },
      {
        id: 'v-step',
        role: 'step',
        region: 'column',
        narration: 'The hill is a curve, and its slope points the way.',
        durationSec: 1.1,
        hold: 0.2,
        camera: { x: 540, y: 1800, zoom: 1.4, transition: 0.5 },
        elements: [
          {
            id: 'v-plot',
            type: 'plot',
            xDomain: [-3, 3],
            yDomain: [0, 10],
            yLabel: 'loss',
            xLabel: 'weight',
            curves: [{ id: 'bowl', fn: { name: 'parabola', params: [1, 0, 0.5] }, accent: 0 }],
            overlays: [
              { kind: 'point', curveId: 'bowl', x: -2.3, label: 'here' },
              { kind: 'tangent', curveId: 'bowl', x: -2.3, span: 1, at: 0.55 },
            ],
            at: { x: 100, y: 1420, w: 880, h: 900 },
            enter: { at: 0, duration: 0.35, style: 'draw' },
          },
        ],
      },
      {
        id: 'v-recap',
        role: 'recap',
        narration: 'Feel the slope. Step downhill. Repeat.',
        durationSec: 0.9,
        hold: 0.3,
        camera: { x: 540, y: 1300, zoom: 1, transition: 0.8 },
        elements: [
          {
            id: 'v-chain',
            type: 'text',
            text: 'slope -> step -> repeat',
            role: 'label',
            align: 'center',
            at: { x: 100, y: 2400, w: 880, h: 150 },
            enter: { at: 0.2, duration: 0.35, style: 'write' },
          },
        ],
      },
    ],
  });
}

/* --------------------------------------------------------------- the sidecar */

/**
 * Resolve a storyboard's visuals into a scratch directory, and hand back the path.
 *
 * Needed because the renderer no longer derives plot geometry — it reads what the
 * visuals stage recorded (see `visuals.ts`). A test that compiles a plan against an
 * empty directory therefore gets a labelled placeholder frame where a plot should be,
 * which is the *correct* degradation and useless for testing plots.
 *
 * That this helper has to exist is the point rather than an inconvenience: it makes
 * the stage dependency real in the tests instead of letting the renderer quietly
 * reconstruct what it should be consuming. The one test that genuinely wants the
 * degradation asserts on it directly.
 *
 * `images: 'off'` because no test may reach the network, and each call gets its own
 * directory so a cached sidecar can never make a later assertion pass.
 */
export async function withVisuals(sb: Storyboard): Promise<{ dir: string; sb: Storyboard }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-render-test-'));
  const resolved = await resolveVisuals(sb, dir, { images: 'off', force: true });
  return { dir, sb: resolved };
}

/**
 * Resolve a storyboard's visuals and compile its plan, in one call.
 *
 * The shape most tests want: they are asserting on drawn geometry, and drawn geometry
 * now comes from the sidecar. Returns the plan only — a test that also needs the
 * enriched storyboard or the directory should use `withVisuals` directly.
 */
export async function planWithVisuals(
  sb: Storyboard,
  opts: Parameters<typeof compilePlan>[2] = {},
): Promise<ReturnType<typeof compilePlan>> {
  const resolved = await withVisuals(sb);
  return compilePlan(resolved.sb, resolved.dir, opts);
}
