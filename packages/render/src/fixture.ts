/**
 * A tiny storyboard used by the tests: two seconds, two scenes, and at least one
 * of every element type and enter style, so a regression in any part of the
 * vocabulary shows up in the smoke render.
 *
 * Not exported from the package's public API — it is a test fixture, not content.
 */
import { parseStoryboard } from '@inkcast/core';
import type { Storyboard } from '@inkcast/core';

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
