/**
 * Author a lesson with the real model and stop — no board, no voice, no render.
 *
 *     npx tsx packages/pipeline/src/lessonjson.mts "<topic or text>" <projectId> [preset]
 *     npx tsx packages/planner/src/lanecheck.mts projects/<projectId>/lesson.json
 *
 * `sbjson.mts` is this tool's no-key twin: it compiles a board from a *derived* lesson,
 * which is the right thing when the question is about geometry and the wrong thing when
 * the question is about what the author chose. Every question this repository keeps
 * getting wrong is the second kind — *did the stage that has to ask for the capability
 * actually ask* — and answering it cost a full `cast` until now.
 *
 * It is the cheap half of that: one lesson call, about $0.06, against a render's $1.20.
 * So a brief edit can be judged on the lesson it produces before anything is paid to
 * draw or to speak it, which is the only way three variants of a brief are affordable.
 *
 * Keys come from the keyvault by the same computed specifier `drawcheck.mts` uses, and
 * for the same reason: the vault is the CLI's dependency, not this package's, and a
 * verification tool should not add one.
 */
import { lessonBeats } from '@inkcast/core';
import { designLesson } from './cast.js';
import type { PresetName } from './stages.js';

const [text, projectId, preset] = process.argv.slice(2);
if (!text || !projectId) {
  console.error('usage: lessonjson.mts "<topic or text>" <projectId> [preset]');
  process.exit(2);
}

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

const res = await designLesson(
  { text, ...(preset ? { preset: preset as PresetName } : {}) },
  { projectId, force: true },
);

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

console.log(`project   ${res.projectId}`);
console.log(`lesson    ${res.lessonPath ?? '-'}`);
console.log(`author    ${res.author ?? '-'}`);

if (res.lesson) {
  const beats = lessonBeats(res.lesson);
  let total = 0;
  for (const b of beats) total += words(b.step.narration ?? '');
  console.log(`beats     ${beats.length}`);
  console.log(`words     ${total}`);
  for (const b of beats) {
    // Every underlay the beat asked for, and the lane each one lands in. `form` is the
    // default in the schema, so an absent `kind` is reported as what it means.
    const unders = b.step.visuals.flatMap((v) => (v.underlay ? [v.underlay] : []));
    const lanes = unders.map((u) => u.kind ?? 'form').join(',') || '—';
    console.log(
      `  ${b.id.padEnd(13)} ${lanes.padEnd(13)} ${String(words(b.step.narration ?? '')).padStart(3)}w  ${(
        unders[0]?.prompt ?? ''
      ).slice(0, 64)}`,
    );
  }
}

// The critic's verdict last, where it cannot be scrolled past. An empty list is the
// thing Phase 3 has to keep empty: a budget met by the author writing less, not by the
// trimmer cutting afterwards.
console.log(`problems  ${res.problems.length === 0 ? '(none)' : String(res.problems.length)}`);
for (const p of res.problems) console.log(`  - ${p}`);
