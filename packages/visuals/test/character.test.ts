import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  composePose,
  inkParts,
  loadRig,
  plausibilityGate,
  posePath,
  resetRigCache,
  resolveGeneratedPose,
  type CharacterRig,
  type ComposedPart,
} from '../src/character.js';
import { ctxFor } from '../src/geometry.js';
import { libraryPaths, loadLibrary, libraryFile } from '../src/library.js';
import { inkStyleFor } from '../src/style.js';
import { containsBox, padBox, pathBBox, unionBox } from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const ctx = ctxFor(style, 999);
const box = { x: 0, y: 0, w: 320, h: 400 };

const RIG_PATH = 'characters/explorer';

function shippedRig(): CharacterRig {
  const lib = loadLibrary();
  assert.ok(lib, 'the library must load');
  const rig = loadRig(libraryFile(lib, RIG_PATH, 1));
  assert.ok(rig, 'characters/explorer.v1.json must load');
  return rig;
}

/* ------------------------------------------------------------- the shipped rig */

test('the shipped rig loads, and the manifest agrees it is a rig', () => {
  const lib = loadLibrary();
  assert.ok(lib);
  const entry = lib.assets[RIG_PATH];
  assert.ok(entry, 'characters/explorer must be registered');
  assert.equal(entry.rig, true, 'without this the loader would look for a .svg');
  assert.match(libraryFile(lib, RIG_PATH, 1), /characters\/explorer\.v1\.json$/);

  const rig = shippedRig();
  assert.equal(rig.id, 'explorer');
  assert.ok(rig.seed > 0, 'seed 0 means "unseeded" to roughjs and is not reproducible');
  assert.ok(rig.look.length > 20, 'a generated variant is conditioned on this');
  for (const name of ['standing', 'walking', 'pointing', 'sitting']) {
    assert.ok(rig.poses[name], `the rig should compose ${name}`);
    assert.ok(!rig.poses[name]?.generated, `${name} must be composable with no provider`);
  }
});

/* ------------------------------------------------- the acceptance bar: identity */

test('the same character composes identically across poses', () => {
  const rig = shippedRig();
  // "The same character across three beats" — three poses, one box, as one board would.
  const poses = ['standing', 'walking', 'pointing'];
  const drawn = poses.map((p) => {
    const parts = composePose(rig, p);
    assert.ok(parts, `${p} must compose`);
    return { pose: p, paths: inkParts({ rig, parts, box, ctx, ink: 'sketch' }) };
  });

  // The head and the torso are rotated by none of these poses, so they are not merely
  // similar between beats — they are the same bytes. That is the whole claim of a rig,
  // and it is what four unrelated SVGs cannot give you.
  const groupOf = (paths: ReturnType<typeof inkParts>, part: string): string =>
    paths
      .filter((p) => p.group === `character:explorer:${part}`)
      .map((p) => p.d)
      .join('|');

  for (const part of ['head', 'torso']) {
    const first = groupOf(drawn[0]!.paths, part);
    assert.ok(first.length > 0, `${part} must be drawn`);
    for (const other of drawn.slice(1)) {
      assert.equal(
        groupOf(other.paths, part),
        first,
        `${part} differs between standing and ${other.pose} — the character changed face`,
      );
    }
  }

  // And the poses really are different poses, so the test above is not passing by drawing
  // the same picture three times.
  const legOf = (paths: ReturnType<typeof inkParts>): string => groupOf(paths, 'thighNear');
  assert.notEqual(legOf(drawn[1]!.paths), legOf(drawn[0]!.paths), 'walking must move a leg');
  assert.notEqual(
    groupOf(drawn[2]!.paths, 'armFar'),
    groupOf(drawn[0]!.paths, 'armFar'),
    'pointing must move an arm',
  );
});

