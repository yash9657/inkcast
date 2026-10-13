import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStoryboard, type Storyboard } from '@inkcast/core';
import { ctxFor } from '../src/geometry.js';
import {
  libraryAvailable,
  libraryFile,
  libraryFingerprint,
  libraryPaths,
  loadLibrary,
  matchLibrary,
  resetLibraryCache,
} from '../src/library.js';
import { loadVisualManifest } from '../src/manifest.js';
import { resolveVisuals } from '../src/resolve.js';
import { inkStyleFor } from '../src/style.js';
import { containsBox, padBox, pathBBox, unionBox } from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const ctx = ctxFor(style, 4242);
const box = { x: 0, y: 0, w: 256, h: 256 };

/* ------------------------------------------------------ the shipped library */

test('the shipped library loads and every registered version is on disk', () => {
  const lib = loadLibrary();
  assert.ok(lib, 'assets/library/library.json must be findable from this package');
  assert.ok(libraryAvailable());

  const paths = Object.keys(lib.assets);
  assert.ok(paths.length >= 6, `expected the figures cast and some symbols, got ${paths.length}`);
  for (const name of ['standing', 'walking', 'pointing', 'sitting']) {
    assert.ok(lib.assets[`figures/${name}`], `the no-key cast is missing figures/${name}`);
  }

  // The manifest is a register and the files are the truth, so drift between them
  // is the one failure mode that turns "resolve by path and version" into a
  // fall-through to lucide with only a warning to show for it.
  for (const [assetPath, entry] of Object.entries(lib.assets)) {
    const file = libraryFile(lib, assetPath, entry.version);
    assert.ok(existsSync(file), `${assetPath} registers v${entry.version} but ${file} is missing`);
    assert.ok(entry.license, `${assetPath} has no license`);
    assert.ok(entry.provenance, `${assetPath} has no provenance`);
  }
});

test('a figure draws inside its box, in document order', async () => {
  const drawn = await libraryPaths({ ref: { path: 'figures/standing' }, box, ctx });
  assert.ok(drawn, 'figures/standing must resolve');
  assert.equal(drawn.version, 1);
  assert.equal(drawn.ink, 'sketch', 'a figure is read as a feeling, so it is roughened');
  assert.ok(drawn.paths.length >= 8, `expected a figure, got ${drawn.paths.length} paths`);

  const bounds = unionBox(drawn.paths.map((p) => pathBBox(p.d)));
  // Padded by the stroke width: roughjs puts its wobble either side of the line.
  assert.ok(
    containsBox(padBox(box, style.strokeWidth * 3), bounds),
    `the figure escaped its box: ${JSON.stringify(bounds)}`,
  );
  for (const p of drawn.paths) assert.ok(p.length > 0, 'every path must be measured');
  assert.ok(
    drawn.paths.every((p) => p.group?.startsWith('library:figures/standing')),
    'paths must be grouped by the asset that drew them',
  );
});

test('a crisp symbol keeps its closed contour and its fill', async () => {
  const drawn = await libraryPaths({ ref: { path: 'symbols/physics/force-vector' }, box, ctx });
  assert.ok(drawn);
  assert.equal(drawn.ink, 'crisp', 'a direction a learner reads must not wobble');

  // The step-3 lesson, and the reason a filled library symbol was worth a test:
  // roughjs at zero roughness drops the `Z`, which is invisible on a stroked line
  // and renders a filled arrowhead hollow. Crisp bypasses roughjs entirely.
  const filled = drawn.paths.filter((p) => p.fill !== 'none');
  assert.ok(filled.length >= 2, 'the application dot and the arrowhead are filled');
  for (const p of filled) {
    assert.match(p.d, /[Zz]\s*$/, `a filled path must close its contour: ${p.d}`);
    assert.equal(p.fillRule, 'nonzero');
    assert.equal(p.fill, style.ink, 'currentColor must become the board ink');
  }
  // Crisp means one subpath per child, not one per segment.
  assert.equal(drawn.paths.length, 3, 'three children, three paths');
});

test('AssetRef.ink overrides what the library declares', async () => {
  const asRef = { path: 'symbols/physics/force-vector' as const };
  const crisp = await libraryPaths({ ref: asRef, box, ctx });
  const sketch = await libraryPaths({ ref: { ...asRef, ink: 'sketch' }, box, ctx });
  assert.ok(crisp && sketch);
  assert.equal(sketch.ink, 'sketch');
  assert.notEqual(
    sketch.paths[0]?.d,
    crisp.paths[0]?.d,
    'the same shaft must be drawn differently',
  );
});

