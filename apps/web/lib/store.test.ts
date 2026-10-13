/**
 * The project store, pinned down where concurrency broke it.
 *
 * This file exists because of a bug that was invisible in every manual test and
 * fatal under load: `projects/index.json` was a read-modify-write of one shared
 * JSON document, serialised by a *module-level* promise chain. One chain per
 * module instance is mutual exclusion only while there is exactly one instance,
 * and `next dev` re-evaluates `lib/store.ts` on every file save — so an
 * in-flight render finishes against the previous instance's chain while a new
 * request writes through the new one. Two chains, no lock, and the loser's
 * project disappears from the library.
 *
 * `oldWritePath` below is that algorithm, reimplemented from the committed
 * version (`git show 13c7fe8:apps/web/lib/store.ts`, lines 245–311) so the
 * defect stays *demonstrated* rather than merely described. Two tests use it:
 * one hand-schedules the four-step interleaving that loses an update, which is
 * deterministic and is the mechanism; one runs 50 writers across two instances
 * and reports what actually happens, which is the magnitude. Measured on this
 * machine over 15 runs: **25–26 of 50 projects survived** and **22–25 of the 50
 * writes rejected with ENOENT** (the modal run is 25 and 25), because a fixed
 * temp path (`index.json.<pid>.tmp`) means one writer's `rename` moves the file
 * another writer is still about to rename. Half the library lost, and half the
 * jobs failing with an error about a temp file — that second symptom is why the
 * bug was never diagnosed from the first.
 *
 * The same 50-writer scenario against the current code is the headline test:
 * 50 of 50 with nothing rejected, in all 15 runs, with `index.json` valid JSON
 * at the end.
 *
 * The rest of the file covers the ownership and sharing facts that D3 leans on
 * (`shared` defaults false, an owner tag is sticky across a status write) and the
 * claim in the module header that the index is *only* a cache — deleting or
 * corrupting it must change nothing a user can see.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * `PROJECTS_DIR` is captured when `lib/store` first evaluates, so the temp root
 * has to exist and be in the environment *before* the import — hence a dynamic
 * import rather than a static one. Every test in this file shares the one
 * directory and cleans it, which also keeps the module-level index lock and the
 * per-id meta locks under test rather than re-imported per case.
 */
const PROJECTS_ROOT = mkdtempSync(path.join(os.tmpdir(), 'inkcast-store-test-'));
process.env.INKCAST_PROJECTS = PROJECTS_ROOT;
delete process.env.INKCAST_HOSTED;

const store = await import('./store.js');
const {
  AsyncMutex,
  PROJECTS_DIR,
  deleteProject,
  getProject,
  listProjects,
  readProjectMeta,
  readProjectTruth,
  rebuildIndex,
  setProjectShared,
  upsertProject,
} = store;

assert.equal(PROJECTS_DIR, PROJECTS_ROOT, 'the bootstrap must have taken the temp root');

const INDEX = path.join(PROJECTS_ROOT, 'index.json');

/** Empty the projects root between cases without discarding the module. */
async function reset(): Promise<void> {
  for (const entry of await readdir(PROJECTS_ROOT)) {
    await rm(path.join(PROJECTS_ROOT, entry), { recursive: true, force: true });
  }
}

async function readIndexFile(): Promise<{ projects: Record<string, unknown> }> {
  const raw = await readFile(INDEX, 'utf8');
  // Parsed without a `try`: a throw here *is* the assertion. The old path could
  // leave this file unparseable, and a test that tolerated that would be testing
  // nothing.
  return JSON.parse(raw) as { projects: Record<string, unknown> };
}

/* --------------------------------------------------------------- the mutex */

test('AsyncMutex serialises in call order, however many callers', async () => {
  const mutex = new AsyncMutex();
  const entered: number[] = [];
  let concurrent = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      mutex.run(async () => {
        entered.push(i);
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        // Yield twice, so a lock that only happened to work because its body was
        // synchronous would be caught here.
        await new Promise((r) => setTimeout(r, 0));
        await Promise.resolve();
        concurrent -= 1;
      }),
    ),
  );

  assert.equal(peak, 1, 'two holders at once means it is not a lock');
  assert.deepEqual(
    entered,
    Array.from({ length: 50 }, (_, i) => i),
    'FIFO fairness: acquisition order must be call order, so no writer is starved',
  );
});

test('AsyncMutex releases when the critical section throws', async () => {
  const mutex = new AsyncMutex();
  await assert.rejects(
    mutex.run(async () => {
      throw new Error('write failed');
    }),
    /write failed/,
  );
  // A lock wedged shut by one failed write would take the whole library down,
  // which is strictly worse than the failed write.
  assert.equal(await mutex.run(async () => 'still usable'), 'still usable');
});