test('a part is seeded by its id, so hiding a sibling changes nothing else', () => {
  const rig = shippedRig();
  const full = composePose(rig, 'standing');
  assert.ok(full);
  // The same pose with a part removed — the naive index-based seed would re-wobble
  // everything after the hole.
  const fewer = full.filter((p) => p.id !== 'armFar');
  const a = inkParts({ rig, parts: full, box, ctx, ink: 'sketch' });
  const b = inkParts({ rig, parts: fewer, box, ctx, ink: 'sketch' });
  for (const part of ['head', 'torso', 'armNear', 'thighNear', 'footNear']) {
    const pick = (paths: typeof a): string =>
      paths
        .filter((p) => p.group === `character:explorer:${part}`)
        .map((p) => p.d)
        .join('|');
    assert.equal(pick(b), pick(a), `${part} moved when an unrelated part was hidden`);
  }
});

test('composition is deterministic and stays inside the box', () => {
  const rig = shippedRig();
  for (const pose of Object.keys(rig.poses)) {
    if (rig.poses[pose]?.generated) continue;
    const once = composePose(rig, pose);
    const twice = composePose(rig, pose);
    assert.deepEqual(twice, once, `${pose} composed differently on a second call`);

    const paths = inkParts({ rig, parts: once!, box, ctx, ink: 'sketch' });
    const bounds = unionBox(paths.map((p) => pathBBox(p.d)));
    assert.ok(
      containsBox(padBox(box, style.strokeWidth * 3), bounds),
      `${pose} escaped its box: ${JSON.stringify(bounds)} — the rig viewBox is too tight`,
    );
  }
});

/* -------------------------------------------------------------- the part chain */

test('a chain carries its children: rotating a thigh moves the shin and the foot', () => {
  const rig = shippedRig();
  const rest = composePose(rig, 'standing');
  const sat = composePose(rig, 'sitting');
  assert.ok(rest && sat);
  const at = (parts: ComposedPart[], id: string): string => parts.find((p) => p.id === id)?.d ?? '';

  // `sitting` rotates the thighs only; the shins and feet carry because they hang off them.
  assert.equal(rig.poses.sitting?.compose?.shinNear, 78);
  assert.notEqual(at(sat, 'footNear'), at(rest, 'footNear'), 'the foot must follow the leg');
  // The end of the near shin should have travelled forward — that is what sitting means.
  const forward = (parts: ComposedPart[]): number => pathBBox(at(parts, 'shinNear')).x;
  assert.ok(
    forward(sat) > forward(rest) + 10,
    `the shin did not move forward: ${forward(rest)} -> ${forward(sat)}`,
  );
  assert.equal(at(sat, 'head'), at(rest, 'head'), 'the head hangs off the torso, not the legs');
});

test('a rig with a cyclic or dangling chain is refused, not half-drawn', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-rig-'));
  const base = { id: 'x', version: 1, seed: 7, look: 'x', viewBox: [0, 0, 10, 10] };
  const write = async (name: string, body: unknown): Promise<string> => {
    const file = path.join(dir, name);
    await writeFile(file, JSON.stringify(body));
    return file;
  };

  const cyclic = await write('cyclic.json', {
    ...base,
    parts: [
      { id: 'a', d: 'M0 0 L1 1', pivot: [0, 0], parent: 'b' },
      { id: 'b', d: 'M0 0 L1 1', pivot: [0, 0], parent: 'a' },
    ],
    poses: { rest: {} },
  });
  const dangling = await write('dangling.json', {
    ...base,
    parts: [{ id: 'a', d: 'M0 0 L1 1', pivot: [0, 0], parent: 'ghost' }],
    poses: { rest: {} },
  });
  const noBox = await write('nobox.json', {
    ...base,
    viewBox: [0, 0, 0, 10],
    parts: [{ id: 'a', d: 'M0 0 L1 1', pivot: [0, 0] }],
    poses: { rest: {} },
  });

  resetRigCache();
  assert.equal(loadRig(cyclic), undefined, 'a cycle would recurse forever');
  assert.equal(loadRig(dangling), undefined);
  // A missing viewBox is not cosmetic: every pose would be fitted differently and the
  // character would silently change size between beats.
  assert.equal(loadRig(noBox), undefined);
});

