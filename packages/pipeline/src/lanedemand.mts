/**
 * Which missing lane the corpus actually asks for (plan item 6.3).
 *
 *     npx tsx packages/pipeline/src/lanedemand.mts [projectsDir]
 *
 * 6.3's rule is that the lanes get built in the order real lessons ask for them, and
 * 6.1's guard is the measurement: `unservedLanes()` reads every picture a lesson wants
 * and names the ones no renderer here can draw. That rule was unrunnable until this file
 * existed. The findings are written per project into `qc.json`, one film at a time, and
 * "the frequency of these findings" was a thing somebody had to reconstruct by hand from
 * fifty directories — which is how a demand-driven plan quietly becomes a taste-driven
 * one.
 *
 * So this runs the guard over every lesson on disk at once, and prints the count per
 * lane. No keys, no network, no render: it re-derives the finding from `lesson.json`
 * rather than reading `qc.json`, so it also covers projects cast before 6.1 landed and
 * stays correct when the signals are tuned.
 *
 * **Fixtures are counted separately, and that is the whole subtlety.** A lesson written
 * to prove the guard fires is not a lesson that wants a lane; counting it is a vote for
 * building something nobody asked for, which is the failure mode 6.1's own header warns
 * about in its precision-over-recall note. A project whose lesson came from a scratch
 * directory rather than from `examples/` or a real source is marked `fixture` below and
 * kept out of the demand column. If that heuristic is ever wrong the raw rows are printed
 * too, so a reader can overrule it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lesson, UNSERVED, unservedLanes, type Lane } from '@inkcast/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const projects = process.argv[2] ?? path.join(ROOT, 'projects');

type Row = { file: string; topic: string; fixture: boolean; lanes: Lane[]; quotes: string[] };

/**
 * Is this project's lesson a fixture rather than a film someone wanted?
 *
 * `pipeline.json`'s `source.ref` is the honest witness: a lesson authored into a scratch
 * directory to exercise a check points at `/tmp` or a session scratchpad, where a real
 * run points at `examples/lessons/…`, a URL, or a document. A project with no
 * `pipeline.json` at all is treated as real, because the only way to get one of those is
 * to have cast it.
 */
function isFixture(dir: string): boolean {
  const meta = path.join(dir, 'pipeline.json');
  if (!existsSync(meta)) return false;
  try {
    const ref = (JSON.parse(readFileSync(meta, 'utf8')) as { source?: { ref?: string } }).source
      ?.ref;
    if (!ref) return false;
    return /^\/(private\/)?tmp\//.test(ref) || /scratchpad/.test(ref);
  } catch {
    return false;
  }
}

function read(file: string, fixture: boolean): Row | undefined {
  let lesson: Lesson;
  try {
    lesson = Lesson.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
  const gaps = unservedLanes(lesson);
  return {
    file: path.relative(ROOT, file),
    topic: lesson.topic,
    fixture,
    lanes: gaps.map((g) => g.lane),
    quotes: gaps.map((g) => `${g.lane}\t${g.where}\t${g.kind ?? '—'}\t${g.quote}`),
  };
}

const rows: Row[] = [];
for (const entry of readdirSync(projects).sort()) {
  const dir = path.join(projects, entry);
  const file = path.join(dir, 'lesson.json');
  if (!existsSync(file)) continue;
  const row = read(file, isFixture(dir));
  if (row) rows.push(row);
}
const examples = path.join(ROOT, 'examples/lessons');
if (existsSync(examples)) {
  for (const entry of readdirSync(examples).sort()) {
    const row = read(path.join(examples, entry), false);
    if (row) rows.push(row);
  }
}

const demand = new Map<Lane, number>();
const fixtures = new Map<Lane, number>();
const filmsWanting = new Set<string>();
for (const row of rows) {
  for (const lane of row.lanes) {
    const into = row.fixture ? fixtures : demand;
    into.set(lane, (into.get(lane) ?? 0) + 1);
    if (!row.fixture) filmsWanting.add(row.file);
  }
}

for (const row of rows) {
  if (!row.quotes.length) continue;
  console.log(`\n${row.file}${row.fixture ? '  [fixture]' : ''} — ${row.topic}`);
  for (const q of row.quotes) console.log(`  ${q}`);
}

const topics = new Set(rows.map((r) => r.topic.toLowerCase()));
console.log(
  `\n${rows.length} lessons on disk, ${topics.size} distinct topics, ` +
    `${filmsWanting.size} of them asking for a lane that does not exist.\n`,
);
console.log('lane        demand  fixture  installing one of these ends it');
for (const lane of Object.keys(UNSERVED) as Lane[]) {
  const d = demand.get(lane) ?? 0;
  const f = fixtures.get(lane) ?? 0;
  // Circuits names none, and says so rather than printing an empty column: no library
  // supplies a schematic lane here, it needs curated symbols. See `UNSERVED`.
  const ends = UNSERVED[lane].ends.join(', ') || '(no library — a curated symbol set)';
  console.log(`${lane.padEnd(11)} ${String(d).padStart(6)}  ${String(f).padStart(7)}  ${ends}`);
}
console.log(
  '\ndemand = findings in lessons somebody wanted a film of; fixture = findings in ' +
    'lessons written to exercise the guard. Only the first column is a reason to build ' +
    'a lane (plan 6.3).',
);
