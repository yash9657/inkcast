/**
 * What the art director decides, on a lesson, before anyone renders it.
 *
 *     npx tsx packages/planner/src/routecheck.mts <lesson.json> [--apply]
 *
 * One model call and no images, so it costs about two cents and answers the question
 * `docs/PLAN-FIGURE-LANE.md` item 6 says decides whether any of the figure lane
 * generalises: **which beats of a topic nobody has seen get a picture?**
 *
 * `lanecheck.mts` is the other half and they are not the same question. That one reads
 * a lesson that already exists and reports the split it *has*; this one asks for a
 * split and shows you what would happen. Run this before spending $0.16 on figures,
 * and `lanecheck` afterwards to see what actually landed.
 *
 * The router reads `illustrations` as "is there an image provider", and this passes it
 * unconditionally: the point is to see the judgement, not to gate it behind a fal key.
 * The lesson on disk is left alone unless `--apply` is given.
 *
 * `docs/PLAN-WATCHABILITY.md` §4.3 states the expected answer for the falling-objects
 * topic, and it is worth reading the disagreement rather than assuming the router is
 * wrong: hook → a figure of the drop, the feather/hammer beat → a figure of the two
 * tubes, and the scale/bricks/boxes beats → marks, because those are relations.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { Lesson } from '@inkcast/core';
import { routeFigures, routerModel } from './artdirect.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [file] = args.filter((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: routecheck.mts <lesson.json> [--apply]');
  process.exit(2);
}

// Keys the way `drawsheet.mts` gets them: by path, so this tool adds no dependency.
// Without this the vault is never opened and the only way to run this harness is to
// export `ANTHROPIC_API_KEY` by hand — which reads, from here, exactly like "nothing
// routable in this lesson".
const vaultSpecifier = new URL('../../keyvault/src/index.ts', import.meta.url).href;
try {
  const kv = (await import(vaultSpecifier)) as { hydrateEnv(): Promise<{ injected: string[] }> };
  console.log(`keys: injected ${(await kv.hydrateEnv()).injected.join(', ') || 'none'}`);
} catch (err) {
  console.log(`keys: the vault could not be read (${String(err)}) — using the environment`);
}

const lesson = Lesson.parse(JSON.parse(await readFile(file, 'utf8')));
console.log(`${lesson.topic}\n  router: ${routerModel()}\n`);

/*
 * Route a copy with the marks cleared.
 *
 * `routeFigures` skips an intent that already has marks, and it is right to: in the
 * pipeline it runs *before* the drawing author, and changing the lane under a set of
 * marks would aim every leader arrow at a picture that is no longer there. But every
 * `lesson.json` on disk has been drawn, so a tool that respected that rule could only
 * ever be run on a lesson nobody has. The copy is what makes the judgement inspectable
 * without pretending the drawings are still open.
 */
const draft = Lesson.parse(JSON.parse(JSON.stringify(lesson)));
for (const beat of [
  draft.hook,
  draft.anchor,
  ...draft.steps,
  draft.worked,
  draft.misconception,
  draft.recap,
]) {
  for (const intent of beat?.visuals ?? []) delete intent.marks;
}

const decided = await routeFigures(draft, { illustrations: true });
if (!decided.length) {
  console.error('the router did not run — ANTHROPIC_API_KEY, or nothing routable in this lesson');
  process.exit(1);
}

const pad = Math.max(...decided.map((d) => d.id.length));
for (const d of decided) {
  console.log(`${d.id.padEnd(pad)}  ${d.route.padEnd(6)}  ${d.prompt ?? d.why ?? ''}`);
}

const counts = decided.reduce<Record<string, number>>((acc, d) => {
  acc[d.route] = (acc[d.route] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `\n${decided.length} beats · ` +
    ['figure', 'form', 'marks'].map((r) => `${counts[r] ?? 0} ${r}`).join(', '),
);

if (apply) {
  // The routed *pictures*, written onto the real lesson. The marks are left exactly as
  // they are and are now stale by construction — they were composed against whatever
  // each beat had before — which is why the line below says to re-cast rather than
  // implying the file is finished.
  await writeFile(file, `${JSON.stringify(draft, null, 2)}\n`);
  console.log(
    `\nwritten back to ${file}, marks cleared — re-cast (or run drawLesson) so the marks ` +
      'are composed against the pictures this chose',
  );
}