/* -------------------------------------------------------------- matching */

test('an unreferenced entity matches the cast by id, then by prompt', () => {
  assert.equal(matchLibrary({ id: 'figures/walking' })?.how, 'path');
  assert.equal(matchLibrary({ id: 'hiker' })?.path, 'figures/walking');
  assert.equal(matchLibrary({ id: 'hiker' })?.how, 'alias');
  assert.equal(matchLibrary({ id: 'teacher' })?.path, 'figures/pointing');
  assert.equal(
    matchLibrary({ id: 'subject-1', prompt: 'a person standing in a field' })?.path,
    'figures/standing',
    'an id with nothing to say leaves the prompt to answer',
  );
  // The id wins outright when both could answer, which is the whole reason it is
  // tried first: a slug is a name someone chose, a prompt is a sentence that
  // happens to contain nouns.
  assert.equal(
    matchLibrary({ id: 'hiker', prompt: 'a person sitting on a rock' })?.path,
    'figures/walking',
  );
});

test('the library does not hijack entities the icon lane draws better', () => {
  // An over-reaching alias is the failure mode that matters here: these ids all
  // resolve to good lucide glyphs today, and a confidently wrong figure would be
  // worse than the generic icon it replaced.
  for (const id of ['cpu', 'ram', 'database', 'brain', 'rocket-ship', 'mountain', 'briefcase']) {
    assert.equal(matchLibrary({ id }), undefined, `${id} must stay on the icon lane`);
  }
  assert.equal(
    matchLibrary({ id: 'gpu', prompt: 'a graphics card with fans, seen from above' }),
    undefined,
  );
});

/* --------------------------------------------------------------- versions */

/** A two-version library, so pinning can be tested without shipping a fake v2. */
async function fixtureLibrary(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-library-'));
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(
    path.join(dir, 'library.json'),
    JSON.stringify({
      version: 1,
      assets: {
        'test/box': {
          version: 2,
          ink: 'crisp',
          kind: 'icon',
          license: 'CC0-1.0',
          provenance: 'test fixture',
          match: ['crate'],
        },
      },
    }),
  );
  // Crisp, so each child is exactly one path and counting them identifies a version.
  await writeFile(
    path.join(dir, 'test/box.v1.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<rect x="10" y="10" width="80" height="80"/></svg>',
  );
  await writeFile(
    path.join(dir, 'test/box.v2.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<rect x="10" y="10" width="80" height="80"/>' +
      '<path d="M10 10 L90 90"/><path d="M90 10 L10 90"/></svg>',
  );
  return dir;
}

/** Point the library at `dir` for the duration of `fn`. */
async function withLibrary(dir: string, fn: () => Promise<void> | void): Promise<void> {
  const before = process.env.INKCAST_LIBRARY_DIR;
  process.env.INKCAST_LIBRARY_DIR = dir;
  resetLibraryCache();
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.INKCAST_LIBRARY_DIR;
    else process.env.INKCAST_LIBRARY_DIR = before;
    resetLibraryCache();
  }
}

test('a pinned version is drawn even when a newer one exists', async () => {
  const dir = await fixtureLibrary();
  await withLibrary(dir, async () => {
    assert.equal(loadLibrary()?.assets['test/box']?.version, 2, 'the newest is v2');

    const pinned = await libraryPaths({ ref: { path: 'test/box', version: 1 }, box, ctx });
    assert.ok(pinned);
    assert.equal(pinned.version, 1);
    assert.equal(pinned.paths.length, 1, 'v1 is one rectangle');

    // The same reference with nothing pinned takes the improvement.
    const latest = await libraryPaths({ ref: { path: 'test/box' }, box, ctx });
    assert.ok(latest);
    assert.equal(latest.version, 2);
    assert.equal(latest.paths.length, 3, 'v2 is a crossed rectangle');

    // And the fingerprint separates them, which is what stops the cache from
    // serving one where the other was asked for.
    assert.notEqual(
      libraryFingerprint({ id: 'crate', ref: { path: 'test/box', version: 1 } }),
      libraryFingerprint({ id: 'crate', ref: { path: 'test/box', version: 2 } }),
    );
    assert.equal(libraryFingerprint({ id: 'unrelated-thing' }), '', 'silent about other assets');
  });
});

test('a missing version or path falls through instead of throwing', async () => {
  const dir = await fixtureLibrary();
  await withLibrary(dir, async () => {
    assert.equal(
      await libraryPaths({ ref: { path: 'test/box', version: 9 }, box, ctx }),
      undefined,
    );
    assert.equal(await libraryPaths({ ref: { path: 'test/nope' }, box, ctx }), undefined);
  });
});

/* ------------------------------------------------------- through the stage */

function storyboard(assets: unknown[], count = assets.length): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'Library',
    meta: { style: 'marker', palette: 'color' },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets,
    scenes: [
      {
        id: 's1',
        narration: 'Someone walks downhill.',
        camera: { x: 480, y: 270, zoom: 1 },
        elements: Array.from({ length: count }, (_, i) => ({
          id: `el-${i}`,
          type: 'asset',
          assetId: (assets[i] as { id: string }).id,
          at: { x: 100 + i * 300, y: 200, w: 240, h: 300 },
        })),
      },
    ],
  });
}

