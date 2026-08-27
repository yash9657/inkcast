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
 *
 * ## The fill column, and why it is printed rather than gated
 *
 * `fill` is `cardFill`: the share of the film's frame this drawing is predicted to carry
 * once it is a card on the board, from the marks alone. It is the drawing lane's half of
 * gate 1, and it is here because it is the only number in the lane that moves when a brief
 * asks for a fuller board — the defect score does not, and a lane whose drawings got thinner
 * for three weeks measured perfectly clean throughout.
 *
 * It is printed beside the defect score and **not** as a target to be maximised. `cover` is a
 * union of bounding boxes, so one long diagonal line covers its whole box here and a few
 * units of ink on the board: a change that raises the mean while making the pictures worse is
 * available to anyone who goes looking for it, and the only defence is the frames.
 */
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Mark } from '@inkcast/core';
import { Lesson, Mark as MarkSchema, lessonBeats } from '@inkcast/core';
import { z } from 'zod';
import { auditDrawing, defectScore, defectSummary } from './draw-audit.js';
import { cardFill } from './draw-geom.js';
import { cleanMarks, prepareMarks } from './drawing.js';
import type { Box } from './elements.js';
import { readInkBox } from './underlay.js';

/**
 * `underlay` is the picture these marks are composed over, and it has to travel with them.
 * Two checks read it — a name written across a traced heart is a defect only if the audit
 * knows the heart is there, and a card is only thin if nothing else is filling it — so a
 * sheet that dropped it reported the figure lane's four-mark cards as thin boards and the
 * hybrid lane's cleanest names as clean.
 */
type Drawing = { name: string; marks: Mark[]; underlay?: Box };

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
    // The cache holds marks and nothing else, so a drawing composed over a picture cannot be
    // told from one composed on a blank board here. That is a real limit of `cache` mode and
    // the reason the per-lesson mode below exists: `lesson.json` carries the underlay.
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
      if (intent.marks?.length)
        out.push({
          name: `${base} b${b}v${v}`,
          marks: intent.marks,
          underlay: readInkBox(intent.underlay?.inkBox),
        });
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

const fills: number[] = [];

for (const { name, marks, underlay } of drawings) {
  const raw = auditDrawing(cleanMarks(marks), underlay);
  const kept = auditDrawing(prepareMarks(marks, underlay), underlay);
  const card = cardFill(prepareMarks(marks, underlay));
  if (card) fills.push(card.fill);
  rawTotal += defectScore(raw);
  keptTotal += defectScore(kept);
  if (kept.length) dirty += 1;
  for (const d of kept) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
  const n = (v: number): string => String(v).padStart(3);
  const share = (v: number): string => `${Math.round(v * 100)}%`.padStart(4);
  console.log(
    `${name.padEnd(22)} ${String(marks.length).padStart(2)} marks  raw ${n(
      defectScore(raw),
    )}  kept ${n(defectScore(kept))}  ` +
      (card
        ? `cover ${share(card.cover)}  shape ${share(card.shape)}  fill ${share(card.fill)}  `
        : '') +
      defectSummary(kept),
  );
  for (const d of kept) console.log(`    ${d.kind}: ${d.note}`);
}

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;
console.log(`\n${drawings.length} drawings · defect score ${rawTotal} raw -> ${keptTotal} kept`);
if (fills.length)
  console.log(
    `predicted card fill: mean ${(mean(fills) * 100).toFixed(0)}% · median ` +
      `${(median(fills) * 100).toFixed(0)}% · ${fills.filter((f) => f < 0.22).length} of ` +
      `${fills.length} under the 22% a card has to clear not to read as paper`,
  );
console.log(
  `${dirty}/${drawings.length} still measurably wrong after the free repair` +
    (kinds.size ? `: ${[...kinds].map(([k, v]) => `${k}×${v}`).join('  ')}` : ''),
);
