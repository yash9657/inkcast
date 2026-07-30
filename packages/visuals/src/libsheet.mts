/**
 * A contact sheet of the asset library, as a real project you can grab frames from.
 *
 *     npx tsx packages/visuals/src/libsheet.mts <outDir>
 *     npx tsx packages/render/src/frames.mts <outDir> <framesDir> 18
 *
 * Every asset in `library.json`, referenced by path with no version pinned, laid out in
 * a grid with its path written under it and resolved with the cloud lane forced off. Two
 * jobs: it is how you *look* at a curated asset before committing it, and it is the only
 * place both ink modes appear side by side in one frame.
 *
 * A static SVG cannot show you what matters about a library asset. The sketch pass
 * rewrites the geometry, a fill is hachured rather than flooded, and document order
 * becomes reveal order — so a figure that looks fine in a browser can arrive as a diamond
 * head with a ringed face, which is exactly how the first cast came out. Render it.
 *
 * Deliberately not a test. What it checks is taste, and an assertion about taste is a
 * test that fails whenever the drawing improves.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseStoryboard, saveStoryboard } from '@inkcast/core';
import { loadLibrary } from './library.js';
import { resolveVisuals } from './resolve.js';

const lib = loadLibrary();
if (!lib) throw new Error('no library found — is assets/library/library.json present?');

const paths = Object.keys(lib.assets);
const COLS = 3;
const CELL_W = 560;
const CELL_H = 460;
const dir = process.argv[2] ?? (await mkdtemp(path.join(tmpdir(), 'inkcast-libsheet-')));

/** The last path segment, which is what an `Asset.id` would plausibly be. */
const idOf = (p: string): string => p.split('/').pop() ?? p;

const sb = parseStoryboard({
  version: 1,
  title: 'The asset library',
  meta: { style: 'marker', palette: 'color' },
  canvas: { x: 0, y: 0, w: 1920, h: 1080 },
  assets: paths.map((p) => ({
    id: idOf(p),
    kind: p.startsWith('figures/') ? 'illustration' : 'icon',
    // No version: the sheet is for reviewing what the library currently offers.
    ref: { path: p },
  })),
  scenes: [
    {
      id: 's1',
      // Long enough that the estimated scene window outlasts the staggered entries, so a
      // frame late in the scene has everything on the board at once.
      narration:
        'Here is the whole library at once, every asset drawn from a file in the repository ' +
        'rather than from a call to a provider, which is the entire point of having one. The ' +
        'figures are sketched and the symbols are crisp, and both are on the same board.',
      camera: { x: 960, y: 540, zoom: 1 },
      elements: [
        {
          id: 'caption',
          type: 'text',
          text: 'assets/library — resolved by path and version, no network',
          role: 'caption',
          at: { x: 120, y: 40, w: 1680, h: 70 },
          enter: { at: 0, duration: 0.6, style: 'write' },
        },
        ...paths.flatMap((p, i) => {
          const x = 160 + (i % COLS) * CELL_W;
          const y = 150 + Math.floor(i / COLS) * CELL_H;
          return [
            {
              id: `a-${i}`,
              type: 'asset',
              assetId: idOf(p),
              at: { x, y, w: 320, h: 380 },
              enter: { at: Math.min(0.9, 0.05 * i), duration: 0.6, style: 'draw' },
              persist: true,
            },
            {
              id: `t-${i}`,
              type: 'text',
              text: p,
              role: 'label',
              at: { x: x - 40, y: y + 390, w: 400, h: 50 },
              enter: { at: Math.min(0.92, 0.05 * i + 0.02), duration: 0.4, style: 'write' },
              persist: true,
            },
          ];
        }),
      ],
    },
  ],
});

const out = await resolveVisuals(sb, dir, { images: 'off' });
await saveStoryboard(dir, out);
for (const a of out.assets) {
  console.log(`${a.id}\t${a.source}\t${JSON.stringify(a.ref)}`);
}
console.log(`\nproject: ${dir}`);
console.log(`frames:  npx tsx packages/render/src/frames.mts ${dir} <framesDir> 18`);
