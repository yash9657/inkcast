/**
 * The spend ledger, and the two ways money has been mis-stated on disk.
 *
 * Two things are pinned here and they are the same rule from opposite ends. A stage that
 * did not run may not be billed — `projects/cardiac/pipeline.json` lists `lesson` in its
 * own `skipped` array and books $0.2567 against Anthropic anyway, which is 41% of that
 * project's recorded $0.627. And a day's real spend may not be lost — a counter that is
 * read, incremented and written back loses one of two concurrent renders, which is the
 * `projects/index.json` bug pointed at the operator's card.
 *
 * The cost guard is tested beside the ledger rather than in `cost.test.ts` because the
 * ledger is what the phantom line corrupts: every dollar in a day file arrives through
 * `costOf`, so "a skipped stage bills zero" is the first assertion the tally depends on.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { Storyboard } from '@inkcast/core';
import { costOf, type CostReport } from '../src/cost.js';
import {
  DAILY_USD_ENV,
  FREE_VOICE,
  dailyCeiling,
  openSpendLedger,
  spendEntries,
  utcDay,
} from '../src/spend.js';

/* ------------------------------------------------------------------ fixtures */

async function sandbox(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-spend-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A one-scene board long enough that `perMinuteUsd` is a real division. */
function board(): Storyboard {
  return {
    version: 1,
    title: 'Spend fixture',
    meta: {
      language: 'en',
      aspect: '16:9',
      palette: 'color',
      fps: 30,
      style: 'marker',
      voice: 'af_heart',
      outroSec: 1,
    },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: [],
    scenes: [
      {
        id: 's1',
        narration: 'One scene, ninety seconds of it.',
        camera: { x: 960, y: 540, zoom: 1, transition: 0.9 },
        elements: [],
        hold: 0,
        emphasis: [],
        durationSec: 90,
      },
    ],
  };
}

/**
 * The provider block a keyed box has: a real Anthropic key, the free local voice, and a
 * cloud image provider. It is the environment in which a wrong answer costs money.
 */
const KEYED = {
  planner: {
    name: 'anthropic',
    cloud: true,
    why: 'ANTHROPIC_API_KEY is set',
    model: 'claude-opus-5',
  },
  voice: { name: 'kokoro', cloud: false, why: 'ELEVENLABS_API_KEY is unset' },
  images: { name: 'fal', cloud: true, why: 'FAL_KEY is set' },
} as const;

/** A finished run's bill, hand-built so the ledger tests do not depend on pricing. */
function cost(usd: number, provider = 'anthropic/claude-opus-5', stage = 'lesson'): CostReport {
  return {
    usd,
    perMinuteUsd: usd,
    local: usd === 0,
    estimated: true,
    lines: [{ stage, provider, usd, basis: 'a test fixture', estimated: true }],
  };
}

/* ------------------------------------------------- a skipped stage bills zero */

test('a re-render that reached no provider is billed nothing at all', () => {
  // Exactly what `rerender()` passes: no source, no lesson, nothing narrated, nothing
  // generated — and, until the guard landed, `cost.usd = 0.01` for a system prompt that
  // was never sent, in a file whose own `skipped` array named the stage.
  const report = costOf(board(), {
    providers: { ...KEYED },
    sourceChars: 0,
    storyboardChars: 0,
    narratedChars: 0,
  });
  assert.deepEqual(report.lines, []);
  assert.equal(report.usd, 0);
  assert.equal(report.local, true);
  assert.equal(report.perMinuteUsd, 0);
});

test('a cached lesson bills nothing, and an authored one still bills the cardiac number', () => {
  // 9,868 output tokens is `projects/cardiac`'s recorded lesson, to the character. The
  // cached lesson is real text of exactly that length, so its size is no evidence that
  // anybody paid for it — only `lessonAuthored` can say, and it is the caller who knows.
  const cardiacLessonChars = 9868 * 4;
  const authored = costOf(board(), {
    providers: { ...KEYED },
    sourceChars: 0,
    storyboardChars: 0,
    lessonChars: cardiacLessonChars,
    narratedChars: 0,
  });
  assert.equal(authored.lines.find((l) => l.stage === 'lesson')?.usd, 0.2567);
  assert.match(
    authored.lines.find((l) => l.stage === 'lesson')?.basis ?? '',
    /~2000 in \+ ~9868 out tokens/,
  );

  const cached = costOf(board(), {
    providers: { ...KEYED },
    sourceChars: 0,
    storyboardChars: 0,
    lessonChars: cardiacLessonChars,
    narratedChars: 0,
    lessonAuthored: false,
  });
  assert.deepEqual(cached.lines, []);
  assert.equal(cached.usd, 0);

  // And the flag cannot be used to invent a bill either: stating that the stage ran does
  // not conjure output characters it never produced.
  const claimed = costOf(board(), {
    providers: { ...KEYED },
    sourceChars: 0,
    storyboardChars: 0,
    narratedChars: 0,
    lessonAuthored: true,
  });
  assert.equal(claimed.usd, 0);
});

/* ------------------------------------------------------------- the day tally */

test('a free run books nothing, so the ledger stays empty', async () => {
  const box = await sandbox();
  try {
    const ledger = openSpendLedger({ dir: box.dir, env: {} });
    assert.deepEqual(await ledger.book(cost(0)), []);
    const day = await ledger.read();
    assert.equal(day.usd, 0);
    assert.equal(day.entries, 0);
  } finally {
    await box.cleanup();
  }
});

test('a booking records the account, the engine and the project', async () => {
  const box = await sandbox();
  try {
    const at = new Date('2026-08-21T10:00:00.000Z');
    const ledger = openSpendLedger({ dir: box.dir, env: {}, now: () => at });
    const written = await ledger.book(cost(0.2143, 'elevenlabs/eleven_flash_v2_5', 'voice'), {
      projectId: 'cardiac8f',
    });
    assert.deepEqual(written, [
      {
        day: '2026-08-21',
        at: at.toISOString(),
        // The account gets the invoice; the engine has already been priced.
        provider: 'elevenlabs',
        model: 'eleven_flash_v2_5',
        stage: 'voice',
        usd: 0.2143,
        estimated: true,
        projectId: 'cardiac8f',
      },
    ]);
    const day = await ledger.read();
    assert.deepEqual(day.byProvider, { elevenlabs: 0.2143 });

    // A provider with no engine — `fal` — leaves the slot out rather than filling it
    // with the provider name again.
    await ledger.book(cost(0.003, 'fal', 'visuals'));
    assert.deepEqual((await ledger.read()).byProvider, { elevenlabs: 0.2143, fal: 0.003 });
  } finally {
    await box.cleanup();
  }
});

test('forty renders finishing together lose no tally', async () => {
  const box = await sandbox();
  try {
    const at = new Date('2026-08-21T12:00:00.000Z');
    // Two ledger instances, because the studio and a CLI cast can be the same box's two
    // callers and neither holds the other's totals.
    const a = openSpendLedger({ dir: box.dir, env: {}, now: () => at });
    const b = openSpendLedger({ dir: box.dir, env: {}, now: () => at });
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        (i % 2 === 0 ? a : b).book(cost(0.01), { projectId: `p${i}` }),
      ),
    );

    const day = await a.read();
    assert.equal(day.entries, 40, 'every booking has to be on disk');
    assert.equal(day.usd, 0.4, '40 × $0.01, with nothing lost to a read-modify-write');
    assert.equal(day.unreadable, 0, 'no line may be torn by a concurrent append');
    assert.deepEqual(day.byProvider, { anthropic: 0.4 });
  } finally {
    await box.cleanup();
  }
});

