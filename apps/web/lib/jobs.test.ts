/**
 * The admission control from D1, pinned down where it would actually hurt.
 *
 * Everything here runs offline: no Chromium, no ffmpeg, no provider, no real
 * clock. That is not a convenience, it is the point — the properties this file
 * asserts are the ones whose violation you cannot see from a single render, only
 * from twenty-five people arriving at once, and a gate you can only run on the
 * launch box is a gate nobody runs.
 *
 * The seven things worth a test, and why each one is here rather than assumed:
 *
 *  1. **Never more than two renders.** The whole reason the semaphore exists. A
 *     render is four Chromium contexts and four ffmpeg workers; the third
 *     concurrent one does not make the box slower by a third, it makes all three
 *     miss.
 *  2. **FIFO, not barge-in.** The subtle way a queue betrays people: a freed
 *     slot handed to whoever asked most recently rather than to the head of the
 *     line means the person who has waited longest waits longest again. The
 *     `waiting.length === 0` half of the admission test in `acquire` is what
 *     prevents it, and a test that only counted concurrency would pass without it.
 *  3. **Positions are monotone per client.** A number that goes 4, 3, 5 is worse
 *     than no number at all, because the user's next thought is "is it stuck, or
 *     is it lying?".
 *  4. **A late subscriber gets the *current* position.** The SSE channel replays
 *     history, and the first version of that replay walked a new client through
 *     every stale position it had missed. One overwritten slot fixes it; this
 *     test is what keeps it one slot.
 *  5. **A failed job releases its slot.** Two renders that crash must not
 *     wedge the box for everyone behind them — and the crash must not be folded
 *     into the duration mean, or a fast failure teaches the queue to promise a
 *     wait it cannot keep. Asserted twice, because it is two pieces of code: on
 *     the lease itself, and again through the registry, whose catch block has to
 *     release before it dynamic-imports the pipeline to name the cause.
 *  6. **Cancelling from the queue vacates without shifting anyone backwards.**
 *     Splicing a list is exactly where an off-by-one sends the person behind the
 *     hole from #3 to #4.
 *  7. **The estimate is arithmetic, not a vibe.** List scheduling over two
 *     servers, checked against numbers worked out by hand, plus the honest
 *     `null` before anything has been measured.
 *
 * `INKCAST_PROJECTS` is redirected into a scratch directory *before* the module
 * under test is imported, which is why the import is dynamic and awaited:
 * `lib/store` captures the projects root at module load (see its header), and a
 * test that let it capture the real one would have `upsertProject` writing
 * `meta.json` into the developer's actual library on the cancellation path.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Erased at compile time, so it cannot evaluate the module before the
// environment below is set — which is the whole reason the values are imported
// dynamically further down.
import type { JobEvent, Lease, QueueEvent } from './jobs.js';

process.env.INKCAST_PROJECTS ??= mkdtempSync(path.join(tmpdir(), 'inkcast-jobs-test-'));
// The registry and the scheduler are pinned to `globalThis`; nothing in this
// file needs provider keys, but a stray one in the environment must not be
// mistaken for permission to call anybody.
process.env.INKCAST_HOSTED = '0';

const {
  CLASS_LIMIT,
  QueueCancelled,
  cancelJob,
  createScheduler,
  estimateWaitSec,
  getJob,
  queueDepth,
  hostedFormat,
  measuredMeanSec,
  queueCopy,
  startJob,
  subscribe,
  waitCopy,
  waitForJob,
  HOSTED_PRESET,
  HOSTED_PRESET_SEC,
} = await import('./jobs.js');

/* ------------------------------------------------------------------ helpers */

/** A promise plus the handles to settle it from the outside. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-queued microtask run. Nothing here waits on real time. */
const settle = () => new Promise<void>((r) => setImmediate(r));

/**
 * Blocked fake runs, and the teardown that has to exist.
 *
 * The registry tests below need jobs that hold their slots for as long as the
 * test says and not a millisecond longer, so each fake run awaits a deferred
 * that only the test resolves. That makes teardown load-bearing rather than
 * tidy: the scheduler is process-wide and pinned to `globalThis`, so a test that
 * walked away from two held render slots would leave the *next* test's jobs
 * queued behind ghosts, and it would fail for a reason that has nothing to do
 * with what it is checking. `drain` therefore fails every blocked run and waits
 * for each job to reach its terminal state — inside the test, where node's test
 * runner can still attribute the work — before handing the pools back empty.
 */
const blockers = new Map<string, ReturnType<typeof deferred<never>>>();