test('an unknown pose is refused rather than silently drawn at rest', () => {
  const rig = shippedRig();
  assert.equal(composePose(rig, 'cartwheel'), undefined);
});

/* ------------------------------------------------------- the generated-pose lane */

/** Parts that read as a plausible variant of the rest pose, for the gate to accept. */
function plausible(base: readonly ComposedPart[]): ComposedPart[] {
  return base.map((p) => ({ ...p, id: `gen-${p.id}` }));
}

test('a generated pose falls back to a composed one when nothing can generate it', async () => {
  const rig = shippedRig();
  const base = composePose(rig, 'standing');
  assert.ok(base);
  const out = await resolveGeneratedPose({
    rig,
    pose: 'thinking',
    base,
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), 'inkcast-pose-')), 'cold.svg'),
  });
  assert.equal(out, undefined, 'undefined means "compose the fallback"');
});

test('a rejected candidate is retried exactly once, then given up on', async () => {
  const rig = shippedRig();
  const base = composePose(rig, 'standing');
  assert.ok(base);
  const attempts: number[] = [];
  const out = await resolveGeneratedPose({
    rig,
    pose: 'thinking',
    base,
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), 'inkcast-pose-')), 'cold.svg'),
    generate: async ({ attempt }) => {
      attempts.push(attempt);
      // A single stroke where a whole figure was asked for: the shape of a vectoriser
      // that returned nothing usable.
      return [{ id: 'blob', d: 'M0 0 L2 0', atRest: false }];
    },
  });
  assert.deepEqual(attempts, [1, 2], 'one retry and no more — a third try holds up a render');
  assert.equal(
    out,
    undefined,
    'a rejected pose falls back rather than shipping the best of a bad set',
  );
});

test('an accepted candidate is used, and says how it was got', async () => {
  const rig = shippedRig();
  const base = composePose(rig, 'standing');
  assert.ok(base);
  let calls = 0;
  const out = await resolveGeneratedPose({
    rig,
    pose: 'thinking',
    base,
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), 'inkcast-pose-')), 'cold.svg'),
    generate: async () => {
      calls++;
      return plausible(base);
    },
  });
  assert.equal(calls, 1, 'an accepted candidate must not be generated twice');
  assert.equal(out?.how, 'generated');
  assert.ok((out?.score ?? 0) >= 0.5);
});

test('an accepted candidate is written to the cache, so the next run is free', async () => {
  const rig = shippedRig();
  const base = composePose(rig, 'standing');
  assert.ok(base);
  const cacheFile = path.join(await mkdtemp(path.join(tmpdir(), 'inkcast-pose-')), 'warm.svg');
  let calls = 0;
  const run = (): Promise<unknown> =>
    resolveGeneratedPose({
      rig,
      pose: 'thinking',
      base,
      cacheFile,
      generate: async () => {
        calls++;
        return plausible(base);
      },
    });

  const first = (await run()) as { how: string } | undefined;
  assert.equal(first?.how, 'generated');
  assert.equal(calls, 1);

  // Without the write, this lane would pay a provider on every render forever — and the
  // cache-hit branch would be dead code that looked live.
  const second = (await run()) as { how: string; parts: ComposedPart[] } | undefined;
  assert.equal(second?.how, 'cache', 'the accepted pose was not cached');
  assert.equal(calls, 1, 'the generator must not be called again');
  assert.deepEqual(
    second?.parts.map((p) => p.id),
    base.map((p) => `gen-${p.id}`),
    'the cached geometry must round-trip its part names',
  );
});

test('a rejected candidate is never cached', async () => {
  const rig = shippedRig();
  const base = composePose(rig, 'standing');
  assert.ok(base);
  const cacheFile = path.join(await mkdtemp(path.join(tmpdir(), 'inkcast-pose-')), 'cold.svg');
  await resolveGeneratedPose({
    rig,
    pose: 'thinking',
    base,
    cacheFile,
    generate: async () => [{ id: 'blob', d: 'M0 0 L2 0', atRest: false }],
  });
  // Caching a rejection would make the cache-hit branch unsafe to trust, because that
  // branch deliberately does not re-run the gate.
  assert.equal(existsSync(cacheFile), false);
});