test('eight separate processes appending at once are all counted', async () => {
  // The in-process queue cannot help here: these are eight `node` processes with no
  // shared state, which is what a restart-during-a-render or a CLI cast beside the
  // studio actually looks like. `O_APPEND` is what makes it safe.
  const box = await sandbox();
  try {
    const file = openSpendLedger({ dir: box.dir, env: {} }).fileFor('2026-08-21');
    const line = (i: number) =>
      JSON.stringify({
        day: '2026-08-21',
        at: '2026-08-21T12:00:00.000Z',
        provider: 'anthropic',
        stage: 'lesson',
        usd: 0.05,
        estimated: true,
        projectId: `child${i}`,
      });
    await writeFile(file, '');
    await Promise.all(
      Array.from(
        { length: 8 },
        (_, i) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                '-e',
                `require('node:fs').appendFileSync(process.argv[1], process.argv[2] + '\\n')`,
                file,
                line(i),
              ],
              { stdio: 'ignore' },
            );
            child.on('error', reject);
            child.on('exit', (code) =>
              code === 0 ? resolve() : reject(new Error(`child exited ${code}`)),
            );
          }),
      ),
    );

    const day = await openSpendLedger({ dir: box.dir, env: {} }).read('2026-08-21');
    assert.equal(day.entries, 8);
    assert.equal(day.usd, 0.4);
    assert.equal(day.unreadable, 0);
  } finally {
    await box.cleanup();
  }
});