function blockedJob(id: string, kind: 'cast' | 'rerender' = 'rerender') {
  const block = deferred<never>();
  blockers.set(id, block);
  // A job that is still *queued* never entered its run callback, so nothing is
  // awaiting this promise when `drain` rejects it. One inert handler makes the
  // rejection handled either way — without it, tearing down a queued fake job
  // fails the test with an unhandled rejection that says nothing about the queue.
  void block.promise.catch(() => {});
  return startJob(id, kind, async () => {
    await block.promise;
    throw new Error('unreachable: a blocked fake run only ever ends by rejection');
  });
}

async function drain(ids: string[]): Promise<void> {
  for (const id of ids) blockers.get(id)?.reject(new Error('the test is over'));
  await Promise.allSettled(ids.map((id) => waitForJob(id)));
}

/* ----------------------------------------------------- the render semaphore */

test('never more than two renders run at once, and slots go to the head of the line', async () => {
  const scheduler = createScheduler({ now: () => 0 });
  const order: string[] = [];
  const holders = new Map<string, Lease>();
  let live = 0;
  let peak = 0;

  const admissions = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => {
    const admission = scheduler.acquire('render', id);
    const take = (lease: Lease) => {
      order.push(id);
      holders.set(id, lease);
      live += 1;
      peak = Math.max(peak, live);
    };
    if ('lease' in admission) {
      take(admission.lease);
      return { id, waited: false, done: Promise.resolve() };
    }
    return { id, waited: true, done: admission.wait.then(take) };
  });

  /** Finish a render. `live` is the count the semaphore is supposed to bound. */
  const finish = async (id: string) => {
    live -= 1;
    holders.get(id)!.release('ok');
    // One turn of the microtask queue is all a granted waiter needs to start,
    // and starting is what would push `live` past the limit if it could.
    await settle();
  };

  // Two in, four waiting: the limit is enforced synchronously, at the moment of
  // asking, not eventually.
  assert.deepEqual(
    admissions.map((a) => a.waited),
    [false, false, true, true, true, true],
  );
  assert.deepEqual(scheduler.depth('render'), { running: 2, waiting: 4 });
  assert.equal(peak, 2);

  // Released out of order — 'b' before 'a' — because the FIFO promise is about
  // the *waiters*, not about who happens to finish first.
  await finish('b');
  await finish('a');
  await finish('c');
  await finish('d');
  await finish('e');
  await finish('f');
  await Promise.all(admissions.map((a) => a.done));

  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(peak, 2, 'a third render was admitted while two were still holding slots');
  assert.deepEqual(scheduler.depth('render'), { running: 0, waiting: 0 });
});

test('the cloud classes run four at a time while renders still gate at two', async () => {
  const scheduler = createScheduler({ now: () => 0 });
  assert.equal(CLASS_LIMIT.render, 2);
  assert.equal(CLASS_LIMIT.lesson, 4);

  const ids = ['a', 'b', 'c', 'd', 'e'];
  const waited = ids.map((id) => !('lease' in scheduler.acquire('lesson', id)));
  assert.deepEqual(waited, [false, false, false, false, true]);
  assert.deepEqual(scheduler.depth('lesson'), { running: 4, waiting: 1 });
  // Four lesson slots taken has not spent a single renderer.
  assert.deepEqual(scheduler.depth('render'), { running: 0, waiting: 0 });
});

test('a job holding a render slot cannot queue for one, so it cannot deadlock itself', () => {
  const scheduler = createScheduler({ now: () => 0 });
  const first = scheduler.acquire('render', 'a');
  assert.ok('lease' in first);

  // The failure this prevents: a job that holds the resource it is waiting for
  // waits forever, and the slot never comes back. Throwing is loud; hanging is
  // a box that "went slow" at 3am.
  assert.throws(() => scheduler.acquire('render', 'a'), /acquired in order/);
  assert.throws(() => scheduler.acquire('lesson', 'a'), /acquired in order/);

  // Forwards is fine: lesson, then voice, then render, is the order a pipeline
  // actually runs in.
  const staged = createScheduler({ now: () => 0 });
  assert.ok('lease' in staged.acquire('lesson', 'b'));
  assert.ok('lease' in staged.acquire('voice', 'b'));
  assert.ok('lease' in staged.acquire('render', 'b'));
  assert.deepEqual(staged.held('b'), ['lesson', 'voice', 'render']);
});

