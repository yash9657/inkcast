/**
 * Resolve the visuals stage over a storyboard on disk, with the keyvault hydrated — so
 * the illustration lane really generates, and the drawings can be **looked at**.
 *
 * The gap this fills: every other tool here is downstream of a drawing or upstream of
 * one. `libsheet.mts` renders a *library* asset, `geomhash.mts` hashes what resolved,
 * `frames.mts` needs a project the whole pipeline has already run over. None of them can
 * answer the only question that matters about the generated lane — *is the drawing any
 * good* — without a four-minute keyed `cast`. This runs the visuals stage alone against a
 * storyboard `sbjson.mts` produced in a second, and it costs one image per asset
 * (~$0.003 each on fal) instead of a lesson and a voice track.
 *
 *     npx tsx packages/pipeline/src/sbjson.mts <lesson.json> /tmp/board
 *     npx tsx packages/pipeline/src/drawcheck.mts /tmp/board
 *     # then open /tmp/board/assets/illustrations/*.png and judge them
 *
 * Keys come from the keyvault the same way the CLI gets them, which is why this lives in
 * `pipeline` and imports `@inkcast/keyvault` through a computed specifier: the vault is
 * the CLI's dependency, not this package's, and a verification tool should not add one.
 * Without a key it still runs — every asset falls to the library, the icon set and then a
 * lettered card, which is itself worth looking at.
 *
 * It writes `storyboard.resolved.json` beside the input and leaves `storyboard.json`
 * alone. Copy the resolved one over it to point `frames.mts` at the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseStoryboard, type Storyboard } from '@inkcast/core';
import { loadVisuals } from './stages.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: drawcheck.mts <projectDir>   (a dir holding storyboard.json)');
  process.exit(2);
}
const projectDir = path.resolve(dir);

// By path, not by package name, and computed so `tsc` never tries to resolve it:
// `@inkcast/keyvault` is a dependency of the CLI and the studio, not of this package, and
// a verification tool has no business adding one. In a checkout the path is exact.
const vaultSpecifier = new URL('../../keyvault/src/index.ts', import.meta.url).href;
try {
  const kv = (await import(vaultSpecifier)) as {
    hydrateEnv(): Promise<{ injected: string[]; fromEnv: string[]; missing: string[] }>;
  };
  const hydrated = await kv.hydrateEnv();
  console.log(`keys: injected ${hydrated.injected.join(', ') || 'none'}`);
} catch (err) {
  console.log(`keys: the vault could not be read (${String(err)}) — using the environment`);
}

const sb = parseStoryboard(
  JSON.parse(readFileSync(path.join(projectDir, 'storyboard.json'), 'utf8')),
);
const { resolveVisuals } = await loadVisuals();
// The stage loader types its return `unknown` — it is a dynamic import behind a
// capability check, not a static dependency — and the storyboard it hands back is the
// one that went in, enriched.
const out = (await resolveVisuals(sb, projectDir, {})) as Storyboard;

const target = path.join(projectDir, 'storyboard.resolved.json');
writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);
for (const a of out.assets ?? []) {
  console.log(`ASSET\t${a.id}\t${a.source ?? '-'}\t${a.svg ?? '-'}`);
}
console.log(`${target}\t${(out.assets ?? []).length} assets`);