test('a fresh instance after a restart reads the day it never wrote', async () => {
  const box = await sandbox();
  try {
    const at = new Date('2026-08-21T09:00:00.000Z');
    const before = openSpendLedger({ dir: box.dir, env: {}, now: () => at });
    await before.book(cost(0.31), { projectId: 'cardiac2' });
    await before.book(cost(0.003, 'fal', 'visuals'), { projectId: 'cardiac2' });

    // Nothing is carried in memory: this is a different closure, as a restarted box is a
    // different process. The ledger has to be the file, or a reboot resets the ceiling.
    const after = openSpendLedger({ dir: box.dir, env: {}, now: () => at });
    const day = await after.read();
    assert.equal(day.usd, 0.313);
    assert.equal(day.entries, 2);
    assert.deepEqual(day.byProvider, { anthropic: 0.31, fal: 0.003 });

    // And the file it survived in is one line per booking, which is what makes it
    // append-only rather than a counter two writers fight over.
    const raw = await readFile(after.fileFor('2026-08-21'), 'utf8');
    assert.equal(raw.trimEnd().split('\n').length, 2);
  } finally {
    await box.cleanup();
  }
});

test('a torn line is skipped, counted, and said out loud', async () => {
  const box = await sandbox();
  try {
    const at = new Date('2026-08-21T09:00:00.000Z');
    const ledger = openSpendLedger({
      dir: box.dir,
      env: { [DAILY_USD_ENV]: '5' },
      now: () => at,
    });
    await ledger.book(cost(0.5));
    await writeFile(ledger.fileFor('2026-08-21'), '{"provider":"anthropic","usd":\n', {
      flag: 'a',
    });

    const day = await ledger.read();
    assert.equal(day.usd, 0.5);
    assert.equal(day.unreadable, 1);

    // Under budget, so nothing is taken away — but the total is a floor and the
    // decision says so rather than presenting it as the whole story.
    const decision = await ledger.decide();
    assert.equal(decision.degraded, false);
    assert.equal(decision.reasons.length, 1);
    assert.match(decision.reasons[0]!, /could not be read/);
    assert.equal(decision.banner, undefined);
  } finally {
    await box.cleanup();
  }
});

/* --------------------------------------------------------- the UTC day, reset */

test('a UTC day rollover resets the ceiling without erasing yesterday', async () => {
  const box = await sandbox();
  try {
    const today = new Date('2026-08-21T00:30:00.000Z');
    const ledger = openSpendLedger({
      dir: box.dir,
      env: { [DAILY_USD_ENV]: '0.50' },
      now: () => today,
    });

    // Half an hour before the clock's "now", which is the previous UTC day.
    await ledger.book(cost(0.6), { at: new Date('2026-08-20T23:59:59.000Z') });
    assert.equal((await ledger.read('2026-08-20')).usd, 0.6);
    assert.equal((await ledger.read()).usd, 0, "yesterday's spend is not today's");
    assert.equal(utcDay(today), '2026-08-21');

    // Today runs at full quality; yesterday, asked about directly, was over budget.
    // Nothing was reset by deletion — the reader simply asks a different question.
    assert.equal((await ledger.decide()).degraded, false);
    assert.equal((await ledger.decide({ day: '2026-08-20' })).degraded, true);
  } finally {
    await box.cleanup();
  }
});

/* ------------------------------------------------------------- the fallback */

