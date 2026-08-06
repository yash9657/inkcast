/**
 * The same beat, drawn both ways: composed marks against a diffusion model.
 *
 *     npx tsx packages/pipeline/src/lanesheet.mts <projectDir> <beatIndex> <outDir>
 *
 * The lesson author picks one lane per beat and never runs the other, so nothing in a
 * finished film compares them. This takes a beat's `describe` **verbatim** — the same
 * words, the same beat, the same lesson — and renders it through both: the marks the
 * author composed, and `generateIllustration` with the image lane's own prompt shaping.
 *
 * Costs one image call. Everything else is local.
 *
 * The point is not to declare a winner in general. It is that the two lanes fail
 * *differently*: `docs/PIPELINE.md` records that an image model cannot spell, cannot draw
 * a relation and cannot draw a change, and a subject whose likeness is the whole point is
 * exactly where those limits stop mattering. Anatomy is the strongest case anyone has for
 * the image lane, so it is the case worth looking at.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Lesson } from '@inkcast/core';
import { generateIllustration, illustrationPrompt } from '@inkcast/visuals';
import { openDrawPreview } from './draw-preview.js';

const [dir, indexArg, out = '/tmp/lanes'] = process.argv.slice(2);
if (!dir || indexArg === undefined) {
  console.error('usage: lanesheet.mts <projectDir> <beatIndex> [outDir]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

// By path, not by package name, and computed so `tsc` never tries to resolve it — the
// same seam `drawcheck.mts` uses, and for the same reason: `@inkcast/keyvault` is a
// dependency of the CLI and the studio, not of this package. Without this the image key
// is in the macOS keychain, the environment is empty, and the lane under test reports
// itself unavailable — which reads exactly like the model refusing to draw.
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

const lesson = Lesson.parse(JSON.parse(readFileSync(path.join(dir, 'lesson.json'), 'utf8')));
const beats = [
  lesson.hook,
  lesson.anchor,
  ...(lesson.steps ?? []),
  lesson.worked,
  lesson.misconception,
  lesson.recap,
].filter(Boolean);

const beat = beats[Number(indexArg)];
const intent = beat?.visuals?.[0];
if (!intent) {
  console.error(`beat ${indexArg} has no visual`);
  process.exit(1);
}

console.log(`beat ${indexArg}: ${beat?.idea ?? ''}`);
console.log(`describe: ${intent.describe}\n`);
console.log(`the image lane will actually be sent:\n  ${illustrationPrompt(intent.describe)}\n`);

/* --- the lane the author chose --- */

const handle = openDrawPreview({ style: 'marker', palette: 'color' });
try {
  const png = await handle.preview((intent.marks ?? []) as never);
  if (png) {
    writeFileSync(path.join(out, 'drawn.png'), png);
    console.log(`${path.join(out, 'drawn.png')}\t${intent.marks?.length ?? 0} composed marks`);
  } else {
    console.log('no composed marks on this beat, or no Chromium');
  }
} finally {
  await handle.close();
}

/* --- the lane it did not --- */

const raster = await generateIllustration(intent.describe);
if (!raster) {
  console.error('no image came back — is FAL_KEY or REPLICATE_API_TOKEN set?');
  process.exit(1);
}
writeFileSync(path.join(out, 'diffusion.png'), raster);
console.log(`${path.join(out, 'diffusion.png')}\t${(raster.length / 1024).toFixed(0)} kB`);
