/**
 * The daily spend ledger, and the honest fallback when the day's budget is gone.
 *
 * One box will be serving hundreds of people at launch with the operator's own keys
 * behind it, so there has to be a number that says "stop paying" and a fallback that
 * says so out loud. Both halves matter, and the second one is the one this project keeps
 * getting wrong: the MVP shipped `$0.00/min` as a *feature* while the zero-key path
 * produced a video that taught nothing (`degrade.ts`), and `projects/cardiac8` recorded
 * a $0.4286 ElevenLabs bill for a film Kokoro spoke end to end. Silent degradation, in
 * both directions. So the decision this module returns is a value — `{ degraded,
 * reasons }` — that the API and the studio render verbatim. Nothing here decides for
 * itself to be quiet.
 *
 * ## Why the ledger is append-only
 *
 * `projects/index.json` is rewritten whole on every change, which is a read-modify-write
 * over shared state and therefore loses updates the moment two renders finish together
 * (workstream D4 exists to fix it). A spend counter has exactly that shape and would
 * inherit exactly that bug — and a lost tally under-counts, which is the direction that
 * spends money. So nothing here ever reads a total in order to write it back. Each
 * booking is one line appended to the day's file; a total is a reduction over the lines
 * at read time. Two writers cannot lose each other's increment because neither one is
 * holding a copy of the sum.
 *
 * `appendFile` opens with `O_APPEND`, so the offset is claimed by the kernel per write
 * and a second process cannot land inside the first one's bytes. Same-process writers
 * are additionally serialised per file (`queue` below) so one run's lines stay together
 * in one write call. A line that is somehow torn anyway is skipped on read and *counted*
 * as unreadable, and the count is reported — under-counting is allowed to happen, but it
 * is not allowed to be invisible.
 *
 * ## Why UTC
 *
 * The day boundary has to be the same for the box, the operator reading the file and the
 * invoice. Local midnight is none of those things reliably, and a `TZ` change would
 * silently re-key history. `2026-08-21.ndjson` is a UTC day, so a rollover is a new file
 * and yesterday's spend is never destroyed to make room for today's — the ceiling resets
 * because the reader asks a different question, not because anything was erased.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { stateDir } from '@inkcast/core';
import type { CostReport } from './cost.js';

/** The environment variable that sets the ceiling. Named once, used everywhere. */
export const DAILY_USD_ENV = 'INKCAST_DAILY_USD';

/**
 * The voice a degraded run is pinned to.
 *
 * `kokoro:` — a provider name, as a prefix — is what `PINNED_LOCAL` in `providers.ts`
 * accepts as "stay local whatever key is present". A bare `af_heart` is *not* enough and
 * this is the one place it would matter most: that id names a voice, the paid adapter
 * maps it onto a stock voice of the same accent, and a guard that passed it alone would
 * hand the ceiling-exceeded run straight back to the provider it is trying to stop
 * paying.
 */
export const FREE_VOICE = 'kokoro:af_heart';

/** One billable thing that actually happened, as one line of the day's file. */
export type SpendEntry = {
  /** UTC day, `YYYY-MM-DD`. Redundant with the filename, and worth it in an audit. */
  day: string;
  /** ISO instant the booking was made. */
  at: string;
  /**
   * The account that gets the invoice: `anthropic`, `elevenlabs`, `fal`, `replicate`.
   *
   * `CostLine.provider` is `provider/model` because a bill needs the engine to be
   * priceable, and the engine has already done its work by the time we are here — the
   * ceiling is per account, so the account is the aggregation key.
   */
  provider: string;
  /** The engine, when the cost line named one. Kept for the audit, never summed on. */
  model?: string;
  /** Pipeline stage, straight from `CostLine.stage`. */
  stage: string;
  usd: number;
  /** `CostLine.estimated`, carried through so a total can say what it is made of. */
  estimated: boolean;
  /** The project the spend belongs to, so the ledger cross-references `pipeline.json`. */
  projectId?: string;
};

/** What a UTC day has cost so far. */
export type DaySpend = {
  day: string;
  usd: number;
  /**
   * Per provider, in the same `Record<name, number>` shape `VoiceRecord.chars` uses in
   * `state.ts` — a run really can be part paid and part free, and the ledger is the same
   * kind of statement one level up.
   */
  byProvider: Record<string, number>;
  /** Bookings counted. */
  entries: number;
  /**
   * Lines that could not be parsed and are therefore missing from `usd`.
   *
   * Reported rather than swallowed: a total that is quietly low is how a ceiling comes
   * to be exceeded by a box that believed it was under budget.
   */
  unreadable: number;
};

/** What a degraded run must do instead. Applied by the caller, never by this module. */
export type SpendOverrides = {
  /** Pass as `meta.voice`; `voiceProvider()` reads the `kokoro:` prefix as a pin. */
  voice: string;
  /** False means the cloud illustration lane is off — marks and the curated set only. */
  figures: boolean;
};