test('an asset resolves by path and version with no network', async () => {
  assert.equal(process.env.REPLICATE_API_TOKEN, undefined);
  assert.equal(process.env.FAL_KEY, undefined);

  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-libstage-'));
  const sb = storyboard([
    { id: 'narrator', kind: 'illustration', ref: { path: 'figures/pointing', version: 1 } },
  ]);
  // `images: 'off'` disables the cloud lane even if a key appears, so this asserts
  // the library lane won rather than that *something* was drawn.
  const out = await resolveVisuals(sb, dir, { images: 'off' });
  const manifest = await loadVisualManifest(dir);
  assert.ok(manifest);

  const record = manifest.assets.narrator;
  assert.equal(record?.lane, 'library');
  assert.deepEqual(record?.library, {
    path: 'figures/pointing',
    version: 1,
    ink: 'sketch',
    how: 'path',
  });
  assert.ok((record?.strokes.length ?? 0) >= 8, 'the curated geometry must reach the sidecar');
  assert.ok(existsSync(path.resolve(dir, record?.svg ?? '')));
  assert.equal(out.assets[0]?.source, 'library');
});

test('a no-key character comes from the cast instead of a lettered card', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-libstage-'));
  // What the planner actually emits: a slug and a prompt, no idea a library exists.
  const sb = storyboard([
    { id: 'hiker', kind: 'illustration', prompt: 'a hiker walking downhill in thick fog' },
    { id: 'learner', kind: 'illustration', prompt: 'a student at the board' },
  ]);
  const out = await resolveVisuals(sb, dir, { images: 'off' });
  const manifest = await loadVisualManifest(dir);
  assert.ok(manifest);

  assert.equal(manifest.assets.hiker?.lane, 'library');
  assert.equal(manifest.assets.hiker?.library?.path, 'figures/walking');
  assert.equal(manifest.assets.hiker?.library?.how, 'alias');
  assert.equal(manifest.assets.learner?.library?.path, 'figures/standing');

  // Resolution pins what it drew, so the next run goes by path rather than back
  // through a match table that may since have been retuned.
  assert.deepEqual(out.assets[0]?.ref, { path: 'figures/walking', version: 1 });
});

test('an asset the library cannot answer keeps the lane it had', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-libstage-'));
  const sb = storyboard([
    { id: 'database', kind: 'illustration', prompt: 'a database' },
    // Nothing in lucide either — but `matchIcon` has a deliberate last-resort glyph,
    // so this stays on the icon lane rather than reaching the lettered card.
    { id: 'zzqqx', kind: 'icon', prompt: 'zzqqx' },
  ]);
  const out = await resolveVisuals(sb, dir, { images: 'off' });
  const manifest = await loadVisualManifest(dir);
  assert.equal(manifest?.assets.database?.lane, 'icon');
  assert.equal(manifest?.assets.database?.icon?.slug, 'database');
  assert.equal(manifest?.assets.zzqqx?.lane, 'icon');
  // The important half: no reference is invented for an asset the library did not
  // draw, so a storyboard never claims a curated provenance it does not have.
  for (const asset of out.assets) {
    assert.equal(asset.ref, undefined);
    assert.equal(manifest?.assets[asset.id]?.library, undefined);
  }
});