test('AsyncMutex never runs the critical section synchronously', async () => {
  // The rebuild-coalescing in `rebuildIndex` depends on this: it assigns
  // `queuedRebuild` *after* calling `run`, and that is only safe if the body
  // cannot have already cleared the slot.
  const mutex = new AsyncMutex();
  let ran = false;
  const promise = mutex.run(async () => {
    ran = true;
  });
  assert.equal(ran, false, 'the body must be deferred to at least a microtask');
  await promise;
  assert.equal(ran, true);
});

/* ------------------------------------------------- the race, then the fix */

/**
 * The committed pre-D4 write path, one instance per call.
 *
 * Faithful in the two details that mattered: the promise chain is per instance
 * (so two instances do not exclude each other) and the temp file name is fixed
 * per process (so two writers fight over one path).
 */
function oldWritePath(dir: string) {
  const indexPath = path.join(dir, 'index.json');
  let writeChain: Promise<unknown> = Promise.resolve();

  function serialise<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeChain.then(fn, fn);
    writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function readProjects(): Promise<Record<string, { id: string }>> {
    try {
      const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as {
        projects?: Record<string, { id: string }>;
      };
      return parsed.projects ?? {};
    } catch {
      return {};
    }
  }

  async function writeProjects(projects: Record<string, { id: string }>): Promise<void> {
    await mkdir(dir, { recursive: true });
    const tmp = `${indexPath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
    await rename(tmp, indexPath);
  }

  return {
    readProjects,
    writeProjects,
    upsert(id: string): Promise<void> {
      return serialise(async () => {
        const projects = await readProjects();
        projects[id] = { id };
        await writeProjects(projects);
      });
    },
  };
}

test('the old index write path loses an update — the four-step interleaving', async () => {
  await reset();
  // No timing, no luck: this is the read-read-write-write order that a promise
  // chain per module instance permits, spelled out. Both writers succeed; one
  // project is gone.
  const a = oldWritePath(PROJECTS_ROOT);
  const b = oldWritePath(PROJECTS_ROOT);

  const seenByA = await a.readProjects();
  const seenByB = await b.readProjects();
  seenByA['alpha'] = { id: 'alpha' };
  seenByB['bravo'] = { id: 'bravo' };
  await a.writeProjects(seenByA);
  await b.writeProjects(seenByB);

  const survivors = Object.keys((await readIndexFile()).projects);
  assert.deepEqual(survivors, ['bravo'], 'alpha was written, acknowledged, and lost');
});

test('the old index write path loses half of 50 concurrent writes', async (t) => {
  await reset();
  const a = oldWritePath(PROJECTS_ROOT);
  const b = oldWritePath(PROJECTS_ROOT);
  const ids = Array.from({ length: 50 }, (_, i) => `old${String(i).padStart(2, '0')}`);

  const outcomes = await Promise.all(
    ids.map((id, i) =>
      (i % 2 === 0 ? a : b)
        .upsert(id)
        .then(() => 'ok' as const)
        .catch((err: NodeJS.ErrnoException) => err.code ?? 'threw'),
    ),
  );
  const rejected = outcomes.filter((o) => o !== 'ok');
  const survivors = Object.keys((await readIndexFile()).projects);

  t.diagnostic(`old path: ${survivors.length}/50 survived, ${rejected.length}/50 rejected`);
  assert.ok(
    survivors.length < ids.length,
    `the race must be observable; ${survivors.length}/50 survived`,
  );
  // The temp-path collision, which is the half of the bug that turned data loss
  // into visible job failures — and is why nobody ever traced the missing
  // projects back to the index.
  assert.ok(rejected.length > 0, 'expected rename() collisions on the shared temp path');
  assert.ok(
    rejected.every((code) => code === 'ENOENT'),
    `unexpected failure codes: ${[...new Set(rejected)].join(',')}`,
  );
});

test('50 concurrent writes all survive, and the index stays valid JSON', async (t) => {
  await reset();
  const ids = Array.from({ length: 50 }, (_, i) => `new${String(i).padStart(2, '0')}`);

  const records = await Promise.all(
    ids.map((id, i) =>
      upsertProject(id, { title: `project ${i}`, status: i % 2 === 0 ? 'ready' : 'running' }),
    ),
  );
  assert.equal(records.length, 50);

  // The property the whole rewrite exists for: a resolved `upsertProject` means
  // the project is in the index *now*, not eventually.
  const indexed = (await readIndexFile()).projects;
  const missing = ids.filter((id) => !(id in indexed));
  t.diagnostic(`new path: ${ids.length - missing.length}/50 survived, 0/50 rejected`);
  assert.deepEqual(missing, [], 'every acknowledged write must be in the index');

  // And the truth agrees with the cache, because `listProjects` and
  // `rebuildIndex` are the same computation over `meta.json`.
  const listed = await listProjects();
  assert.equal(listed.length, 50);
  assert.deepEqual(
    listed.map((p) => p.id).sort(),
    [...ids].sort(),
    'the listing is derived from the same truth as the index',
  );
});

test('concurrent patches to one project merge instead of clobbering', async () => {
  await reset();
  // Four background writers, one project: the exact shape of a render finishing
  // while a cost is booked and an owner is recorded. Under the old path the last
  // writer's read had already happened, so three of these facts would be lost.
  await Promise.all([
    upsertProject('merge1', { status: 'running', title: 'Cardiac cycle' }),
    upsertProject('merge1', { ownerSession: 'tag-owner' }),
    upsertProject('merge1', { costUsd: 0.42 }),
    upsertProject('merge1', { aspect: '16:9' }),
  ]);

  const meta = await readProjectMeta('merge1');
  assert.ok(meta);
  assert.equal(meta.title, 'Cardiac cycle');
  assert.equal(meta.ownerSession, 'tag-owner');
  assert.equal(meta.costUsd, 0.42);
  assert.equal(meta.aspect, '16:9');
});

/* ------------------------------------------------ the index is only a cache */

test('deleting index.json changes nothing a user can see', async () => {
  await reset();
  await upsertProject('cache1', { title: 'Kept', status: 'ready' });
  await rm(INDEX, { force: true });

  const listed = await listProjects();
  assert.deepEqual(
    listed.map((p) => p.id),
    ['cache1'],
    'per-project meta.json is the truth; the index is derived from it',
  );
  await rebuildIndex();
  assert.ok('cache1' in (await readIndexFile()).projects, 'and a rebuild restores the cache');
});

test('a truncated index.json degrades to a rescan, not to an empty library', async () => {
  await reset();
  await upsertProject('cache2', { title: 'Survivor', status: 'ready' });
  // Exactly what the old path could leave behind: a half-written document.
  await writeFile(INDEX, '{"version":1,"projects":{"cache2":{"id":"cach');

  const listed = await listProjects();
  assert.deepEqual(
    listed.map((p) => p.id),
    ['cache2'],
    'unparseable cache must read as a miss, never as zero projects',
  );
});

/* -------------------------------------------------- ownership and sharing */

test('shared defaults to false, and stays false until it is set', async () => {
  await reset();
  const created = await upsertProject('share1', { title: 'Private', status: 'ready' });
  assert.equal(created.shared, false, 'publication is an act, never a default');

  const meta = await readProjectMeta('share1');
  assert.equal(meta?.shared, false, 'and it is recorded, so a reader need not infer it');

  const published = await setProjectShared('share1', true);
  assert.equal(published?.shared, true);
  const unpublished = await setProjectShared('share1', false);
  assert.equal(unpublished?.shared, false);
  assert.equal(await setProjectShared('nosuchproject', true), undefined);
});

test('a status write cannot orphan a project or un-publish it', async () => {
  await reset();
  await upsertProject('sticky1', { ownerSession: 'tag-a', status: 'running' });
  await setProjectShared('sticky1', true);
  // A background job finishing knows nothing about owners or sharing. Under a
  // naive merge, this write would blank both fields — the project would vanish
  // from its owner's library and its share link would 403 the audience it was
  // just sent to.
  await upsertProject('sticky1', { status: 'ready', durationSec: 61.5 });

  const truth = await readProjectTruth('sticky1');
  assert.equal(truth?.ownerSession, 'tag-a');
  assert.equal(truth?.record.shared, true);
  assert.equal(truth?.record.status, 'ready');
});

test('a film cast from the terminal repairs the metadata a failed studio run left behind', async () => {
  await reset();

  /*
   * The exact sequence behind `projects/deb81002b073`, which shipped with a
   * `meta.json` reading `status: failed`, `scenes: 0`, `durationSec: 0` and eight
   * ink-on-ink errors, sitting next to a 131-second film that plays fine.
   *
   * 20:58 — the studio starts a run and the strict quality gate refuses it, so
   * `jobs.ts` writes the failure.
   */
  await upsertProject('healme', {
    ownerSession: 'tag-a',
    status: 'failed',
    title: 'Why do heavy and light objects fall at the same time',
    error: '8 quality problems in 3 checks (ink-on-ink, vacant, realized-layout)',
  });

  // 22:00 — the same project is cast again from a *terminal*. `@inkcast/pipeline`
  // writes its own completion record and the video; it has never heard of
  // `meta.json` and nothing on that path could have written one.
  const dir = path.join(PROJECTS_ROOT, 'healme');
  await writeFile(
    path.join(dir, 'pipeline.json'),
    `${JSON.stringify({
      projectId: 'healme',
      title: 'Why do heavy and light objects fall at the same time',
      videoPath: 'out.mp4',
      durationSec: 131.33,
      createdAt: '2026-08-25T22:00:19.846Z',
      updatedAt: '2026-08-25T22:00:19.846Z',
      cost: { usd: 0.4453 },
    })}\n`,
  );
  await writeFile(path.join(dir, 'out.mp4'), 'not really an mp4, but it is on disk');

  // The listing was always right — `mergeDisk` reconciles in memory.
  const dto = await getProject('healme');
  assert.equal(dto?.status, 'ready');
  assert.equal(dto?.durationSec, 131.33);

  // The part that was not: the file itself. It is served by
  // `/api/media/<id>/meta.json` and it is the first thing anyone opens when a
  // project looks wrong, so a permanently stale copy is a permanently wrong
  // answer.
  const meta = await readProjectMeta('healme');
  assert.equal(meta?.status, 'ready');
  assert.equal(meta?.durationSec, 131.33);
  assert.equal(meta?.videoPath, 'out.mp4');
  assert.equal(meta?.costUsd, 0.4453);
  assert.equal(meta?.error, undefined, 'a project with a video on disk has no failure to report');

  // And the repair is a repair, not a reset: ownership and sharing are facts only
  // this file holds, and losing them would take the project out of its owner's
  // library to fix a status field.
  assert.equal(meta?.ownerSession, 'tag-a');
});

test('the repair never overwrites a run that is in flight', async () => {
  await reset();

  const dir = path.join(PROJECTS_ROOT, 'inflight');
  await upsertProject('inflight', { status: 'ready', title: 'Old cut' });
  await writeFile(
    path.join(dir, 'pipeline.json'),
    `${JSON.stringify({ projectId: 'inflight', title: 'Old cut', durationSec: 12 })}\n`,
  );

  // A re-render starts. Disk still describes the *previous* film, and it will
  // keep doing so for the several minutes the render takes — so a scan that
  // wrote itself back would announce the old cut as finished while the new one
  // is still being made.
  await upsertProject('inflight', { status: 'running' });
  await listProjects();

  assert.equal((await readProjectMeta('inflight'))?.status, 'running');
});

test('the owner tag never reaches a DTO', async () => {
  await reset();
  await upsertProject('leak1', { ownerSession: 'tag-secret', status: 'ready' });
  const dto = await getProject('leak1');
  assert.ok(dto);
  // `/api/projects` spreads a DTO straight into its response body, so anything
  // ownership-shaped in this object is a tag handed to a browser.
  assert.ok(!('ownerSession' in dto), 'ownership must travel only via readProjectTruth');
});

test('listProjects filters by owner, and the unowned rule is explicit', async () => {
  await reset();
  await upsertProject('own1', { ownerSession: 'tag-a', status: 'ready' });
  await upsertProject('own2', { ownerSession: 'tag-b', status: 'ready' });
  await upsertProject('own3', { status: 'ready' });

  const mine = await listProjects({ ownerSession: 'tag-a' });
  assert.deepEqual(
    mine.map((p) => p.id).sort(),
    ['own1', 'own3'],
    'locally there is one person, so an unowned project is theirs',
  );

  const hostedView = await listProjects({ ownerSession: 'tag-a', includeUnowned: false });
  assert.deepEqual(
    hostedView.map((p) => p.id),
    ['own1'],
    'hosted, a project this box cannot attribute is not shown to a visitor',
  );

  const everything = await listProjects();
  assert.equal(everything.length, 3, 'no filter means no filtering');
});

test('deleting a project removes it from the derived index too', async () => {
  await reset();
  await upsertProject('gone1', { title: 'Doomed', status: 'ready' });
  assert.equal(await deleteProject('gone1'), true);

  assert.equal(await getProject('gone1'), undefined);
  assert.ok(!('gone1' in (await readIndexFile()).projects));
  assert.equal(await deleteProject('gone1'), false, 'deleting twice is not an error, just false');
});

test('an invalid project id is refused before it reaches the filesystem', async () => {
  await reset();
  await assert.rejects(upsertProject('../escape', { status: 'ready' }), /not a valid project id/);
  assert.equal(await readProjectTruth('../escape'), undefined);
});

test.after(async () => {
  await rm(PROJECTS_ROOT, { recursive: true, force: true });
});
