/**
 * The hybrid drawing lane, end to end, on one subject.
 *
 *     npx tsx packages/pipeline/src/underlaysheet.mts "<subject>" "<instruction>" [outDir]
 *
 * **The cheapest thing that can see this lane at all**: one image call and one authoring
 * call, no lesson, no voice, no video. It drives the real seam, the real author, the real
 * compiler and the real visuals stage, so what comes out is what the film would draw.
 *
 * Three files, and the third is the one to look at:
 *
 * - `board.png` — the author's view: the generated subject's ink, placed where it will
 *   really go, on a blank canvas the size the author composes on. This is the picture the
 *   model is shown, and if it is wrong nothing downstream can be right.
 * - `marks.json` — what came back.
 * - `composite.png` — **the board as the film draws it**: that picture vectorised,
 *   roughened and drawn in the board's own hand, with the marks on top of it. Every
 *   transform in the chain has run by the time this is written, so a leader arrow that
 *   reaches its structure here reaches it in the video.
 *
 * ## What it is for
 *
 * The whole lane is one long argument about alignment. Marks are placed by a model looking
 * at a picture; if the picture then lands anywhere else, every arrow points at empty board
 * — and it looks exactly like the model being bad at aiming, which is the one failure that
 * would be diagnosed wrong. `composite.png` is the only thing that can tell those apart.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssetElement, Element, Mark } from '@inkcast/core';
import { DRAW_H, DRAW_W, parseStoryboard } from '@inkcast/core';
import {
  assetSeed,
  boxAt,
  buildDrawing,
  drawOne,
  fitCanvas,
  prepareMarks,
  readInkBox,
  underlayAsset,
} from '@inkcast/planner';
import { openDrawUnderlay } from './draw-underlay.js';
import { loadRender, loadVisuals } from './stages.js';

const [subject, instruction, out = '/tmp/underlay'] = process.argv.slice(2);
if (!subject || !instruction) {
  console.error('usage: underlaysheet.mts "<subject>" "<instruction>" [outDir]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const vaultSpecifier = new URL('../../keyvault/src/index.ts', import.meta.url).href;
try {
  const kv = (await import(vaultSpecifier)) as { hydrateEnv(): Promise<unknown> };
  await kv.hydrateEnv();
} catch {
  /* environment it is */
}

/** The frame the board is drawn in, and the cell the drawing gets — as `draw-preview.ts`. */
const CANVAS = { x: 0, y: 0, w: 1920, h: 1080 };
const BOX = { x: 110, y: 70, w: 1700, h: 940 };

const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-underlaysheet-'));

/* --- 1. the form: generated, traced, and placed where it will really go --- */

const underlays = openDrawUnderlay(dir);
const made = await underlays.underlay(subject);
if (!made) {
  console.error(
    'no underlay came back — needs FAL_KEY (or REPLICATE_API_TOKEN), the vectoriser, and Chromium',
  );
  await underlays.close();
  process.exit(1);
}
writeFileSync(path.join(out, 'board.png'), Buffer.from(made.png));
const ink = readInkBox(made.inkBox);
if (!ink) {
  console.error('the underlay came back without a usable box');
  await underlays.close();
  process.exit(1);
}
console.log(`underlay: ${subject}`);
console.log(
  `  ink box  x=${ink.x.toFixed(0)}..${(ink.x + ink.w).toFixed(0)} ` +
    `y=${ink.y.toFixed(0)}..${(ink.y + ink.h).toFixed(0)}  on a ${DRAW_W}x${DRAW_H} canvas`,
);

/* --- 2. the parts: the author, looking at that board --- */

const marks = await drawOne(instruction, { underlay: { png: made.png, box: ink } });
await underlays.close();
if (!marks?.length) {
  console.error('the author returned no usable marks');
  process.exit(1);
}

const off = marks.filter((m: Mark) => {
  const ys = [m.y ?? 0, (m.y ?? 0) + (m.h ?? 0), ...(m.points ?? []).map((p) => p[1] ?? 0)];
  const xs = [m.x ?? 0, (m.x ?? 0) + (m.w ?? 0), ...(m.points ?? []).map((p) => p[0] ?? 0)];
  return ys.some((v) => v > DRAW_H + 20 || v < -20) || xs.some((v) => v > DRAW_W + 20 || v < -20);
});
console.log(
  `${marks.length} marks placed${off.length ? `, ${off.length} outside the canvas` : ''}`,
);
for (const m of marks) console.log(`  ${m.kind.padEnd(7)} ${m.id}${m.text ? ` "${m.text}"` : ''}`);
writeFileSync(path.join(out, 'marks.json'), `${JSON.stringify(marks, null, 1)}\n`);

/* --- 3. the board as the film draws it, through every real transform --- */

// One `Fit` for both halves. The asset's box is this transform's picture of the ink box
// the seam measured, and the marks go through the same transform — which is the whole
// mechanism, so building it any other way here would be testing something else.
const fit = fitCanvas(BOX);
const asset = underlayAsset(subject);
const el: AssetElement = {
  id: 'd_underlay',
  type: 'asset',
  assetId: asset.id,
  flipX: false,
  at: boxAt(fit, ink),
  enter: { at: 0.02, duration: 0.8, style: 'draw' },
  persist: true,
};
// The compiler's own path, so the fit under test is the one the film uses — including
// `prepareMarks` seeing the underlay, which is what keeps a name off the picture.
const elements: Element[] = [
  el,
  // `traced: true` — this sheet is the form lane, and the trace is the point of it.
  ...buildDrawing(prepareMarks(marks, { box: ink, traced: true }), {
    id: 'd',
    box: BOX,
    underlay: true,
  }),
];

const sb = parseStoryboard({
  version: 1,
  title: 'underlay sheet',
  canvas: CANVAS,
  assets: [
    {
      id: asset.id,
      kind: 'illustration',
      prompt: asset.prompt,
      seed: assetSeed(asset.id),
      source: 'generated',
      fit: 'exact',
    },
  ],
  scenes: [
    {
      id: 's1',
      narration:
        'Here is the drawing on its own, every mark of it, drawn by the same hand and the ' +
        'same pen that draws the film, so that what is on this board is what a viewer sees.',
      camera: { x: CANVAS.w / 2, y: CANVAS.h / 2, zoom: 1 },
      elements,
    },
  ],
});

const [render, visuals] = await Promise.all([loadRender(), loadVisuals()]);
const still = await render.openStills();
if (!still) {
  console.error('no Chromium — pnpm exec playwright install chromium');
  process.exit(1);
}
try {
  const resolved = await visuals.resolveVisuals(sb, dir);
  const png = await still.capture(resolved, dir);
  writeFileSync(path.join(out, 'composite.png'), Buffer.from(png));
} finally {
  await still.close();
}

console.log(`\n${out}/composite.png   <- look at this one`);
console.log(`${out}/board.png · marks.json`);
