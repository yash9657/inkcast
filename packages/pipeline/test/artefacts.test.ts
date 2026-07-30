import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isFresh, markFresh, type Storyboard } from '@inkcast/core';
import { visualsArtefacts } from '../src/cast.js';
import { cacheSlot } from '../src/keys.js';

const MANIFEST = 'assets/visuals.json';

function board(assets: Array<{ id: string; svg?: string }>): Storyboard {
  return {
    version: 1,
    title: 't',
    meta: {
      language: 'en',
      aspect: '16:9',
      palette: 'color',
      fps: 30,
      style: 'marker',
      voice: 'af_heart',
      outroSec: 1.2,
    },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: assets.map((a) => ({
      id: a.id,
      kind: 'icon' as const,
      ...(a.svg ? { svg: a.svg } : {}),
    })),
    scenes: [
      {
        id: 's0',
        narration: 'n',
        camera: { x: 0, y: 0, zoom: 1, transition: 0 },
        elements: [],
        hold: 0,
      },
    ],
  } as unknown as Storyboard;
}

test('the visuals stage is gated on its manifest and every resolved asset', () => {
  const sb = board([
    { id: 'a', svg: 'assets/a.svg' },
    { id: 'b', svg: 'assets/b.svg' },
  ]);
  assert.deepEqual(visualsArtefacts(sb), [MANIFEST, 'assets/a.svg', 'assets/b.svg']);
});

test('an unresolved asset contributes no artefact', () => {
  // `Asset.svg` is absent until the stage resolves it, so naming it would gate the
  // stage on a file it is the stage's own job to produce — nothing would ever be fresh.
  const sb = board([{ id: 'a' }, { id: 'b', svg: 'assets/b.svg' }]);
  assert.deepEqual(visualsArtefacts(sb), [MANIFEST, 'assets/b.svg']);
});

test('a storyboard with no assets is still gated on the manifest', () => {
  // The benchmark is exactly this case — zero assets, eight plots and an equation —
  // so an empty artefact list here would leave the whole board ungated.
  assert.deepEqual(visualsArtefacts(board([])), [MANIFEST]);
});

test('a cache entry whose manifest has been deleted does not read as fresh', async () => {
  // The defect this closes: `rerender()` hashed the board and named nothing, so a
  // project whose `assets/` had been cleared skipped the visuals stage. Plots survived
  // that by being re-resolved in the renderer; an equation cannot be typeset there at
  // all and would go to the board as raw TeX.
  const root = await mkdtemp(path.join(tmpdir(), 'inkcast-artefacts-'));
  try {
    const sb = board([]);
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await writeFile(path.join(root, MANIFEST), '{}');
    await markFresh(root, cacheSlot('visuals'), 'key');

    assert.equal(
      await isFresh(root, cacheSlot('visuals'), 'key', visualsArtefacts(sb)),
      true,
      'manifest present and hash matching should be fresh',
    );
    await rm(path.join(root, MANIFEST));
    assert.equal(
      await isFresh(root, cacheSlot('visuals'), 'key', visualsArtefacts(sb)),
      false,
      'a missing manifest must invalidate the entry even though the hash still matches',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