test('a failed lease frees its slot and is kept out of the duration mean', async () => {
  let clock = 0;
  const scheduler = createScheduler({ now: () => clock });

  const a = scheduler.acquire('render', 'a');
  const b = scheduler.acquire('render', 'b');
  assert.ok('lease' in a && 'lease' in b);
  const queued = scheduler.acquire('render', 'c');
  assert.ok('wait' in queued);

  // 'a' dies after nine seconds. The slot must come back...
  clock = 9_000;
  a.lease.release('failed');
  const lease = await queued.wait;
  assert.deepEqual(scheduler.depth('render'), { running: 2, waiting: 0 });

  // ...and the nine seconds must not become the promise made to the next
  // person in line. A crash is not a measurement of how long a render takes.
  assert.equal(scheduler.meanSec('render'), null);

  clock = 129_000;
  b.lease.release('ok');
  assert.equal(scheduler.meanSec('render'), 129);
  lease.release('ok');
});

test('the duration mean rolls, so a machine that got faster is not judged on last week', () => {
  let clock = 0;
  const scheduler = createScheduler({ now: () => clock, samples: 3 });
  for (const seconds of [300, 300, 300, 60, 60, 60]) {
    const admission = scheduler.acquire('render', `r${clock}`);
    assert.ok('lease' in admission);
    clock += seconds * 1000;
    admission.lease.release('ok');
  }
  assert.equal(scheduler.meanSec('render'), 60);
});

/* ------------------------------------------------------------ the estimate */

test('the wait estimate is list scheduling over the measured mean', () => {
  // Nothing measured yet: no number, and no invented one.
  assert.equal(
    estimateWaitSec({ position: 3, limit: 2, meanSec: null, remainingSec: [10, 20] }),
    null,
  );

  // Two renders in flight with 30 s and 90 s left, mean 120 s.
  const remainingSec = [30, 90];
  const args = { limit: 2, meanSec: 120, remainingSec };
  // Head of the line takes the slot that frees first: 30 s.
  assert.equal(estimateWaitSec({ ...args, position: 1 }), 30);
  // Second waiter takes the other one: 90 s.
  assert.equal(estimateWaitSec({ ...args, position: 2 }), 90);
  // Third waits for the first slot to cycle again: 30 + 120.
  assert.equal(estimateWaitSec({ ...args, position: 3 }), 150);
  // Fourth: the second slot cycles at 90 + 120.
  assert.equal(estimateWaitSec({ ...args, position: 4 }), 210);

  // A render that has already run past the mean is "any moment now", not a
  // negative wait that would show up as a queue moving backwards in time.
  assert.equal(estimateWaitSec({ position: 1, limit: 2, meanSec: 120, remainingSec: [0, 0] }), 0);
});

