/**
 * Which lane every beat of a lesson chose, and whether it got its own picture.
 *
 *     npx tsx packages/planner/src/lanecheck.mts <lesson.json>
 *
 * Free, no key, no browser. Two questions nothing else in the repo can answer:
 *
 * **Did each beat that asked for a picture get its own?** `projects/cardiac5` asked for a
 * cut-open heart on the two beats that most needed one — the bundle of His down the septum,
 * and the Purkinje fibres — and both were silently handed the external silhouette generated
 * for an earlier beat, because `underlayAsset` slugged four words and the two prompts share
 * their first four. Nothing logged it, no audit could see it, and it cost the film its two
 * best cards. `underlayAsset` is total over the prompt now, and this is the check that says
 * so on a real lesson rather than in a unit test.
 *
 * **What is the lane split on a topic nobody has seen?** The plan in
 * `docs/PLAN-FIGURE-LANE.md` turns on the lesson author choosing the figure lane for things
 * with a form and the ink lane for relations, quantities and change. That choice is a brief,
 * and a brief is unmeasured until something counts what it produced. Run this on a lesson
 * from a topic you have not tried and read the split before watching the film.
 */
import { readFileSync } from 'node:fs';
import { Lesson, type VisualIntent } from '@inkcast/core';
import { underlayAsset } from './underlay.js';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: lanecheck.mts <lesson.json>');
  process.exit(2);
}

const lesson = Lesson.parse(JSON.parse(readFileSync(file, 'utf8')));

/** Every beat in spoken order, named the way the lesson names it. */
const beats: { name: string; visuals: VisualIntent[] }[] = [
  ...(lesson.hook ? [{ name: 'hook', visuals: lesson.hook.visuals }] : []),
  ...(lesson.anchor ? [{ name: 'anchor', visuals: lesson.anchor.visuals }] : []),
  ...lesson.steps.map((s, i) => ({ name: `step${i}`, visuals: s.visuals })),
  ...(lesson.worked ? [{ name: 'worked', visuals: lesson.worked.visuals }] : []),
  ...(lesson.misconception
    ? [{ name: 'misconception', visuals: lesson.misconception.visuals }]
    : []),
  ...(lesson.recap ? [{ name: 'recap', visuals: lesson.recap.visuals }] : []),
];

const lanes = new Map<string, number>();
/** asset id → the distinct prompts that resolved to it. More than one is the old bug. */
const byId = new Map<string, Set<string>>();
/** prompt → the beats that asked for it. More than one is reuse, which may be intended. */
const byPrompt = new Map<string, string[]>();

console.log(`${lesson.topic}\n`);
for (const beat of beats) {
  for (const v of beat.visuals) {
    const lane = v.underlay ? `${v.kind}+underlay` : v.kind;
    lanes.set(lane, (lanes.get(lane) ?? 0) + 1);
    const prompt = v.underlay?.prompt;
    if (prompt === undefined) {
      console.log(`  ${beat.name.padEnd(14)} ${lane}`);
      continue;
    }
    const { id } = underlayAsset(prompt);
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id)?.add(prompt.trim());
    byPrompt.set(prompt.trim(), [...(byPrompt.get(prompt.trim()) ?? []), beat.name]);
    console.log(`  ${beat.name.padEnd(14)} ${lane.padEnd(16)} ${id}`);
    console.log(`  ${' '.repeat(14)} ${'"' + prompt.trim() + '"'}`);
  }
}

console.log(
  `\nlanes: ${[...lanes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join('  ')}`,
);

const pictures = [...byPrompt.keys()].length;
const reused = [...byPrompt.entries()].filter(([, bs]) => bs.length > 1);
console.log(
  `pictures: ${pictures} distinct prompt${pictures === 1 ? '' : 's'} over ${byId.size} asset id${byId.size === 1 ? '' : 's'}`,
);

const collided = [...byId.entries()].filter(([, prompts]) => prompts.size > 1);
for (const [id, prompts] of collided) {
  console.log(`\nCOLLISION  ${id} is ${prompts.size} different prompts:`);
  for (const p of prompts) console.log(`    "${p}"`);
}
for (const [prompt, bs] of reused) {
  console.log(`\nreused across ${bs.length} beats (${bs.join(', ')}): "${prompt}"`);
}
if (collided.length > 0) {
  console.log('\nA collision means one beat is annotating a picture generated for another.');
  process.exit(1);
}