/**
 * The decision, as a value.
 *
 * `reasons` is a `string[]` in the same shape as `VoiceRecord.problems` and
 * `LessonSummary.problems` — whole sentences, written to be shown to a person, so the
 * API can hand them to the UI and `pipeline.json` can keep them without a translation
 * layer in between. `banner` exists only when something is actually being taken away:
 * a caller that renders it whenever it is present cannot accidentally announce a
 * restriction that is not in force, and cannot fail to announce one that is.
 */
export type SpendDecision = {
  degraded: boolean;
  reasons: string[];
  /** One sentence for the UI. Present if and only if `degraded`. */
  banner?: string;
  /** Present if and only if `degraded`. Absent means "run exactly as configured". */
  overrides?: SpendOverrides;
  day: string;
  spentUsd: number;
  /** Absent when no ceiling is configured, which is the local-desktop default. */
  ceilingUsd?: number;
  byProvider: Record<string, number>;
};

export type SpendLedgerOptions = {
  /** Where the day files live. Defaults to `<INKCAST_HOME>/spend`. */
  dir?: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable clock, so a day rollover is a test rather than a wait. */
  now?: () => Date;
};

export type SpendLedger = {
  dir: string;
  /** Absolute path of a UTC day's file. */
  fileFor: (day: string) => string;
  /** Append a finished run's cloud spend. Returns what was written. */
  book: (cost: CostReport, opts?: { projectId?: string; at?: Date }) => Promise<SpendEntry[]>;
  /** Total a UTC day, straight from disk. Defaults to today. */
  read: (day?: string) => Promise<DaySpend>;
  /** Whether the next run has to be degraded, and what to say about it. */
  decide: (opts?: { day?: string }) => Promise<SpendDecision>;
};

/** UTC calendar day of an instant, `YYYY-MM-DD`. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The configured ceiling, and anything wrong with how it was configured.
 *
 * An unset variable means no ceiling: that is the desktop case, where the money is the
 * user's own and a cap they did not ask for would be an insult. A variable that is *set
 * and unreadable* is the opposite situation — somebody meant to cap this box — so it is
 * read as a ceiling of zero rather than as no ceiling at all. Failing to a free run is
 * recoverable by fixing a typo; failing to an uncapped one is recoverable by paying the
 * bill. Both outcomes are reported, so neither is a surprise.
 */
export function dailyCeiling(env: NodeJS.ProcessEnv = process.env): {
  usd?: number;
  problems: string[];
} {
  const raw = (env[DAILY_USD_ENV] ?? '').trim();
  if (raw === '') return { problems: [] };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      usd: 0,
      problems: [
        `${DAILY_USD_ENV}="${raw}" is not a dollar amount — treating the daily ceiling as ${money(0)} until it is fixed.`,
      ],
    };
  }
  return { usd: parsed, problems: [] };
}

/**
 * The ledger lines a finished run owes, derived from the cost report and nothing else.
 *
 * Exported because it is the whole join between the two accounting systems this file
 * refuses to duplicate: `costOf()` already prices observed quantities per provider
 * (`b829d98`), so the ledger's job is to persist those lines, not to re-derive them from
 * providers and character counts a second time and then disagree with `pipeline.json`.
 * A non-positive line is dropped: a free run has nothing to book, and a zero-dollar
 * entry in an audit trail is a line someone has to work out the meaning of.
 */
export function spendEntries(
  cost: CostReport,
  meta: { day: string; at: string; projectId?: string },
): SpendEntry[] {
  const out: SpendEntry[] = [];
  for (const line of cost.lines) {
    if (!Number.isFinite(line.usd) || line.usd <= 0) continue;
    const slash = line.provider.indexOf('/');
    const provider = slash === -1 ? line.provider : line.provider.slice(0, slash);
    const model = slash === -1 ? '' : line.provider.slice(slash + 1);
    out.push({
      day: meta.day,
      at: meta.at,
      provider,
      ...(model === '' ? {} : { model }),
      stage: line.stage,
      usd: round4(line.usd),
      estimated: line.estimated,
      ...(meta.projectId === undefined ? {} : { projectId: meta.projectId }),
    });
  }
  return out;
}

/**
 * Per-file append queues, so two runs in one process append whole lines.
 *
 * `O_APPEND` already prevents one write landing inside another, but a single booking is
 * several lines and they belong together in one write call; chaining is how that stays
 * true when `Promise.all` starts eight renders. The map holds at most one entry per day
 * file per process, so it does not need eviction.
 */
const queue = new Map<string, Promise<void>>();