test('the ceiling flips the run to the free providers, with a banner', async () => {
  const box = await sandbox();
  try {
    const at = new Date('2026-08-21T18:00:00.000Z');
    const ledger = openSpendLedger({
      dir: box.dir,
      env: { [DAILY_USD_ENV]: '0.50' },
      now: () => at,
    });

    await ledger.book(cost(0.49));
    const under = await ledger.decide();
    assert.equal(under.degraded, false);
    assert.deepEqual(under.reasons, []);
    assert.equal(under.overrides, undefined, 'nothing is forced on a run that is in budget');
    assert.equal(under.ceilingUsd, 0.5);
    assert.equal(under.spentUsd, 0.49);

    await ledger.book(cost(0.02, 'elevenlabs/eleven_flash_v2_5', 'voice'));
    const over = await ledger.decide();
    assert.equal(over.degraded, true);
    assert.equal(over.spentUsd, 0.51);
    // The pin is the provider-name prefix, not the bare voice id: `providers.ts` reads
    // `kokoro:` as "stay local whatever key is present", and `af_heart` alone as a voice
    // the paid adapter is happy to map onto a stock voice.
    assert.deepEqual(over.overrides, { voice: FREE_VOICE, figures: false });
    assert.match(over.overrides?.voice ?? '', /^kokoro:/);
    assert.equal(typeof over.banner, 'string');
    assert.match(over.banner ?? '', /\$0\.51 of \$0\.50/);
    assert.match(over.banner ?? '', /Kokoro/);
    assert.ok(over.reasons.length >= 2, 'the reasons say what happened and what changed');
    assert.match(over.reasons.join(' '), new RegExp(DAILY_USD_ENV));
    assert.match(over.reasons.join(' '), /anthropic \$0\.49, elevenlabs \$0\.02/);

    // Exactly at the ceiling is over it: the run being decided about has not been priced
    // yet and cannot cost nothing.
    const exact = openSpendLedger({
      dir: box.dir,
      env: { [DAILY_USD_ENV]: '0.51' },
      now: () => at,
    });
    assert.equal((await exact.decide()).degraded, true);
  } finally {
    await box.cleanup();
  }
});

test('no ceiling is not a degraded run, and an unreadable ceiling is', async () => {
  const box = await sandbox();
  try {
    const at = new Date('2026-08-21T18:00:00.000Z');
    const spent = openSpendLedger({ dir: box.dir, env: {}, now: () => at });
    await spent.book(cost(12));

    // The desktop default: the keys and the bill belong to the person at the keyboard,
    // and a cap they never asked for would be an insult. The number is still reported.
    const uncapped = await spent.decide();
    assert.equal(uncapped.degraded, false);
    assert.equal(uncapped.ceilingUsd, undefined);
    assert.equal(uncapped.spentUsd, 12);
    assert.deepEqual(uncapped.reasons, []);

    // A ceiling that was set and cannot be read is somebody's intention to cap this box.
    // Failing to a free run costs a typo; failing to an uncapped one costs the invoice.
    const typo = openSpendLedger({
      dir: box.dir,
      env: { [DAILY_USD_ENV]: '50 dollars' },
      now: () => at,
    });
    const decision = await typo.decide();
    assert.equal(decision.degraded, true);
    assert.equal(decision.ceilingUsd, 0);
    assert.match(decision.reasons[0]!, /is not a dollar amount/);
    assert.deepEqual(dailyCeiling({}).problems, []);
    assert.equal(dailyCeiling({}).usd, undefined);
    assert.equal(dailyCeiling({ [DAILY_USD_ENV]: '-3' }).usd, 0);
    assert.equal(dailyCeiling({ [DAILY_USD_ENV]: ' 2.5 ' }).usd, 2.5);
  } finally {
    await box.cleanup();
  }
});

test('a zero ceiling degrades before a cent is spent', async () => {
  const box = await sandbox();
  try {
    const ledger = openSpendLedger({
      dir: box.dir,
      env: { [DAILY_USD_ENV]: '0' },
      now: () => new Date('2026-08-21T18:00:00.000Z'),
    });
    const decision = await ledger.decide();
    assert.equal(decision.degraded, true);
    assert.equal(decision.spentUsd, 0, 'an empty day is a real zero, not a missing file');
    assert.deepEqual(decision.overrides, { voice: FREE_VOICE, figures: false });
  } finally {
    await box.cleanup();
  }
});

test('the entries a cost report owes are derived from the report and nothing else', () => {
  // The ledger does not re-price anything. `costOf` already priced observed quantities
  // per provider (`b829d98`); a second derivation from providers and character counts is
  // how a ledger comes to disagree with the `pipeline.json` beside it.
  const report: CostReport = {
    usd: 0.2173,
    perMinuteUsd: 0.14,
    local: false,
    estimated: true,
    lines: [
      { stage: 'lesson', provider: 'anthropic/claude-opus-5', usd: 0, basis: '', estimated: true },
      {
        stage: 'voice',
        provider: 'elevenlabs/eleven_flash_v2_5',
        usd: 0.2143,
        basis: '',
        estimated: true,
      },
      { stage: 'visuals', provider: 'fal', usd: 0.003, basis: '', estimated: true },
    ],
  };
  const entries = spendEntries(report, { day: '2026-08-21', at: '2026-08-21T00:00:00.000Z' });
  assert.deepEqual(
    entries.map((e) => [e.provider, e.usd]),
    [
      ['elevenlabs', 0.2143],
      ['fal', 0.003],
    ],
    'a zero line is not an audit entry anybody has to interpret',
  );
});
