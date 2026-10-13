/**
 * Draw a subject, look at it, and see what the correction pass changed.
 *
 *     npx tsx packages/pipeline/src/drawsheet.mts /tmp/sheet            # the twelve subjects
 *     npx tsx packages/pipeline/src/drawsheet.mts /tmp/sheet "a violin, in cross-section"
 *
 * The tool the drawing lane is judged with, and the only one that produces a picture a
 * person can look at without a lesson, a voice track or a render. For every subject it
 * writes two PNGs — the drawing as the author composed it, and the drawing after being
 * shown its own render and corrected — plus the audit score for each, so a change that
 * makes the number better and the picture worse cannot hide.
 *
 * ## Why the twelve subjects are written down here
 *
 * They are the breadth test: calculus, geometry, linear algebra, mechanics, fields, waves,
 * chemistry×2, anatomy×2, and an algorithm. It is the sheet that measured *12/12 drew* and
 * found the knee joint weak (`docs/STATUS.md`), and it was rebuilt from memory once
 * already. A breadth test rebuilt from memory measures a different thing each time, so it
 * lives in the repository now.
 *
 * ## What it costs
 *
 * One authoring call per subject the machine has never drawn (cached machine-wide by
 * instruction, so the second run is free), and one correction call per subject that has
 * something measurably wrong with it. `claude-sonnet-5` unless `INKCAST_DRAW_MODEL` says
 * otherwise. Chromium is launched once and reused.
 *
 * Frames land in `<outDir>` as `NN-slug-before.png` and `NN-slug-after.png`. **Open them.**
 * Every defect worth fixing in the drawing lane so far was visible in a frame and invisible
 * in the code.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Mark } from '@inkcast/core';
import { openDrawPreview } from './draw-preview.js';
import { loadLessonStage } from './stages.js';

/** The breadth test: twelve STEM subjects that between them need every mark there is. */
const SUBJECTS: { slug: string; instruction: string }[] = [
  {
    slug: 'calculus-area',
    instruction:
      'a curve over an x-axis with the region between the curve and the axis divided into ' +
      'several tall thin strips, showing that the strips add up to the area under the curve',
  },
  {
    slug: 'pythagoras',
    instruction:
      'a right-angled triangle with a square drawn on each of its three sides, the two ' +
      'smaller squares labelled a squared and b squared and the largest labelled c squared',
  },
  {
    slug: 'matrix-multiply',
    instruction:
      'two grids of numbers side by side and a third to their right, with a row of the ' +
      'first and a column of the second highlighted and arrows showing both feeding into ' +
      'one cell of the result',
  },
  {
    slug: 'free-body',
    instruction:
      'a block resting on a ramp with the three forces on it drawn as arrows from the ' +
      "block's centre: weight straight down, the normal force perpendicular to the ramp " +
      'surface, and friction along the surface',
  },
  {
    slug: 'magnetic-field',
    instruction:
      'a bar magnet with its north and south poles marked and field lines looping from the ' +
      'north pole around to the south pole, arrows on the lines showing the direction',
  },
  {
    slug: 'double-slit',
    instruction:
      'a barrier with two narrow slits in it, plane waves arriving from the left, circular ' +
      'wavefronts spreading from each slit, and a screen on the right showing bright and ' +
      'dark bands where they meet',
  },
  {
    slug: 'benzene',
    instruction:
      'a benzene ring: six carbons in a hexagon with alternating single and double bonds, ' +
      'and a hydrogen on each carbon',
  },
  {
    slug: 'titration',
    instruction:
      'a titration set-up: a burette clamped above a conical flask, the tap part way down ' +
      'the burette, a drop falling from its tip into the liquid in the flask',
  },
  {
    slug: 'heart',
    instruction:
      'a heart in cross-section showing all four chambers, the septum between the left and ' +
      'right sides, the valves between each atrium and ventricle, and arrows for the ' +
      'direction blood flows through it',
  },
  {
    slug: 'neuron',
    instruction:
      'a neuron: a cell body with branching dendrites on one side, a long axon leaving the ' +
      'other side, a myelin sheath in segments along the axon, and terminals at the far end',
  },
  {
    slug: 'knee-joint',
    instruction:
      'a knee joint from the side: the thigh bone above, the shin bone below, the kneecap ' +
      'in front, cartilage where the bones meet, and the ligament joining them',
  },
  {
    slug: 'binary-search',
    instruction:
      'a row of boxes holding numbers in increasing order, with a marker on the middle box ' +
      'and the half of the row that can be discarded crossed out',
  },
];

