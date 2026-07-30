/**
 * The acceptance test for an addressable library: a narrative lesson goes in, and one
 * character comes out in four poses with no API key.
 *
 * Every other test of this area proves a piece — `character.test.ts` proves a rig
 * composes, `compile.test.ts` proves the compiler mints a `ref`. None of them proves
 * the pedagogy can *reach* the rig, which is the thing that was actually missing:
 * before this, `VisualIntent` was `{ describe, kind, cue }`, no pose could be named,
 * and every character resolved to `standing` however the beat was written. So this
 * runs the two stages that have to agree — planner then visuals — and asserts on what
 * the board would draw.
 *
 * It lives in `pipeline` because that is the only package depending on both.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Lesson, parseStoryboard } from '@inkcast/core';
import { CAST_POSES, compileLesson } from '@inkcast/planner';
import { libraryFile, loadLibrary, loadRig, resolveVisuals } from '@inkcast/visuals';

const LESSON = path.resolve(import.meta.dirname, '../../../examples/lessons/longitude.lesson.json');
const lesson = Lesson.parse(JSON.parse(await readFile(LESSON, 'utf8')));

/** Compile the narrative lesson and resolve it in a scratch dir, images off. */
async function resolved() {
  const sb = parseStoryboard(compileLesson(lesson, {}));
  // A scratch project, so the repo's own cached assets are neither read nor written:
  // this has to measure the code, not what the last render happened to leave behind.
  const dir = await mkdtemp(path.join(tmpdir(), 'cast-'));
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  // `images: 'off'` is the point, not a convenience — the claim being tested is that
  // this works with no provider at all.
  return { out: await resolveVisuals(sb, dir, { images: 'off', force: true }), dir };
}

test('a narrative lesson draws one character in four poses, with no key', async () => {
  const { out } = await resolved();
  const cast = out.assets.filter((a) => a.ref?.path === 'characters/explorer');
  assert.equal(cast.length, 4, 'four distinct poses, one asset each');

  // Every one of them composed. A fallback would still be four assets and would still
  // render, which is exactly why this asserts on `source` rather than on the count:
  // the failure mode is silent, four `standing` figures that look deliberate.
  for (const a of cast) assert.equal(a.source, 'library');

  assert.deepEqual(cast.map((a) => a.ref?.variant).sort(), [
    'pointing',
    'sitting',
    'standing',
    'walking',
  ]);
});

test('the visuals stage pins the version the storyboard did not name', async () => {
  const { out } = await resolved();
  // Unpinned in, pinned out. Improving the rig to v2 then leaves every storyboard
  // that already resolved v1 rendering v1, which is the whole point of the library.
  for (const a of out.assets.filter((x) => x.ref)) {
    assert.equal(a.ref?.version, 1, `${a.id} left the visuals stage unpinned`);
  }
});

test('each pose is different geometry, and the character survives it', async () => {
  const { out, dir } = await resolved();
  const svgFor = async (variant: string): Promise<string> => {
    const asset = out.assets.find((a) => a.ref?.variant === variant);
    assert.ok(asset?.svg, `no resolved svg for ${variant}`);
    return readFile(path.resolve(dir, asset.svg), 'utf8');
  };
  const names = ['standing', 'walking', 'pointing', 'sitting'];
  const drawn = new Map(await Promise.all(names.map(async (n) => [n, await svgFor(n)] as const)));
  const svgOf = (name: string): string => {
    const svg = drawn.get(name);
    assert.ok(svg, `no drawing for ${name}`);
    return svg;
  };

  // Different, or the pose was never applied — the defect this whole piece exists to
  // fix drew `standing` four times and looked entirely fine.
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.notEqual(
        svgOf(names[i]!),
        svgOf(names[j]!),
        `${names[i]} and ${names[j]} drew identical geometry`,
      );
    }
  }

  // And still a whole person in each. A pose that composed into three strokes would
  // pass the difference check above and be nothing worth drawing. The rig has ten
  // parts and one hatch fill, and `sitting` hides the three far-leg parts, so seven
  // is the floor a real pose can reach honestly.
  const paths = (s: string): number => s.match(/<path/g)?.length ?? 0;
  for (const name of names) {
    assert.ok(paths(svgOf(name)) >= 7, `${name} drew only ${paths(svgOf(name))} paths`);
  }

  // Sitting hides the far leg, so it is the one pose with strictly fewer parts than
  // standing — the check that the rig's `hide` list is actually being honoured.
  assert.ok(
    paths(svgOf('sitting')) < paths(svgOf('standing')),
    'sitting did not drop the hidden far leg',
  );
});

test('the poses offered to the model are the poses the library can actually compose', async () => {
  // `@inkcast/planner` cannot read the library — it does not depend on
  // `@inkcast/visuals` and should not start — so `CAST_POSES` is a copy of what the
  // rigs declare. Two catalogues of one fact is the shape that already went wrong for
  // `doubleWell`, so this is the check that keeps the copy honest: add a pose to a rig
  // and this fails until the model is told about it.
  const lib = loadLibrary();
  assert.ok(lib, 'the asset library did not load');

  // Every rig, not just the explorer: a second character whose poses do not match is
  // the same failure, and the model is told one list for all of them.
  const rigs = Object.entries(lib.assets).filter(([, entry]) => entry.rig);
  assert.ok(rigs.length > 0, 'the library declares no rigs');

  for (const [assetPath, entry] of rigs) {
    const rig = loadRig(libraryFile(lib, assetPath, entry.version));
    assert.ok(rig, `${assetPath} did not load`);
    const composable = Object.entries(rig.poses)
      .filter(([, spec]) => !spec.generated)
      .map(([name]) => name)
      .sort();
    assert.deepEqual(
      composable,
      [...CAST_POSES].sort(),
      `${assetPath} and CAST_POSES disagree about which poses exist`,
    );
  }
});
