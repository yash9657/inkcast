/**
 * How much of a beat the board is actually drawing through.
 *
 *     npx tsx packages/pipeline/src/tandemcheck.mts projects/try
 *
 * `synccheck.mts` answers "what word was being said when this stroke landed", which is
 * the right question once the strokes are spread out. This answers the one before it:
 * **are they spread out at all?** The shipped film's recap drew thirty elements between
 * 6.3s and 9.2s of a 9.9s beat — every one of them correctly cued, by `synccheck`'s
 * measure, to a phrase in the narration, because they were all cued to the *same* phrase.
 * A tool that only checks each stroke against its own word cannot see that.
 *
 * So this measures the drawing as a whole, per beat:
 *
 *  - **span** — first stroke to last, as a share of the narration. A picture drawn
 *    alongside its explanation covers most of the beat; one that arrives as a paste
 *    covers almost none of it.
 *  - **lead** — dead air before the first stroke, as a share. The board sitting empty
 *    while the narrator explains what is about to be on it.
 *  - **distinct** — how many separate moments the beat's elements resolved to, against
 *    how many elements there are. Ten elements on one moment is one moment, however far
 *    apart `spreadGesture` then steps them.
 *
 * It recompiles the storyboard from the project's own `lesson.json` and resolves cues
 * against the project's **measured** `audio/*.timing.json`, so it re-measures a planner
 * change against real speech without a key, a network call or a re-render. The narration
 * is what it always was — only where the strokes land moves.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Lesson } from '@inkcast/core';
import { compileLesson } from '@inkcast/planner';
import { resolveSceneCues } from '@inkcast/voice';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: tandemcheck.mts <projectDir>');
  process.exit(2);
}

const lesson = Lesson.parse(JSON.parse(readFileSync(path.join(dir, 'lesson.json'), 'utf8')));
const sb = compileLesson(lesson, {});

type Timing = {
  narrationSec: number;
  phrases: {
    text: string;
    sentence: number;
    endsSentence: boolean;
    sentenceWords: number;
    start: number;
    end: number;
  }[];
  words?: { word: string; start: number; end: number }[];
};

const pct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);

let spanSum = 0;
let leadSum = 0;
let beats = 0;
let elements = 0;
let moments = 0;
let unresolved = 0;

for (const [i, scene] of sb.scenes.entries()) {
  const file = path.join(dir, 'audio', `scene-${String(i).padStart(3, '0')}.timing.json`);
  let timing: Timing;
  try {
    timing = JSON.parse(readFileSync(file, 'utf8')) as Timing;
  } catch {
    console.log(`${scene.id}\tno timing on disk — skipped`);
    continue;
  }

  const { warnings } = resolveSceneCues(scene, {
    phrases: timing.phrases,
    narrationSec: timing.narrationSec,
    words: timing.words,
    sceneLabel: scene.id,
  });
  unresolved += warnings.length;

  // The picture, not the furniture: the beat's caption and its vocabulary strip are
  // placed by the compiler and are not what "does the drawing keep up" is asking about.
  const drawing = scene.elements.filter((el) => /_v\d+_/.test(el.id));
  if (!drawing.length) continue;

  const ats = drawing.map((el) => el.enter.at).sort((a, b) => a - b);
  const first = ats[0] as number;
  const last = ats[ats.length - 1] as number;
  const distinct = new Set(ats.map((a) => a.toFixed(2))).size;

  spanSum += last - first;
  leadSum += first;
  beats += 1;
  elements += drawing.length;
  moments += distinct;

  console.log(
    `${scene.id.padEnd(4)} ${String(drawing.length).padStart(3)} marks  ` +
      `lead ${pct(first)}  span ${pct(last - first)}  ` +
      `${String(distinct).padStart(3)} distinct moments`,
  );
}

if (!beats) {
  console.log('no beat had both a drawing and a measured timing');
  process.exit(0);
}

console.log(
  `\n${beats} beats · ${elements} drawn elements\n` +
    `mean lead  ${pct(leadSum / beats)}   (dead board before the first stroke)\n` +
    `mean span  ${pct(spanSum / beats)}   (first stroke to last)\n` +
    `moments    ${moments}/${elements} = ${pct(moments / elements)} distinct\n` +
    `${unresolved} cue(s) did not resolve`,
);
