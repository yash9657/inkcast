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
 * Deliberately the **no-key** path: `deriveLesson` then `compileLesson` at the standard
 * preset, which is the same pair `vocabcheck.mts` calls, so the two tools describe the
 * same board. It writes only the storyboard — no voice, no visuals, no render — so
 * `frames.mts` over the result draws placeholder figures. That is correct degradation
 * (see `frames.mts`), not a bug, and `fillcheck` does not care.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Lesson } from '@inkcast/core';
import { buildDoc, compileLesson, deriveLesson, PRESETS } from '@inkcast/planner';

const [file, out] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: sbjson.mts <document.md | lesson.json> <outDir>');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const lesson = file.endsWith('.json')
  ? Lesson.parse(JSON.parse(text))
  : deriveLesson(buildDoc(text, 'markdown', file), {}, PRESETS.standard);
const sb = compileLesson(lesson, {});

mkdirSync(out, { recursive: true });
const target = path.join(out, 'storyboard.json');
writeFileSync(target, `${JSON.stringify(sb, null, 1)}\n`);
console.log(`${target}\t${sb.scenes.length} scenes\t${sb.canvas.w}x${sb.canvas.h}`);
