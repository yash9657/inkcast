/**
 * A contact sheet of the asset library, as a real project you can grab frames from.
 *
 *     npx tsx packages/visuals/src/libsheet.mts <outDir>
 *     npx tsx packages/render/src/frames.mts <outDir> <framesDir> 20
 *
 * Every asset in `library.json`, referenced by path with no version pinned, laid out in
 * a grid with its path written under it and resolved with the cloud lane forced off. Two
 * jobs: it is how you *look* at a curated asset before committing it, and it is the only
 * place both ink modes — and every pose of a rig — appear side by side in one frame.
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
import { loadRig } from './character.js';
import { libraryFile, loadLibrary } from './library.js';
import { resolveVisuals } from './resolve.js';

const lib = loadLibrary();
if (!lib) throw new Error('no library found — is assets/library/library.json present?');

/**
 * One cell per *drawing*, which for a rig means one per pose.
 *
 * A rig drawn once tells you nothing about the thing that makes it a rig. What has to be
 * looked at is the set: whether the poses read as the same person, and whether each one
 * reads as the pose it claims to be. So a rig expands.
 */
type Cell = { label: string; id: string; ref: { path: string; variant?: string } };

const cells: Cell[] = [];
for (const [assetPath, entry] of Object.entries(lib.assets)) {
  const base = assetPath.split('/').pop() ?? assetPath;
  if (!entry.rig) {
    cells.push({ label: assetPath, id: base, ref: { path: assetPath } });
    continue;
  }
  const rig = loadRig(libraryFile(lib, assetPath, entry.version));
  if (!rig) continue;
  for (const pose of Object.keys(rig.poses)) {
    cells.push({
      label: `${base} · ${pose}`,
      id: `${base}-${pose}`,
      ref: { path: assetPath, variant: pose },
    });
  }
}

// Wide enough to stay legible, square enough to fit: the sheet grows with the library and
// the cells have to shrink at some point, so shrink the grid rather than the review.
const COLS = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(cells.length))));
const ROWS = Math.ceil(cells.length / COLS);
const CELL_W = Math.floor(1760 / COLS);
const CELL_H = Math.floor(920 / ROWS);
const ART_H = Math.floor(CELL_H * 0.76);
const dir = process.argv[2] ?? (await mkdtemp(path.join(tmpdir(), 'inkcast-libsheet-')));

const sb = parseStoryboard({
  version: 1,
  title: 'The asset library',
  meta: { style: 'marker', palette: 'color' },
  canvas: { x: 0, y: 0, w: 1920, h: 1080 },
  assets: cells.map((c) => ({
    id: c.id,
    kind: 'illustration',
    // No version: the sheet is for reviewing what the library currently offers.
    ref: c.ref,
  })),
  scenes: [
    {
      id: 's1',
      // Long enough that the estimated scene window outlasts the staggered entries, so a
      // frame late in the scene has everything on the board at once.
      narration:
        'Here is the whole library at once, every asset drawn from a file in the repository ' +
        'rather than from a call to a provider, which is the entire point of having one. The ' +
        'figures are sketched and the symbols are crisp, and both are on the same board, and ' +
        'the explorer is one rig posed several ways rather than several drawings of a person.',
      camera: { x: 960, y: 540, zoom: 1 },
      elements: [
        {
          id: 'caption',
          type: 'text',
          text: 'assets/library — resolved by path, version and pose, no network',
          role: 'caption',
          at: { x: 120, y: 30, w: 1680, h: 60 },
          enter: { at: 0, duration: 0.6, style: 'write' },
        },
        ...cells.flatMap((c, i) => {
          const x = 100 + (i % COLS) * CELL_W;
          const y = 120 + Math.floor(i / COLS) * CELL_H;
          const at = Math.min(0.88, 0.04 * i);
          return [
            {
              id: `a-${i}`,
              type: 'asset',
              assetId: c.id,
              at: { x, y, w: CELL_W - 120, h: ART_H },
              enter: { at, duration: 0.6, style: 'draw' },
              persist: true,
            },
            {
              id: `t-${i}`,
              type: 'text',
              text: c.label,
              role: 'label',
              at: { x: x - 30, y: y + ART_H + 6, w: CELL_W - 40, h: 44 },
              enter: { at: at + 0.01, duration: 0.4, style: 'write' },
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
console.log(`frames:  npx tsx packages/render/src/frames.mts ${dir} <framesDir> 20`);
