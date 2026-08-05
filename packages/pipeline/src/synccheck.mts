/**
 * What the board draws, against the word being spoken at that instant.
 *
 *     npx tsx packages/pipeline/src/synccheck.mts <projectDir>
 *
 * The measurement that named the sync defect. A lesson asks for one picture on one cue;
 * the compiler explodes it into strokes; the voice stage resolves each to a real time. This
 * reads the finished `storyboard.json` and `audio/*.timing.json` of a rendered project and
 * prints, per beat, every element in drawing order with the words being said as it appears
 * — plus the two failures worth counting: strokes landing in a silence, and strokes landing
 * on the same frame as another.
 *
 * Needs a project the voice stage has run over, because that is where real times come from.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseStoryboard } from '@inkcast/core';

const dir = process.argv[2];
if (!dir) throw new Error('usage: synccheck.mts <projectDir>');
const sb = parseStoryboard(JSON.parse(readFileSync(path.join(dir, 'storyboard.json'), 'utf8')));

let silent = 0;
let collided = 0;
let total = 0;
for (const [i, scene] of sb.scenes.entries()) {
  const t = JSON.parse(
    readFileSync(
      path.join(dir, 'audio', `scene-${String(i).padStart(3, '0')}.timing.json`),
      'utf8',
    ),
  ) as { narrationSec: number; words: { word: string; start: number; end: number }[] };
  console.log(`\n=== ${scene.id} ${scene.role ?? ''} ${t.narrationSec.toFixed(2)}s`);
  console.log(`    "${scene.narration}"`);
  const at = (el: (typeof scene.elements)[number]) => el.enter.at * t.narrationSec;
  const rows = [...scene.elements].sort((a, b) => at(a) - at(b));
  let last = -1;
  for (const el of rows) {
    const sec = at(el);
    const said = t.words.filter((w) => w.start <= sec && sec <= w.end + 0.2).map((w) => w.word);
    const gap = said.length === 0;
    const same = last >= 0 && sec - last < 0.05;
    total += 1;
    if (gap) silent += 1;
    if (same) collided += 1;
    last = sec;
    console.log(
      `  ${sec.toFixed(2).padStart(6)}s ${el.id.padEnd(20)} ${el.type.padEnd(8)}` +
        `${gap ? ' [SILENCE]' : ''}${same ? ' [SAME FRAME]' : ''}  ${said.join(' ') || '—'}`,
    );
  }
}
console.log(
  `\n${total} elements: ${silent} land in a silence, ${collided} land on the same frame as the one before`,
);