test('the copy quotes the wait to the precision the estimate has, and admits when it has none', () => {
  assert.equal(waitCopy(20), 'under a minute');
  assert.equal(waitCopy(70), 'about a minute');
  assert.equal(waitCopy(360), 'about 6 minutes');
  assert.equal(waitCopy(9_999), 'over an hour');

  const fourth = queueCopy({ cls: 'render', position: 4, running: 2, etaSec: 360 });
  assert.equal(fourth, "You're #4 in line — about 6 minutes.");

  const next = queueCopy({ cls: 'render', position: 1, running: 2, etaSec: 45 });
  assert.match(next, /^You're next in line — about a minute\.$/);

  // No mean, no number: the sentence must not contain a digit it cannot back up
  // (the render limit is the only figure it may quote).
  const unknown = queueCopy({ cls: 'render', position: 4, running: 2, etaSec: null });
  assert.match(unknown, /#4 in line/);
  assert.match(unknown, /has not finished one yet/);
  assert.doesNotMatch(unknown, /minute/);
});

/* -------------------------------------------------- positions over the wire */

test('a client watches its own position fall, and cancelling ahead of it never pushes it back', async () => {
  const scheduler = createScheduler({ now: () => 0 });
  const seen = new Map<string, number[]>();
  const track = (id: string) => (view: { position: number }) => {
    const log = seen.get(id) ?? [];
    log.push(view.position);
    seen.set(id, log);
  };

  const held: Lease[] = [];
  for (const id of ['a', 'b']) {
    const admission = scheduler.acquire('render', id, track(id));
    assert.ok('lease' in admission);
    held.push(admission.lease);
  }

  const waiters = ['c', 'd', 'e', 'f'].map((id) => {
    const admission = scheduler.acquire('render', id, track(id));
    assert.ok('wait' in admission);
    seen.set(id, [admission.view.position]);
    return { id, wait: admission.wait };
  });
  assert.deepEqual(
    waiters.map((w) => seen.get(w.id)![0]),
    [1, 2, 3, 4],
  );

  // 'd' gives up while waiting. 'e' and 'f' move forwards; 'c' does not move at
  // all, because nothing ahead of it changed.
  assert.equal(scheduler.cancel('d'), true);
  await assert.rejects(waiters[1]!.wait, (err: unknown) => err instanceof QueueCancelled);
  assert.deepEqual(seen.get('c'), [1]);
  assert.deepEqual(seen.get('e'), [3, 2]);
  assert.deepEqual(seen.get('f'), [4, 3]);

  // Now drain, and check every client's whole history: non-increasing, always.
  held[0]!.release('ok');
  await settle();
  held[1]!.release('ok');
  await settle();
  const admitted = await Promise.all([waiters[0]!.wait, waiters[2]!.wait]);
  admitted.forEach((lease) => lease.release('ok'));
  await settle();
  await waiters[3]!.wait.then((lease) => lease.release('ok'));

  for (const [id, log] of seen) {
    for (let i = 1; i < log.length; i++) {
      assert.ok(log[i]! <= log[i - 1]!, `${id} watched its position go up: ${log.join(' → ')}`);
    }
  }
});

/* ------------------------------------------- the registry, over the channel */

test('a late subscriber is replayed the position the queue holds now', async () => {
  // Four jobs, two slots. None of them finishes on its own, so nothing the
  // queue reports depends on a pipeline, a file or a clock.
  const ids = ['late1', 'late2', 'late3', 'late4'];
  const snapshots = ids.map((id) => blockedJob(id));

  // The first two were admitted synchronously — a queue that reported "queued"
  // for a job that started immediately would be a lie the studio has to render.
  assert.deepEqual(
    snapshots.map((s) => s.snapshot.status),
    ['running', 'running', 'queued', 'queued'],
  );
  assert.equal(snapshots[2]!.snapshot.queue?.position, 1);
  assert.equal(snapshots[3]!.snapshot.queue?.position, 2);
  assert.match(snapshots[3]!.snapshot.queue!.message, /#2 in line/);

  // A client that opens its EventSource *after* asking gets one queue event
  // first, and it is the current one — not a walk through the positions it
  // missed, which is what a replayed log would give it.
  const received: unknown[] = [];
  const late = subscribe('late4', (event) => received.push(event));
  assert.equal(late.found, true);
  assert.equal(late.settled, false);
  assert.deepEqual(received.length, 1);
  assert.deepEqual(received[0], snapshots[3]!.snapshot.queue);

  // 'late3' gives up. 'late4' moves to the head of the line, over the same
  // channel, and never sees a larger number than the one it started with.
  assert.equal(cancelJob('late3'), true);
  await settle();
  const positions = received
    .filter((e): e is { queued: boolean; position: number } => 'queued' in (e as object))
    .map((e) => e.position);
  assert.deepEqual(positions, [2, 1]);

  late.unsubscribe();
  await drain(ids);
});

test('a job cancelled in the queue ends as a terminal event and takes no slot with it', async () => {
  const running = ['hold1', 'hold2'].map((id) => blockedJob(id));
  assert.deepEqual(
    running.map((r) => r.snapshot.status),
    ['running', 'running'],
  );

  const waiting = startJob('give-up', 'rerender', async () => {
    throw new Error('the cancelled job must never run its callback');
  });
  assert.equal(waiting.snapshot.status, 'queued');

  const events: unknown[] = [];
  subscribe('give-up', (event) => events.push(event));

  assert.equal(cancelJob('give-up'), true);
  // The run callback never ran, so nothing here reaches the pipeline: the
  // terminal event is written from the cancellation itself.
  const settled = await waitForJob('give-up');
  assert.equal(settled?.status, 'error');
  assert.match(settled?.error?.error ?? '', /cancelled while it was waiting/);
  assert.equal(settled?.error?.stage, 'queue');
  // Nothing was admitted, so the two holders are still the only renders and the
  // vacated place left no gap behind it.
  assert.deepEqual(queueDepth('render'), { running: 2, waiting: 0 });

  // A cancelled *running* job is refused rather than pretended: nothing in the
  // pipeline takes an abort signal, so returning true would hand back a slot
  // that is still busy.
  assert.equal(cancelJob('hold1'), false);
  assert.equal(cancelJob('give-up'), false);

  const terminal = events.at(-1) as { error?: string };
  assert.match(terminal.error ?? '', /cancelled while it was waiting/);
  await drain(['hold1', 'hold2']);
});

test('a run that throws hands its slot back before it touches the filesystem', async () => {
  // The scheduler-level version of this is asserted further up with a fake
  // clock; this is the path production actually takes, and it is a different
  // piece of code: `execute`'s catch has to release the lease *before* it
  // dynamic-imports the pipeline to describe the failure and before it writes
  // the project index. A release that happened after either one would still pass
  // a lease test and still stall the queue on a crash — which is the moment a
  // queue most needs to keep moving.
  const crashing = ['crash1', 'crash2'].map((id) => blockedJob(id));
  assert.deepEqual(
    crashing.map((c) => c.snapshot.status),
    ['running', 'running'],
  );

  const behind = blockedJob('behind');
  assert.equal(behind.snapshot.status, 'queued');
  assert.equal(behind.snapshot.queue?.position, 1);

  // 'crash1' fails inside its run callback. Its slot is the one 'behind' has
  // been waiting for.
  await drain(['crash1']);
  assert.equal(getJob('crash1')?.status, 'error');
  await settle();

  const promoted = getJob('behind');
  assert.equal(promoted?.status, 'running', 'a crash left its renderer occupied');
  assert.equal(promoted?.queue?.queued, false);
  assert.deepEqual(queueDepth('render'), { running: 2, waiting: 0 });

  // And the crash taught the estimator nothing. Every fake run in this file ends
  // by rejection, so a non-null mean here could only have come from folding a
  // failure in — which is how a queue starts promising a nine-second wait for a
  // four-minute film.
  assert.equal(
    measuredMeanSec('render'),
    null,
    'a failed run was counted as a measurement of how long a render takes',
  );

  await drain(['crash2', 'behind']);
});

test('a staged run waits for a renderer without holding one, and the wait reaches the client', async () => {
  // Two renders already in flight, so there is no renderer to be had.
  const holding = ['stage-a', 'stage-b'].map((id) => blockedJob(id));
  assert.deepEqual(
    holding.map((h) => h.snapshot.status),
    ['running', 'running'],
  );

  // The shape the hosted route takes once `cast()` accepts a pre-render gate:
  // hold a cloud slot for the whole run, and take a renderer only around the
  // part that actually drives Chromium. The job below is *running* — it is doing
  // its lesson and voice work — while it queues for a renderer, which is the
  // difference between a queue and a stalled box.
  const inRender = deferred<never>();
  void inRender.promise.catch(() => {});
  const staged = startJob(
    'staged',
    'cast',
    async (_onProgress, ctx) =>
      ctx.lease('render', async () => {
        await inRender.promise;
        throw new Error('unreachable: the render blocker only ever rejects');
      }),
    { hold: 'lesson' },
  );
  assert.equal(staged.snapshot.status, 'running', 'a cloud slot was free, so nothing queued');

  // Everything the channel carries, not only the admission events: the point of
  // this test is that the queue and the progress share one stream, so the
  // collection has to be able to hold both and the narrowing has to be explicit.
  const events: JobEvent[] = [];
  const admissions = () => events.filter((e): e is QueueEvent => 'queued' in e);
  const listener = subscribe('staged', (event) => events.push(event));
  await settle();

  // It is queued for a renderer, and it said so on the same channel its progress
  // will arrive on.
  const queuedFor = admissions().filter((e) => e.queued);
  assert.equal(queuedFor.length, 1);
  assert.equal(queuedFor[0]!.position, 1);

  // A renderer frees; the staged job takes it and announces that it started.
  await drain(['stage-a']);
  await settle();
  assert.deepEqual(
    admissions().map((e) => e.queued),
    [true, false],
  );

  listener.unsubscribe();
  inRender.reject(new Error('the test is over'));
  await drain(['stage-b', 'staged']);
});

/* --------------------------------------------------------- the hosted cap */

test('the hosted deployment renders one preset, and a local one is left alone', () => {
  assert.equal(HOSTED_PRESET, 'explainer');
  assert.deepEqual(hostedFormat(true), { preset: 'explainer' });

  // The length is mirrored from `PRESETS.explainer.maxSeconds` rather than
  // imported, because `apps/web` does not depend on the planner and a client
  // component could not import this module if it did. A mirror needs a pin: the
  // failure it guards is a preset edit that leaves every hosted visitor reading
  // a wait justified by a film length that is no longer true.
  assert.equal(HOSTED_PRESET_SEC, 75);
  // Locally the person pasting the text is the person paying for it and waiting
  // for their own CPU, so nothing is imposed: an empty patch spreads to nothing.
  assert.deepEqual(hostedFormat(false), {});
});
