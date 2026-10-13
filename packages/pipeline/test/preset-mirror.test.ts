/**
 * `stages.ts`'s `PresetName` against the planner's real `PRESETS`.
 *
 * This test exists because the mirror drifted and cost the launch a feature. `explainer`
 * was added to `planner/src/presets.ts` and not to `pipeline/src/stages.ts`, so
 * `CastInput.preset` — which is that union — could not hold the value. The hosted format
 * cap in `apps/web/lib/jobs.ts` was written, exported and unit-tested against a preset the
 * pipeline had no name for, and the failure surfaced only when a route finally tried to
 * pass it: `Type '"explainer"' is not assignable to type 'PresetName | undefined'`.
 *
 * Why a test rather than a type import. `stages.ts`'s header makes a deliberate case for
 * declaring stage signatures instead of importing them — the CLI has to print help, list
 * projects and serve a preview while a stage package is still installing, and one
 * unresolvable specifier in the stage contract takes all of that down. A test gets the
 * same guarantee without the coupling, because it runs in an environment where the planner
 * is definitely present.
 *
 * Both directions are asserted, and that is not belt-and-braces. A missing name is the bug
 * above: a preset the pipeline cannot be handed. A *surplus* name is the opposite and is
 * quieter — `resolvePreset` would be given a key `PRESETS` has no entry for, and the
 * planner reads that map with a bare index, so the payload is `undefined` and the first
 * symptom is a property access somewhere deep in layout rather than a rejected argument.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PRESETS } from '@inkcast/planner';
import type { PresetName } from '../src/stages.js';

/*
 * The mirror, restated as a value so it can be compared at runtime.
 *
 * `Record<PresetName, true>` is what does the work: an exhaustive keyed record cannot be
 * built with a member missing, so *adding* a name to `stages.ts` without adding it here is
 * a compile error in this file, and the array below can never be a stale subset of the
 * union it is supposed to represent. The runtime assertions then carry it the rest of the
 * way, to the planner.
 */
const MIRRORED: Record<PresetName, true> = {
  standard: true,
  short: true,
  square: true,
  explainer: true,
  deepdive: true,
};

const mirrored = Object.keys(MIRRORED).sort();

test('every preset the planner defines can be named by the pipeline', () => {
  const real = Object.keys(PRESETS).sort();
  const missing = real.filter((name) => !mirrored.includes(name));
  assert.deepEqual(
    missing,
    [],
    `packages/pipeline/src/stages.ts's PresetName is missing ${missing.join(', ')}. ` +
      'Until it is added, CastInput.preset cannot hold that value and no caller can ' +
      'select the preset — which is exactly how `explainer` shipped unreachable.',
  );
});

test('the pipeline names no preset the planner does not define', () => {
  const real = Object.keys(PRESETS);
  const surplus = mirrored.filter((name) => !real.includes(name));
  assert.deepEqual(
    surplus,
    [],
    `packages/pipeline/src/stages.ts's PresetName offers ${surplus.join(', ')}, which ` +
      'PRESETS has no entry for. A caller passing it reaches resolvePreset with a key ' +
      'that indexes to undefined, and the error surfaces far from the argument.',
  );
});

test('explainer in particular, because it is the hosted cap', () => {
  // Named on its own rather than left to the set comparison above: this is the preset the
  // studio pins for every hosted render (`hostedFormat()`), and the two facts the copy and
  // the queue arithmetic both depend on are that it exists and that it is 75 seconds long.
  // `HOSTED_PRESET_SEC` in `apps/web/lib/jobs.ts` mirrors that number for copy it cannot
  // otherwise reach, and `apps/web`'s own tests pin the mirror; this is the other end.
  assert.ok(mirrored.includes('explainer'), 'the pipeline must be able to name explainer');
  assert.equal(PRESETS.explainer.maxSeconds, 75);
});