test('a cached variant is used without calling the generator', async () => {
  const rig = shippedRig();
  const base = composePose(rig, 'standing');
  assert.ok(base);
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-pose-'));
  const cacheFile = path.join(dir, 'warm.svg');
  // Geometry is what is cached, not a rendering — so the ink style can change afterwards
  // without paying a provider again.
  await writeFile(
    cacheFile,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
      `<path data-part="body" d="M1 1 L9 9"/></svg>`,
  );
  const out = await resolveGeneratedPose({
    rig,
    pose: 'thinking',
    base,
    cacheFile,
    generate: async () => {
      throw new Error('the cache should have answered');
    },
  });
  assert.equal(out?.how, 'cache');
  assert.equal(out?.parts[0]?.id, 'body');
});

test('the cache path is per character, per pose and per seed', () => {
  const rig = shippedRig();
  const p = posePath(rig, 'thinking');
  assert.match(p, /characters[/\\]explorer[/\\]thinking-20260729\.svg$/);
  // The seed is in the filename because a rig whose seed changed is a different-looking
  // character, and serving the old variant would be serving the wrong person.
  assert.notEqual(posePath({ ...rig, seed: rig.seed + 1 }, 'thinking'), p);
});

test('the plausibility gate rejects mush and is honest about what it is', () => {
  const rig = shippedRig();
  const base = composePose(rig, 'standing');
  assert.ok(base);
  assert.equal(plausibilityGate([], base).ok, false, 'nothing at all is not a pose');
  assert.equal(
    plausibilityGate([{ id: 'x', d: 'M0 0 L1 0', atRest: false }], base).ok,
    false,
    'one short stroke where a figure was asked for',
  );
  assert.equal(plausibilityGate(base, base).ok, true, 'the base itself must pass');
  // A different *pose* of the same rig still passes: the gate is a floor on plausibility,
  // not an identity check, and it must not reject a legitimately different posture.
  const walking = composePose(rig, 'walking');
  assert.ok(walking);
  assert.equal(plausibilityGate(walking, base).ok, true);
});

/* -------------------------------------------------------- through the library lane */

test('AssetRef.variant selects a pose through the library lane', async () => {
  const standing = await libraryPaths({
    ref: { path: RIG_PATH, version: 1, variant: 'standing' },
    box,
    ctx,
  });
  const pointing = await libraryPaths({
    ref: { path: RIG_PATH, version: 1, variant: 'pointing' },
    box,
    ctx,
  });
  assert.ok(standing && pointing);
  assert.deepEqual(standing.pose, { name: 'standing', how: 'composed', requested: 'standing' });
  assert.deepEqual(pointing.pose, { name: 'pointing', how: 'composed', requested: 'pointing' });
  assert.notEqual(pointing.paths.map((p) => p.d).join(), standing.paths.map((p) => p.d).join());

  // No variant is the first composable pose, not a crash and not a generated one.
  const bare = await libraryPaths({ ref: { path: RIG_PATH, version: 1 }, box, ctx });
  assert.equal(bare?.pose?.name, 'standing');
});

test('a generated pose reports the fallback it actually drew', async () => {
  const drawn = await libraryPaths({
    ref: { path: RIG_PATH, version: 1, variant: 'thinking' },
    box,
    ctx,
  });
  assert.ok(drawn);
  // `requested` and `name` differ, which is the only place the record admits that the
  // board is showing a different posture than the storyboard asked for.
  assert.deepEqual(drawn.pose, { name: 'standing', how: 'composed', requested: 'thinking' });
  assert.ok(drawn.paths.length > 8, 'the fallback must be a whole character, not nothing');
});

test('a pose the rig does not have falls through to the other lanes', async () => {
  const drawn = await libraryPaths({
    ref: { path: RIG_PATH, version: 1, variant: 'cartwheel' },
    box,
    ctx,
  });
  assert.equal(drawn, undefined);
});
