/**
 * Hash every element's resolved geometry, one line per element, for before/after
 * comparison across a `git stash`.
 *
 * This is the cheapest way to verify a change to the geometry lanes, and it sees
 * things a frame grab cannot: a stroke that shifted by one perturbation sample looks
 * identical in a PNG and is not identical. It runs the visuals stage only — no voice,
 * no plan, no encode — so a whole project costs a second or two.
 *
 * Sibling of `packages/render/src/frames.mts`: not part of the package's public API
 * and not wired into any script, deliberately. Used from the repo root as
 *
 *     npx tsx packages/visuals/src/geomhash.mts <project...>
 *
 * where each argument names a directory under `projects/`. The usual shape of a
 * verification is:
 *
 *     npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/after.txt
 *     git stash push -u && git status --short          # confirm the tree is CLEAN
 *     npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/before.txt
 *     git stash pop
 *     diff /tmp/before.txt /tmp/after.txt
 *
 * It is committed rather than kept in a scratch directory for exactly that middle
 * step: `git stash` takes untracked files with `-u` and leaves tracked ones alone, so
 * a tool that lives in the repo survives the stash it is being used to measure.
 *
 * Only the stroke `d` values are hashed. The SVG string would also fold in colours
 * and the font href, which are not what this measures, and would report a diff for a
 * palette change that moved no geometry.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseStoryboard } from '@inkcast/core';
import { loadVisualManifest } from './manifest.js';
import { resolveVisuals } from './resolve.js';

const projects = process.argv.slice(2);
if (projects.length === 0) {
  console.error('usage: geomhash.mts <project...>   (directories under projects/)');
  process.exit(2);
}

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

for (const name of projects) {
  const file = path.join(repoRoot, 'projects', name, 'storyboard.json');
  const sb = parseStoryboard(JSON.parse(await readFile(file, 'utf8')));

  // A scratch project dir, so the real one's cached assets are neither read nor
  // written: this must measure the code, not whatever the last render left behind.
  const dir = await mkdtemp(path.join(tmpdir(), `geomhash-${name}-`));
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'storyboard.json'), JSON.stringify(sb));

  // Images off: the cloud lane is non-deterministic and needs a key, and an
  // illustration is not geometry this tool can say anything useful about.
  await resolveVisuals(sb, dir, { images: 'off', force: true });
  const manifest = await loadVisualManifest(dir);
  if (!manifest) throw new Error(`${name}: the visuals stage wrote no manifest`);

  // `elements` is a record keyed by id, and object key order is insertion order —
  // sorted here so two runs are diffable line for line regardless.
  const elements = Object.values(manifest.elements).sort((a, b) =>
    `${a.sceneId}/${a.id}`.localeCompare(`${b.sceneId}/${b.id}`),
  );
  for (const el of elements) {
    const geom = sha(JSON.stringify(el.strokes.map((s) => s.d)));
    // Tab-separated, and note the stage logs to stdout too: filter on the tabs
    // rather than assuming this is the only thing on the stream.
    console.log([name, el.type, `${el.sceneId}/${el.id}`, geom, el.strokes.length].join('\t'));
  }
}
