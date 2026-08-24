/**
 * Which technical terms a video says out loud, and which of them it ever writes down.
 *
 *     npx tsx packages/pipeline/src/vocabcheck.mts <project>/storyboard.json
 *     npx tsx packages/pipeline/src/vocabcheck.mts examples/photosynthesis.md
 *     npx tsx packages/pipeline/src/vocabcheck.mts examples/lessons/longitude.lesson.json
 *
 * The measurement that named the defect: on a photosynthesis render, 11 of 14 technical
 * terms were spoken and never drawn, and the 51 words that *were* on the board were beat
 * headings, three of them the identical string. That number came from four lines over
 * `storyboard.json` typed at a shell, so it was not repeatable and nobody could check the
 * next render against it. This is those four lines, kept.
 *
 * Sub-second, and it takes whatever you have: a finished `storyboard.json` from any
 * project (including a keyed render), a `lesson.json`, or a raw document — which it
 * ingests and compiles through the **no-key** authors, so the number it reports for a
 * document is the honest floor rather than the model's ceiling.
 *
 * Read it as a floor, not a target. `findTerms` is a form-based detector (see
 * `@inkcast/core/terms`): it is deliberately loose on its third rule, so "spoken terms"
 * includes a few long words that are not really vocabulary. What matters is the ratio and
 * the specific words in the `unwritten` column — a real term in that column is a defect,
 * and there is no arguing with an initialism in it.
 *
 * Lives in `pipeline` for the same reason `sbhash.mts` does: it is the only package that
 * depends on both the lesson schema and the compiler. Committed, not scratch, because
 * `git stash -u` takes an untracked measurement tool with it at exactly the moment it is
 * needed.
 */
import { readFile } from 'node:fs/promises';
import type { Storyboard } from '@inkcast/core';
import { Lesson, findTerms, parseStoryboard, sameTerm } from '@inkcast/core';
import { buildDoc, compileLesson, deriveLesson, PRESETS } from '@inkcast/planner';

const file = process.argv[2];
if (!file) {
  console.error('usage: vocabcheck.mts <storyboard.json | lesson.json | document.md>');
  process.exit(2);
}

const source = await readFile(file, 'utf8');

/** A storyboard, from whichever of the three inputs was handed over. */
async function boardFrom(text: string): Promise<Storyboard> {
  if (!file!.endsWith('.json')) {
    const doc = buildDoc(text, 'markdown', file);
    return compileLesson(deriveLesson(doc, {}, PRESETS.standard), {});
  }
  const raw: unknown = JSON.parse(text);
  if (raw && typeof raw === 'object' && 'scenes' in raw) return parseStoryboard(raw);
  return compileLesson(Lesson.parse(raw), {});
}

const sb = await boardFrom(source);

/** Every word the board writes, wherever it writes it. */
const ink: string[] = [];
for (const scene of sb.scenes) {
  for (const el of scene.elements) {
    if (el.type === 'text') ink.push(el.text);
    if (el.type === 'equation') ink.push(el.tex);
    if (el.type === 'code') ink.push(el.code);
    if (el.type === 'diagram') ink.push(el.nodes.map((n) => n.label).join(' '));
    if (el.type === 'arrow' && el.label) ink.push(el.label);
  }
}

const words = (s: string): number => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
const spokenWords = sb.scenes.reduce((n, s) => n + words(s.narration), 0);
const drawnWords = ink.reduce((n, s) => n + words(s), 0);

/** One row per beat: what it said that counts as a term, and whether anything drew it. */
const rows: { scene: string; term: string; kind: string; written: boolean }[] = [];
const seen: string[] = [];
for (const scene of sb.scenes) {
  for (const term of findTerms(scene.narration)) {
    if (seen.some((s) => sameTerm(s, term.text))) continue;
    seen.push(term.text);
    rows.push({
      scene: scene.id,
      term: term.text,
      kind: term.kind,
      written: ink.some((text) => sameTerm(text, term.text)),
    });
  }
}

for (const row of rows) {
  const mark = row.written ? 'written  ' : 'UNWRITTEN';
  console.log(`${mark}  ${row.scene.padEnd(4)} ${row.kind.padEnd(10)} ${row.term}`);
}

const written = rows.filter((r) => r.written).length;
const certain = rows.filter((r) => r.kind !== 'word');
const certainWritten = certain.filter((r) => r.written).length;
console.log(
  `\n${written} of ${rows.length} spoken terms are on the board ` +
    `(${certainWritten} of ${certain.length} initialisms and names)\n` +
    `${spokenWords} words spoken, ${drawnWords} words drawn, across ${sb.scenes.length} scenes`,
);
