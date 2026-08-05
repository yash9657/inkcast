/**
 * What is measurably wrong with the drawings, and what the free repair pass fixes.
 *
 *     npx tsx packages/planner/src/markcheck.mts cache            # every cached drawing
 *     npx tsx packages/planner/src/markcheck.mts a.lesson.json …  # the drawings in a lesson
 *
 * The cheapest tool that can see a change to the drawing lane: no key, no network, no
 * renderer, ~50ms for the whole machine-wide cache. Two columns per drawing — the score
 * before the mechanical repair and after it — because they answer different questions.
 * `raw` is how well the author placed its marks, and `kept` is what a viewer would still
 * see, which is the number that decides whether a drawing is worth a model's attention.
 *
 * A defect here is arithmetic (see `draw-audit.ts`); it is not a judgement about whether
 * the picture teaches. A clean sheet does not mean the drawings are good, only that
 * nothing is provably broken — so look at the frames as well:
 *
 *     npx tsx packages/render/src/frames.mts <projectDir> <outDir>
 */
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Mark } from '@inkcast/core';
import { Lesson, Mark as MarkSchema, lessonBeats } from '@inkcast/core';
import { z } from 'zod';
import { auditDrawing, defectScore, defectSummary } from './draw-audit.js';
import { cleanMarks, prepareMarks } from './drawing.js';

type Drawing = { name: string; marks: Mark[] };

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: markcheck.mts cache | <lesson.json>…');
  process.exit(2);
}

async function fromCache(): Promise<Drawing[]> {
  const dir = path.join(os.homedir(), '.inkcast/cache/drawings');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const out: Drawing[] = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    const parsed = z.array(MarkSchema).safeParse(raw);
    if (parsed.success) out.push({ name: f.replace(/\.json$/, ''), marks: parsed.data });
  }
  return out;
}

async function fromLesson(file: string): Promise<Drawing[]> {
  const lesson = Lesson.parse(JSON.parse(await readFile(file, 'utf8')));
  const base = path.basename(file).replace(/\.lesson\.json$/, '');
  const out: Drawing[] = [];
  lessonBeats(lesson).forEach((beat, b) => {
    beat.step.visuals.forEach((intent, v) => {
      if (intent.marks?.length) out.push({ name: `${base} b${b}v${v}`, marks: intent.marks });
    });
  });
  return out;
}

const drawings: Drawing[] = [];
for (const arg of args) {
  drawings.push(...(arg === 'cache' ? await fromCache() : await fromLesson(arg)));
}
if (!drawings.length) {
  console.log('no drawings found — a lesson written before the drawing lane has no marks');
  process.exit(0);
}

let rawTotal = 0;
let keptTotal = 0;
let dirty = 0;
const kinds = new Map<string, number>();

for (const { name, marks } of drawings) {
  const raw = auditDrawing(cleanMarks(marks));
  const kept = auditDrawing(prepareMarks(marks));
  rawTotal += defectScore(raw);
  keptTotal += defectScore(kept);
  if (kept.length) dirty += 1;
  for (const d of kept) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
  const n = (v: number): string => String(v).padStart(3);
  console.log(
    `${name.padEnd(22)} ${String(marks.length).padStart(2)} marks  raw ${n(
      defectScore(raw),
    )}  kept ${n(defectScore(kept))}  ${defectSummary(kept)}`,
  );
  for (const d of kept) console.log(`    ${d.kind}: ${d.note}`);
}

console.log(`\n${drawings.length} drawings · defect score ${rawTotal} raw -> ${keptTotal} kept`);
console.log(
  `${dirty}/${drawings.length} still measurably wrong after the free repair` +
    (kinds.size ? `: ${[...kinds].map(([k, v]) => `${k}×${v}`).join('  ')}` : ''),
);