function serialize(file: string, work: () => Promise<void>): Promise<void> {
  const prior = queue.get(file) ?? Promise.resolve();
  // `then(work, work)` rather than `finally`: a booking that failed must not stop the
  // next one from being written, or one full disk would silently zero the day's tally.
  const next = prior.then(work, work);
  queue.set(
    file,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function openSpendLedger(opts: SpendLedgerOptions = {}): SpendLedger {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date());
  const dir = opts.dir ?? path.join(stateDir(env), 'spend');
  const fileFor = (day: string) => path.join(dir, `${day}.ndjson`);

  async function read(day: string = utcDay(now())): Promise<DaySpend> {
    const file = fileFor(day);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      // A day nobody has spent on has no file, and that is a real zero. Anything else —
      // a permissions problem, a directory where the file should be — is not a zero, and
      // reporting it as one would silently lift the ceiling on a broken box.
      if ((err as { code?: string }).code === 'ENOENT') {
        return { day, usd: 0, byProvider: {}, entries: 0, unreadable: 0 };
      }
      throw err;
    }

    const byProvider: Record<string, number> = {};
    let usd = 0;
    let entries = 0;
    let unreadable = 0;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        unreadable += 1;
        continue;
      }
      const entry = parsed as Partial<SpendEntry>;
      if (typeof entry.provider !== 'string' || !Number.isFinite(entry.usd)) {
        unreadable += 1;
        continue;
      }
      const amount = entry.usd as number;
      usd += amount;
      byProvider[entry.provider] = round4((byProvider[entry.provider] ?? 0) + amount);
      entries += 1;
    }
    return { day, usd: round4(usd), byProvider, entries, unreadable };
  }

  return {
    dir,
    fileFor,
    read,

    async book(cost, bookOpts = {}) {
      const at = bookOpts.at ?? now();
      const day = utcDay(at);
      const entries = spendEntries(cost, {
        day,
        at: at.toISOString(),
        ...(bookOpts.projectId === undefined ? {} : { projectId: bookOpts.projectId }),
      });
      if (entries.length === 0) return [];
      const file = fileFor(day);
      const payload = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
      await serialize(file, async () => {
        await mkdir(dir, { recursive: true });
        await appendFile(file, payload, 'utf8');
      });
      return entries;
    },

    async decide(decideOpts = {}) {
      const day = decideOpts.day ?? utcDay(now());
      const ceiling = dailyCeiling(env);
      const spent = await read(day);
      const reasons = [...ceiling.problems];
      if (spent.unreadable > 0) {
        reasons.push(
          `${spent.unreadable} line(s) of ${fileFor(day)} could not be read, so today's total of ${money(spent.usd)} is a floor rather than the whole story.`,
        );
      }

      const base = {
        day,
        spentUsd: spent.usd,
        byProvider: spent.byProvider,
        ...(ceiling.usd === undefined ? {} : { ceilingUsd: ceiling.usd }),
      };
      // No ceiling is not a decision to degrade, and it is not a warning either — it is
      // the desktop default, where the keys and the bill both belong to the person at
      // the keyboard.
      if (ceiling.usd === undefined) return { degraded: false, reasons, ...base };

      // `>=`, not `>`: the run being decided about has not been priced yet, and the
      // cheapest thing it could cost is more than zero. Stopping at the line is the
      // only version of this that cannot step over it.
      if (spent.usd < ceiling.usd) return { degraded: false, reasons, ...base };

      const breakdown = Object.entries(spent.byProvider)
        .sort((a, b) => b[1] - a[1])
        .map(([provider, amount]) => `${provider} ${money(amount)}`)
        .join(', ');
      reasons.push(
        `Today's cloud spend is ${money(spent.usd)} against a ${money(ceiling.usd)} daily ceiling (${DAILY_USD_ENV}), so this video is being made with the free providers.`,
        'Narration comes from the local Kokoro voice instead of ElevenLabs, and drawings are made from marks and the curated set instead of generated figures. The teaching, the pacing and the length are unchanged.',
      );
      if (breakdown !== '') reasons.push(`Spent so far today: ${breakdown}.`);

      return {
        degraded: true,
        reasons,
        banner: `Today's cloud budget is spent (${money(spent.usd)} of ${money(ceiling.usd)}). This video is narrated by the local Kokoro voice and drawn without generated figures — everything else about it is the same.`,
        overrides: { voice: FREE_VOICE, figures: false },
        ...base,
      };
    },
  };
}

/**
 * One line for a log or a non-interactive CLI, in the shape `formatDegradation()` uses.
 *
 * The reasons are joined rather than summarised, because every one of them is a sentence
 * somebody needs to read and a summary is where they stop being read.
 */
export function formatSpendDecision(d: SpendDecision): string {
  if (!d.degraded && d.reasons.length === 0) {
    return `spend ${d.day}: ${money(d.spentUsd)}${d.ceilingUsd === undefined ? '' : ` of ${money(d.ceilingUsd)}`} — running as configured`;
  }
  return `spend ${d.day}: ${d.reasons.join(' ')}`;
}

/**
 * Dollars, at the precision the number deserves.
 *
 * Sub-cent amounts get four places for the same reason `formatCost()` does it: a real
 * $0.0004 shown as `$0.00` reads as "free", and this project has already shipped one
 * "$0.00/min" claim it had to take back.
 */
function money(n: number): string {
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