const [outArg, ...extra] = process.argv.slice(2);
if (!outArg) {
  console.error('usage: drawsheet.mts <outDir> [instruction…]');
  process.exit(2);
}
const outDir = path.resolve(outArg);
await mkdir(outDir, { recursive: true });

// Keys the way `drawcheck.mts` gets them: by path, so this tool adds no dependency.
const vaultSpecifier = new URL('../../keyvault/src/index.ts', import.meta.url).href;
try {
  const kv = (await import(vaultSpecifier)) as { hydrateEnv(): Promise<{ injected: string[] }> };
  console.log(`keys: injected ${(await kv.hydrateEnv()).injected.join(', ') || 'none'}`);
} catch (err) {
  console.log(`keys: the vault could not be read (${String(err)}) — using the environment`);
}

const stage = await loadLessonStage();
const NEEDED = ['drawOne', 'auditDrawing', 'defectScore', 'defectSummary', 'prepareMarks'];
const missing = NEEDED.filter(
  (fn) => typeof (stage as unknown as Record<string, unknown>)[fn] !== 'function',
);
if (missing.length) {
  // `loadLessonStage` checks the lesson contract, not the drawing lane's, so this tool
  // checks what it actually calls rather than failing later with a TypeError.
  console.error(`@inkcast/planner does not export ${missing.join(', ')} — the lane moved.`);
  process.exit(1);
}
const planner = stage as unknown as {
  drawOne(
    instruction: string,
    opts: {
      preview?: (marks: unknown[]) => Promise<Uint8Array | undefined>;
      revise?: boolean;
    },
  ): Promise<Mark[] | undefined>;
  auditDrawing(marks: Mark[]): { kind: string; note: string }[];
  defectScore(defects: { kind: string }[]): number;
  defectSummary(defects: { kind: string }[]): string;
  prepareMarks(marks: Mark[]): Mark[];
};

const jobs = extra.length
  ? extra.map((instruction, i) => ({ slug: `subject-${i + 1}`, instruction }))
  : SUBJECTS;

const drawing = openDrawPreview();
const score = (marks: Mark[]): number =>
  planner.defectScore(planner.auditDrawing(planner.prepareMarks(marks)));
const summary = (marks: Mark[]): string =>
  planner.defectSummary(planner.auditDrawing(planner.prepareMarks(marks)));

let improved = 0;
let unchanged = 0;
const rows: string[] = [];

try {
  for (const [i, job] of jobs.entries()) {
    const n = String(i + 1).padStart(2, '0');
    // The author's own attempt first, with the correction pass held off, so there is a
    // before to compare against and to look at.
    const before = await planner.drawOne(job.instruction, { revise: false });
    if (!before?.length) {
      rows.push(`${n} ${job.slug.padEnd(16)} FAILED TO DRAW`);
      continue;
    }
    const after = (await planner.drawOne(job.instruction, { preview: drawing.preview })) ?? before;

    for (const [label, marks] of [
      ['before', before],
      ['after', after],
    ] as const) {
      const png = await drawing.preview(planner.prepareMarks(marks));
      if (png) await writeFile(path.join(outDir, `${n}-${job.slug}-${label}.png`), png);
    }

    const a = score(before);
    const b = score(after);
    if (b < a) improved += 1;
    else unchanged += 1;
    rows.push(
      `${n} ${job.slug.padEnd(16)} ${String(before.length).padStart(2)}→${String(
        after.length,
      ).padStart(2)} marks   score ${String(a).padStart(3)} → ${String(b).padStart(3)}   ${summary(
        after,
      )}`,
    );
    console.log(rows[rows.length - 1]);
  }
} finally {
  await drawing.close();
}

console.log(`\n${rows.join('\n')}`);
console.log(`\n${improved} improved, ${unchanged} left as drawn · frames in ${outDir}`);
console.log('Open them. A clean audit is not the same as a good drawing.');
