/**
 * Look at the four inks, on a drawing built to need them.
 *
 *     npx tsx packages/pipeline/src/tonesheet.mts /tmp/tones
 *
 * The colour lane has one claim to make — that a picture with two flows crossing the same
 * space is legible in two inks and a tangle in one — and it is not a claim any audit can
 * check. So this draws the case it was added for, twice: the marks as authored, and the
 * same marks with every tone stripped. Open both PNGs side by side.
 *
 * Hand-authored marks on purpose. The author is a model and this is the renderer's half:
 * if the tone does not survive `Mark` → element → prim → pixels, no amount of briefing
 * the author will put colour on the board, and a model call would only hide which half
 * was broken. Free, no key, no network.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Mark } from '@inkcast/core';
import { openDrawPreview } from './draw-preview.js';

const out = process.argv[2] ?? '/tmp/tones';
mkdirSync(out, { recursive: true });

/**
 * A charging cell: two electrode stacks, a liquid gap, and the two things that cross it
 * going opposite ways round. The ions cross the liquid; the electrons cannot, and loop
 * the long way through the wire. Told apart by ink, or not told apart at all.
 */
const MARKS: Mark[] = [
  {
    id: 'cell-body',
    kind: 'rect',
    x: 180,
    y: 150,
    w: 640,
    h: 300,
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'left-stack',
    kind: 'rect',
    x: 210,
    y: 180,
    w: 130,
    h: 240,
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'left-hatch',
    kind: 'hatch',
    x: 210,
    y: 180,
    w: 130,
    h: 240,
    angle: 45,
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'right-stack',
    kind: 'rect',
    x: 660,
    y: 180,
    w: 130,
    h: 240,
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'right-hatch',
    kind: 'hatch',
    x: 660,
    y: 180,
    w: 130,
    h: 240,
    angle: 45,
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'liquid-gap',
    kind: 'rect',
    x: 360,
    y: 180,
    w: 276,
    h: 240,
    tone: 'muted',
    closed: false,
    smooth: false,
    dashed: false,
  },
  // The ions: across the liquid, left to right.
  {
    id: 'ion-path-1',
    kind: 'arrow',
    points: [
      [350, 240],
      [650, 240],
    ],
    tone: 'accent',
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'ion-path-2',
    kind: 'arrow',
    points: [
      [350, 320],
      [650, 320],
    ],
    tone: 'accent',
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'ion-dots',
    kind: 'dots',
    x: 400,
    y: 250,
    w: 200,
    h: 60,
    count: 8,
    tone: 'accent',
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'ion-label',
    kind: 'label',
    x: 500,
    y: 200,
    text: 'ions cross',
    size: 30,
    tone: 'accent',
    closed: false,
    smooth: false,
    dashed: false,
  },
  // The electrons: blocked, so the long way round through the wire above.
  {
    id: 'wire',
    kind: 'stroke',
    points: [
      [275, 180],
      [275, 70],
      [725, 70],
      [725, 180],
    ],
    tone: 'contrast',
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'electron-arrow',
    kind: 'arrow',
    points: [
      [400, 70],
      [600, 70],
    ],
    tone: 'contrast',
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'electron-dots',
    kind: 'dots',
    x: 320,
    y: 55,
    w: 340,
    h: 30,
    count: 7,
    tone: 'contrast',
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'electron-label',
    kind: 'label',
    x: 500,
    y: 118,
    text: 'electrons loop',
    size: 30,
    tone: 'contrast',
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'graphite-label',
    kind: 'label',
    x: 275,
    y: 480,
    text: 'graphite',
    size: 28,
    closed: false,
    smooth: false,
    dashed: false,
  },
  {
    id: 'liquid-label',
    kind: 'label',
    x: 498,
    y: 480,
    text: 'liquid',
    size: 28,
    tone: 'muted',
    closed: false,
    smooth: false,
    dashed: false,
  },
];

const handle = openDrawPreview({ style: 'marker', palette: 'color' });
try {
  for (const [name, marks] of [
    ['toned', MARKS],
    ['one-ink', MARKS.map(({ tone: _drop, ...m }) => m as Mark)],
  ] as const) {
    const png = await handle.preview(marks as unknown[]);
    if (!png) {
      console.error('no Chromium — pnpm exec playwright install chromium');
      process.exit(1);
    }
    const file = path.join(out, `${name}.png`);
    writeFileSync(file, png);
    console.log(`${file}\t${(png.length / 1024).toFixed(0)} kB`);
  }
} finally {
  await handle.close();
}
