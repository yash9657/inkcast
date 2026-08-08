/**
 * The figure lane, end to end, on one subject.
 *
 *     npx tsx packages/pipeline/src/figuresheet.mts "<the beat's teaching figure>" [outDir]
 *
 * **The tool the figure lane is judged with**, and the cheapest thing that can see it at
 * all: one image call, no authoring call, and a `figure.png` that has been through every
 * transform the film uses — resolve, inline, the browser, the same pen and paper.
 *
 * The lane it exercises is the one `docs/PLAN-FIGURE-LANE.md` argues for: ask a
 * figure-capable model for the beat's whole teaching picture in colour, and **do not trace
 * it**. Tracing is what the older lane does, and it is right to, for line art whose parts
 * composed marks will name. It is catastrophic for a colour figure — a binary threshold
 * erases every hue that carries meaning, which on the cardiac card meant the orange
 * conduction arrows simply were not there. Compare `underlaysheet.mts`, which is the same
 * shape for the other lane, and run both on one subject when you want to see the trade.
 *
 * Argue with the picture, not with the number. What to look for:
 *
 * - is it a *figure* — a view, internal structure, a pathway — or just the object?
 * - does colour separate things a learner must tell apart, or is it decoration?
 * - is there lettering in it? There must not be. Names are the mark layer's job, and a
 *   diffusion model still cannot spell.
 * - would you put it beside the card in `docs/research/figure-lane/model-probe.png`?
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseStoryboard, type AssetElement, type Element } from '@inkcast/core';
import { loadRender, loadVisuals } from './stages.js';

const [subject, out = '/tmp/figure'] = process.argv.slice(2);
if (!subject) {
  console.error('usage: figuresheet.mts "<the beat\'s teaching figure>" [outDir]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

// Same seam `drawcheck.mts` and `lanesheet.mts` use, and for the same reason: the image key
// lives in the macOS keychain, not the environment, and without this the lane under test
// reports itself unavailable — which reads exactly like the model refusing to draw.
const vaultSpecifier = new URL('../../keyvault/src/index.ts', import.meta.url).href;
try {
  const kv = (await import(vaultSpecifier)) as { hydrateEnv(): Promise<{ injected: string[] }> };
  const { injected } = await kv.hydrateEnv();
  if (injected.length > 0) console.log(`keys: ${injected.join(', ')}`);
} catch {
  console.log('no keyvault — relying on the environment');
}

/**
 * The figure gets the frame. That is the change: `UNDERLAY_AREA` reserves 190 units of
 * clear board either side for names the mark layer writes, which is right when the marks
 * carry the mechanism and wrong when the picture does.
 */
const CANVAS = { x: 0, y: 0, w: 1600, h: 900 };
const BOX = { x: 240, y: 20, w: 1120, h: 860 };

const visuals = await loadVisuals();
const images = (await import('@inkcast/visuals')) as typeof import('@inkcast/visuals');

console.log(`\nasking for the figure:\n  "${subject}"\n`);
console.log(`shaped as:\n  "${images.figurePrompt(subject)}"\n`);

const figure = await images.figureRaster({
  id: 'figuresheet',
  prompt: subject,
  dir: out,
  box: { x: 0, y: 0, w: BOX.w, h: BOX.h },
});
if (!figure) {
  console.error(
    'no figure came back — set FAL_KEY or REPLICATE_API_TOKEN (`inkcast keys set fal`)',
  );
  process.exit(1);
}
console.log(`raster: ${figure.raster}${figure.cached ? ' (cached)' : ' (generated)'}`);

/**
 * A figure is the beat's whole picture, so it is swept in over a real span rather than the
 * 0.8s an incidental asset gets. Held here so the sample times below can be inside it —
 * sampling a 0.8s reveal at "36% of the scene" catches it long finished, which is exactly
 * how the first run of this sheet reported a sweep that was never visible.
 */
const REVEAL_AT = 0.02;
const REVEAL_SEC = 2.8;

const el: AssetElement = {
  id: 'figure',
  type: 'asset',
  assetId: 'figuresheet',
  flipX: false,
  at: BOX,
  enter: { at: REVEAL_AT, duration: REVEAL_SEC, style: 'draw' },
  persist: true,
};
const elements: Element[] = [el];

const sb = parseStoryboard({
  version: 1,
  title: 'figure sheet',
  canvas: CANVAS,
  // `svg` starting with `<svg` takes the authoritative inline branch in `resolveAsset`,
  // which writes it out untouched — so what reaches the board is the raster itself, not a
  // trace of it, which is the entire point of the lane.
  assets: [{ id: 'figuresheet', kind: 'illustration', prompt: subject, svg: figure.svg }],
  scenes: [
    {
      id: 's1',
      narration:
        'Here is the figure on its own, on the board the film draws, so that what is on ' +
        'this board is what a viewer sees.',
      camera: { x: CANVAS.w / 2, y: CANVAS.h / 2, zoom: 1 },
      elements,
    },
  ],
});

const render = await loadRender();
const still = await render.openStills();
if (!still) {
  console.error('no Chromium — pnpm exec playwright install chromium');
  process.exit(1);
}
try {
  const resolved = await visuals.resolveVisuals(sb, out);
  const png = await still.capture(resolved, out);
  writeFileSync(path.join(out, 'figure.png'), Buffer.from(png));

  // The sweep is the half that cannot be judged from the finished frame: a mask that
  // arrives as a hard vertical edge and a mask that arrives as a hand both end identically.
  // These four are where it is actually visible.
  const dur = resolved.scenes[0]?.durationSec ?? 6;
  const start = dur * REVEAL_AT;
  for (const frac of [0.2, 0.4, 0.6, 0.8]) {
    const shot = await still.capture(resolved, out, { t: start + REVEAL_SEC * frac });
    writeFileSync(path.join(out, `sweep-${Math.round(frac * 100)}.png`), Buffer.from(shot));
  }
} finally {
  await still.close();
}

console.log(`\n${out}/figure.png   <- the finished card`);
console.log(`${out}/sweep-18.png · sweep-36.png · sweep-54.png · sweep-72.png   <- the reveal`);
