/**
 * Compile a document or a lesson to a `storyboard.json` on disk, with no key.
 *
 *     npx tsx packages/pipeline/src/sbjson.mts examples/photosynthesis.md /tmp/photo
 *     npx tsx packages/render/src/fillcheck.mts /tmp/photo/storyboard.json
 *
 * The pixel-side verification tools — `fillcheck.mts`, `frames.mts`, `geomhash.mts` —
 * all take a project directory or a storyboard on disk, and until now the only way to get
 * one for an arbitrary document was a full four-minute `cast`. Every number this
 * repository quotes about *non-shipped* content (frame fill on the photosynthesis
 * document, for one) came from a throwaway script, which is why those numbers were
 * copied forward rather than re-measured.
 *
 * Deliberately the **no-key** path: `deriveLesson` then `compileLesson`, which is the same
 * pair `vocabcheck.mts` calls, so the two tools describe the same board. The preset is the
 * optional third argument and defaults to `standard`; pass `explainer` to compile the board
 * the studio actually casts — one wiped card a beat — which is the only way to measure a
 * shipped lesson against the gates written for that format without spending a keyed cast. It writes only the storyboard — no voice, no visuals, no render — so
 * `frames.mts` over the result draws placeholder figures. That is correct degradation
 * (see `frames.mts`), not a bug, and `fillcheck` does not care.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Lesson } from '@inkcast/core';
import { buildDoc, compileLesson, deriveLesson, PRESETS } from '@inkcast/planner';

const [file, out, preset] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: sbjson.mts <document.md | lesson.json> <outDir> [preset]');
  process.exit(2);
}

const names = Object.keys(PRESETS) as (keyof typeof PRESETS)[];
const chosen = (preset ?? 'standard') as keyof typeof PRESETS;
if (!names.includes(chosen)) {
  // Loudly rather than by falling back: a silent default would report the standard board's
  // numbers under the name of a preset nobody compiled, which is the failure this whole
  // family of tools exists to stop.
  console.error(`unknown preset "${preset}" — one of ${names.join(', ')}`);
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const lesson = file.endsWith('.json')
  ? Lesson.parse(JSON.parse(text))
  : deriveLesson(buildDoc(text, 'markdown', file), {}, PRESETS[chosen]);
const sb = compileLesson(lesson, { preset: chosen });

mkdirSync(out, { recursive: true });
const target = path.join(out, 'storyboard.json');
writeFileSync(target, `${JSON.stringify(sb, null, 1)}\n`);
console.log(`${target}\t${sb.scenes.length} scenes\t${sb.canvas.w}x${sb.canvas.h}`);
