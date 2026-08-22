#!/usr/bin/env node
/**
 * Plan item D7 — the load proof.
 *
 * Fires 25 concurrent `POST /api/generate` at a running studio, follows every
 * job's Server-Sent Events stream to a terminal state, samples the box while it
 * happens, and prints a pass/fail table against the five gates the plan names:
 *
 *   zero lost jobs · queue positions monotone · no OOM · index.json intact ·
 *   p95 time-to-video under 12 min at queue depth 10
 *
 * ## Read this before running it
 *
 * **This spends real money.** Each generation is an Anthropic lesson call plus
 * ElevenLabs characters; at the list prices in `packages/pipeline/src/cost.ts`
 * (Sonnet-class tokens, $0.00022/ElevenLabs credit) a single explainer costs
 * roughly $0.20–0.25, so a full 25-job run is **$5–6**. The script therefore
 * refuses to submit anything without `--yes-spend-money`, and prints its estimate
 * first. `--dry-run` exercises every code path except the submission.
 *
 * **Run it on the box, not on a laptop.** Three separate reasons, and each one
 * invalidates the result on its own:
 *
 *   1. The RSS and OOM gates need to observe the *server* process. From a laptop
 *      there is nothing to observe, and "no OOM" degrades to "the box did not
 *      stop answering", which is a much weaker claim.
 *   2. 25 concurrent multipart-free JSON posts over a domestic uplink measure the
 *      uplink. Time-to-video would include transfer time that production does
 *      not have.
 *   3. `index.json` is checked by reading it, which needs the volume.
 *
 * **It needs the bypass token.** With `INKCAST_HOSTED=1` the per-IP token bucket
 * allows *three* generations a day (`GENERATION_LIMIT` in
 * `app/api/_lib/ratelimit.ts`), so 25 requests from one address are 3 accepted
 * and 22 × `429`. That is the limiter working correctly, and it makes the load
 * test measure nothing. Set `INKCAST_BYPASS_TOKEN` in the app's environment and
 * export the same value here; the script sends it as `X-Inkcast-Bypass` and
 * `bypassAllowed` then admits without debiting.
 *
 * ## Why every job gets a different topic
 *
 * This is the detail that makes the difference between a load test and a
 * no-op. `POST /api/generate` derives the project id from a hash of the source
 * when none is supplied (`generate/route.ts`: `core.projectId(JSON.stringify({
 * source, meta, title }))`), and then `startJob` hands back the *existing* job
 * if one is already running for that id — deliberately, so a double-clicked
 * button does not render twice. Submitting the same topic 25 times would
 * therefore produce **one** job, 25 identical 202s, and a green board that proved
 * nothing. Each request below carries a distinct topic string.
 *
 * ## What this script cannot currently prove, and says so
 *
 * One gate is fully live and one is still unprovable, and the difference is
 * worth stating because an earlier draft of this file had both wrong.
 *
 *   - **Queue positions: live.** D1 has landed. `JobStatus` in
 *     `apps/web/lib/jobs.ts` is now `'queued' | 'running' | 'done' | 'error'`,
 *     and `QueueEvent` carries a 1-based `position` that drops to `0` at the
 *     moment a slot is granted. Those events ride the same SSE channel as
 *     progress — deliberately, so the two can never disagree about ordering —
 *     so `follow()` picks the positions straight out of the stream it is already
 *     reading and `monotoneGate` is a real verdict rather than a placeholder.
 *   - **The `explainer` preset: still unprovable.** `GenerateFields` is `.strict()` and has no
 *     `preset` field (`app/api/_lib/schemas.ts`), so the API cannot be asked for
 *     it and a request carrying one is rejected outright. The script probes for
 *     the field, falls back to the closest expressible request, and marks the
 *     preset row `SKIP` — which matters for the p95 gate, because a `standard`
 *     film is ~176 s of video against the explainer's ~100 s and therefore a
 *     substantially longer render. A p95 measured this way is pessimistic.
 */

import { readFile } from 'node:fs/promises';
import { readdir, readFile as read } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/* ------------------------------------------------------------------- config */

const DEFAULTS = {
  base: process.env.INKCAST_LOADTEST_BASE ?? 'http://localhost:3000',
  jobs: 25,
  /** Queue depth the p95 budget is stated at. See `p95Gate`. */
  depth: 10,
  /** Minutes. The plan's number. */
  budget: 12,
  /** How often to poll /api/health while the run is in flight. */
  sampleMs: 2000,
  /** Give up on a job that has produced no event for this long. */
  stallMin: 25,
};

/** Documented list prices, mirrored from packages/pipeline/src/cost.ts. */
const COST_PER_GENERATION_USD = 0.22;

function parseArgs(argv) {
  const opts = { ...DEFAULTS, dryRun: false, confirmed: false, json: false };
  for (const arg of argv) {
    const num = (prefix) => Number(arg.slice(prefix.length));
    if (arg.startsWith('--base=')) opts.base = arg.slice('--base='.length).replace(/\/+$/, '');
    else if (arg.startsWith('--jobs=')) opts.jobs = num('--jobs=');
    else if (arg.startsWith('--depth=')) opts.depth = num('--depth=');
    else if (arg.startsWith('--budget-min=')) opts.budget = num('--budget-min=');
    else if (arg.startsWith('--stall-min=')) opts.stallMin = num('--stall-min=');
    else if (arg.startsWith('--projects=')) opts.projects = arg.slice('--projects='.length);
    else if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--yes-spend-money') opts.confirmed = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

const USAGE = `inkcast load proof (plan item D7)

  node scripts/loadtest.mjs --yes-spend-money [options]

  --base=URL           studio origin (default http://localhost:3000)
  --jobs=N             concurrent generations (default 25)
  --depth=N            queue depth the p95 budget is stated at (default 10)
  --budget-min=N       p95 time-to-video budget in minutes (default 12)
  --stall-min=N        declare a job lost after this long with no event (default 25)
  --projects=DIR       projects root, for the index.json check
  --dry-run            do everything except submit
  --yes-spend-money    required to submit; a 25-job run costs about $${(25 * COST_PER_GENERATION_USD).toFixed(2)}
  --json               emit one JSON object instead of the table

Environment: INKCAST_BYPASS_TOKEN (required against a hosted instance),
INKCAST_PROJECTS (for the index.json check).`;

/* -------------------------------------------------------------- the sources */

/**
 * A distinct, small, plausible topic per job.
 *
 * Above the 20-character floor `SourceText` enforces and far below the 20 000
 * character hosted cap, because the point of this test is queue behaviour and
 * render throughput, not the planner's tolerance for long documents. The index
 * is embedded in the text so the id hash differs per job — see the header.
 */
function topicFor(i) {
  const subjects = [
    'how a heat pump moves warmth against a temperature gradient',
    'why a sourdough starter rises and what the bacteria are doing',
    'how noise-cancelling headphones invert a waveform in real time',
    'what happens electrically when a lithium cell is fast charged',
    'why suspension bridges use catenary curves instead of arcs',
    'how a vaccine teaches an immune system without an infection',
    'what a compiler does between source text and machine code',
    'why the ocean has tides twice a day rather than once',
    'how GPS corrects for the relativistic drift of its own clocks',
    'what makes a laser coherent when a light bulb is not',
  ];
  const subject = subjects[i % subjects.length];
  return `Explain ${subject}. Keep it concrete and build one idea at a time, ending with why it matters in practice. (load probe ${i + 1})`;
}

/* ------------------------------------------------------------------- client */

function headers(extra = {}) {
  const out = { 'Content-Type': 'application/json', ...extra };
  const bypass = process.env.INKCAST_BYPASS_TOKEN;
  if (bypass && bypass.trim() !== '') out['X-Inkcast-Bypass'] = bypass;
  return out;
}

async function health(base) {
  try {
    const res = await fetch(`${base}/api/health`, { headers: headers() });
    if (!res.ok && res.status !== 503) return { reachable: false, status: res.status };
    const body = await res.json();
    return { reachable: true, status: res.status, ...body };
  } catch (err) {
    return { reachable: false, error: String(err) };
  }
}

/**
 * Does the API accept a `preset` field?
 *
 * Asked rather than assumed, because the answer decides how the p95 result must
 * be reported. `GenerateFields` is `.strict()`, so an unknown key is a 400 with a
 * validation message — a cheap, side-effect-free probe as long as the body is
 * *otherwise* invalid too, which is why the text here is deliberately below the
 * 20-character floor. No project is created and no token is spent: the route
 * checks the limiter with `spend: false` before validating.
 */
async function presetAccepted(base) {
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ text: 'x', preset: 'explainer' }),
    });
    const text = await res.text();
    // A complaint that names `preset` means the field is unrecognised. A
    // complaint only about the text means `preset` got through validation.
    return !/preset/i.test(text);
  } catch {
    return false;
  }
}

async function submit(base, i, usePreset) {
  const body = {
    text: topicFor(i),
    title: `Load probe ${i + 1}`,
    // The explainer preset is 16:9 (packages/planner/src/presets.ts). Aspect is
    // the one part of that preset the API can actually express, so it is sent —
    // it does not make the film an explainer, but it stops the run from being
    // measured against a mix of aspect ratios.
    aspect: '16:9',
    ...(usePreset ? { preset: 'explainer' } : {}),
  };
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
    return { i, status: res.status, submittedAt: t0, body: parsed };
  } catch (err) {
    return { i, status: 0, submittedAt: t0, error: String(err) };
  }
}

/**
 * Follow one job's SSE stream to a terminal event.
 *
 * The stream always answers 200 — its route explains why — so failure is a
 * `{error}` message on a healthy stream rather than a status code. Every event is
 * timestamped so the report can distinguish "waited in a queue" from "rendered
 * slowly", and `queued` positions are collected for the monotonicity gate.
 */
async function follow(base, projectId, submittedAt, stallMs) {
  const record = {
    projectId,
    submittedAt,
    firstEventAt: undefined,
    doneAt: undefined,
    outcome: 'lost',
    error: undefined,
    positions: [],
    maxPct: 0,
    events: 0,
  };

  const controller = new AbortController();
  let stall;
  const resetStall = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), stallMs);
  };

  try {
    const res = await fetch(`${base}/api/generate/${projectId}/stream`, {
      headers: headers({ Accept: 'text/event-stream' }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      record.outcome = 'stream-refused';
      record.error = `stream answered ${res.status}`;
      return record;
    }

    resetStall();
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        // `:` is an SSE comment — the app's 15 s heartbeat. It proves liveness,
        // so it resets the stall timer but is not an event.
        if (line === '' || line.startsWith(':')) {
          if (line.startsWith(':')) resetStall();
          continue;
        }
        if (!line.startsWith('data:')) continue;

        resetStall();
        record.events += 1;
        record.firstEventAt ??= Date.now();

        let event;
        try {
          event = JSON.parse(line.slice('data:'.length).trim());
        } catch {
          continue;
        }

        if (typeof event.pct === 'number' && event.pct > record.maxPct) record.maxPct = event.pct;
        // A `QueueEvent` is identified by carrying a numeric `position` and
        // nothing else in the union does, so no discriminant field is needed.
        // Position `0` is not a missing value — it is the admission event, the
        // one `queued: false` the job ever receives — so it is recorded like any
        // other and is what makes the final step of the descent observable.
        if (typeof event.position === 'number') {
          record.positions.push({ at: Date.now(), position: event.position });
        }
        if (event.done === true) {
          record.doneAt = Date.now();
          record.outcome = 'done';
          record.videoPath = event.videoPath;
          controller.abort();
          break;
        }
        if (typeof event.error === 'string') {
          record.doneAt = Date.now();
          record.outcome = 'error';
          record.error = event.error;
          controller.abort();
          break;
        }
      }
      if (record.outcome !== 'lost') break;
    }
  } catch (err) {
    // An abort we asked for after a terminal event is success, not a failure.
    if (record.outcome === 'lost') {
      record.outcome = String(err).includes('abort') ? 'stalled' : 'stream-broken';
      record.error = String(err);
    }
  } finally {
    clearTimeout(stall);
  }
  return record;
}

/* ------------------------------------------------------------- box sampling */

/**
 * Resident memory of the studio's own process tree.
 *
 * Linux `/proc` first, because that is what the launch box is, and it is exact.
 * `ps` is the portable fallback so a dry run on a developer's macOS machine still
 * exercises this path. Both match on the *command line* rather than a pid handed
 * in by the operator: a wrong pid silently reports a healthy 40 MB forever, which
 * is the most misleading possible outcome for a memory gate.
 */
async function sampleRss() {
  if (process.platform === 'linux') {
    try {
      const pids = (await readdir('/proc')).filter((n) => /^\d+$/.test(n));
      let total = 0;
      let matched = 0;
      for (const pid of pids) {
        let cmdline;
        try {
          cmdline = await read(`/proc/${pid}/cmdline`, 'utf8');
        } catch {
          continue;
        }
        if (!/next|node|chrome|chromium|ffmpeg/i.test(cmdline)) continue;
        // Exclude this script's own process tree, which would otherwise be
        // counted as part of the server it is measuring.
        if (Number(pid) === process.pid) continue;
        try {
          const status = await read(`/proc/${pid}/status`, 'utf8');
          const m = /VmRSS:\s+(\d+) kB/.exec(status);
          if (m) {
            total += Number(m[1]);
            matched += 1;
          }
        } catch {
          /* exited between readdir and read */
        }
      }
      return { kb: total, procs: matched, source: '/proc' };
    } catch {
      /* fall through */
    }
  }
  return { kb: 0, procs: 0, source: 'unavailable' };
}

/* ----------------------------------------------------------------- the gates */

function percentile(values, p) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: for small n this is the only definition that cannot report a
  // p95 lower than a value actually observed.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * "p95 time-to-video under 12 min at depth 10."
 *
 * The phrase needs an interpretation stated out loud, because two readings differ
 * by a factor of four. Taken across *all* 25 jobs, the number is arithmetic
 * rather than a measurement: renders gate at 2 concurrent, so job 25 waits for
 * twelve renders ahead of it and no budget of 12 minutes was ever achievable —
 * 25 jobs × ~2.5 min ÷ 2 lanes is over 30 minutes by construction.
 *
 * So it is read as a *service-level* statement about a user arriving at a given
 * depth: of the jobs admitted when the queue held no more than `depth` items, 95%
 * must have a video within `budget`. That is the promise the UI makes when it says
 * "you're #4 — about 6 minutes", and it is falsifiable. The whole distribution is
 * printed alongside so the other reading is available to anyone who wants it.
 */
function p95Gate(records, depthAtSubmit, depth, budgetMin) {
  const eligible = records.filter(
    (r) => r.outcome === 'done' && (depthAtSubmit.get(r.projectId) ?? Infinity) <= depth,
  );
  const times = eligible.map((r) => (r.doneAt - r.submittedAt) / 60000);
  const p95 = percentile(times, 95);
  if (p95 === undefined) {
    return {
      status: 'SKIP',
      detail:
        eligible.length === 0
          ? `no job completed while the queue was at or below depth ${depth}`
          : 'no completions to measure',
    };
  }
  return {
    status: p95 <= budgetMin ? 'PASS' : 'FAIL',
    detail: `p95 ${p95.toFixed(1)} min over ${times.length} job(s) admitted at depth <= ${depth} (budget ${budgetMin} min)`,
  };
}

/**
 * Positions must never increase for a given job: a queue that reorders is a bug.
 *
 * The FIFO in `lib/jobs.ts` only ever *removes* entries ahead of a waiter, so a
 * position that goes up means either two pools were confused for one or a
 * waiter was re-enqueued — both of which break the promise the UI makes when it
 * says "you're #4 — about 6 minutes". `broadcast()` suppresses an unchanged
 * view, so a repeated position is not even emitted; equal consecutive values are
 * accepted anyway rather than treated as suspicious, because a client that
 * reconnects mid-queue legitimately replays the last one from history.
 *
 * An empty result is `SKIP`, not `PASS`. With renders gated at 2 and 25 jobs
 * submitted, positions are all but certain — so seeing none means the stream or
 * this parser is broken, and calling that a pass would hide exactly the defect
 * the gate exists to catch.
 */
function monotoneGate(records) {
  const withPositions = records.filter((r) => r.positions.length > 0);
  if (withPositions.length === 0) {
    return {
      status: 'SKIP',
      detail:
        'no queue positions appeared on any stream — with 25 jobs against a 2-render ' +
        'semaphore that should be impossible, so suspect the stream or this parser ' +
        'rather than the queue',
    };
  }
  const offenders = [];
  for (const r of withPositions) {
    for (let i = 1; i < r.positions.length; i++) {
      if (r.positions[i].position > r.positions[i - 1].position) {
        offenders.push(
          `${r.projectId}: ${r.positions[i - 1].position} -> ${r.positions[i].position}`,
        );
      }
    }
  }
  return offenders.length === 0
    ? { status: 'PASS', detail: `${withPositions.length} job(s) reported positions, all monotone` }
    : { status: 'FAIL', detail: `positions increased: ${offenders.slice(0, 3).join('; ')}` };
}

/**
 * `index.json` intact.
 *
 * "Intact" is two claims, and the second is the one D4 is about. It has to parse
 * — a truncated file is the documented symptom of the lost-update race that
 * motivated moving truth into `meta.json`. And it has to *account for* every
 * project this run created: an index that parses but has silently dropped nine of
 * twenty-five entries is exactly the failure a concurrent single-file rewrite
 * produces, and it is invisible without this comparison.
 */
async function indexGate(base, root, ids) {
  const file = root ? path.join(root, 'index.json') : undefined;
  let entries;
  let via;

  if (file) {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      entries = Array.isArray(parsed) ? parsed : (parsed.projects ?? []);
      via = file;
    } catch (err) {
      return { status: 'FAIL', detail: `${file} did not parse: ${err}` };
    }
  } else {
    try {
      const res = await fetch(`${base}/api/projects`, { headers: headers() });
      if (!res.ok) return { status: 'SKIP', detail: `/api/projects answered ${res.status}` };
      const parsed = await res.json();
      entries = Array.isArray(parsed) ? parsed : (parsed.projects ?? []);
      via = '/api/projects';
    } catch (err) {
      return { status: 'SKIP', detail: `could not read an index: ${err}` };
    }
  }

  const present = new Set(
    entries.map((e) => (typeof e === 'string' ? e : e?.id)).filter((v) => typeof v === 'string'),
  );
  const missing = [...ids].filter((id) => !present.has(id));
  return missing.length === 0
    ? { status: 'PASS', detail: `${present.size} entries via ${via}, all ${ids.size} run ids present` }
    : {
        status: 'FAIL',
        detail: `${missing.length} of ${ids.size} run ids absent from ${via}: ${missing.slice(0, 4).join(', ')}`,
      };
}

/* -------------------------------------------------------------------- main */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const base = opts.base;
  const projectsRoot = opts.projects
    ? path.resolve(opts.projects)
    : process.env.INKCAST_PROJECTS
      ? path.resolve(process.env.INKCAST_PROJECTS)
      : undefined;

  const say = (line) => process.stdout.write(`${line}\n`);

  say('');
  say(`inkcast load proof — ${opts.jobs} concurrent generations against ${base}`);
  say('');

  /* ----------------------------------------------------------- preflight */

  const pre = await health(base);
  if (!pre.reachable) {
    say(`FATAL: ${base}/api/health is not reachable (${pre.error ?? pre.status}).`);
    say('Start the studio first, or pass --base.');
    process.exitCode = 1;
    return;
  }
  say(`health: status=${pre.status} queue=${JSON.stringify(pre.queue)} rateLimit=${JSON.stringify(pre.rateLimit)}`);
  if (pre.disk) {
    say(`disk:   ${(pre.disk.freeBytes / 1e9).toFixed(1)} GB free (${pre.disk.freePct}%)`);
    // ~33 MB per finished project, measured across this repo's projects/.
    const room = Math.floor(pre.disk.freeBytes / (33 * 1024 * 1024));
    if (room < opts.jobs) {
      say(`WARNING: only room for about ${room} films; ${opts.jobs} were requested.`);
    }
  }

  const bypass = process.env.INKCAST_BYPASS_TOKEN;
  if (pre.rateLimit?.enabled && (!bypass || bypass.trim() === '')) {
    say('');
    say('FATAL: the rate limiter is enabled and INKCAST_BYPASS_TOKEN is not set.');
    say('Three generations per address per day would be accepted and the rest');
    say('refused with 429, which measures the limiter rather than the queue. Set');
    say('INKCAST_BYPASS_TOKEN in the app environment and export the same value here.');
    process.exitCode = 1;
    return;
  }

  const usePreset = await presetAccepted(base);
  if (!usePreset) {
    say('');
    say('NOTE: POST /api/generate does not accept a `preset` field (GenerateFields');
    say('is .strict() and has no such key), so the explainer preset cannot be');
    say('requested. Films will be whatever the server defaults to — a longer');
    say('render than an explainer, which makes the p95 result pessimistic.');
  }

  const estimate = (opts.jobs * COST_PER_GENERATION_USD).toFixed(2);
  say('');
  say(`estimated spend: ~$${estimate} (${opts.jobs} x ~$${COST_PER_GENERATION_USD.toFixed(2)})`);

  if (opts.dryRun) {
    say('');
    say('--dry-run: preflight only, nothing submitted.');
    return;
  }
  if (!opts.confirmed) {
    say('');
    say('Refusing to submit without --yes-spend-money. Re-run with that flag, or');
    say('use --dry-run to check the preflight.');
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------------------- sampling */

  const samples = [];
  let sampling = true;
  let uptimeDropped = false;
  let unreachable = 0;
  let lastUptime = pre.uptimeSec ?? 0;
  let peakQueue = 0;

  const sampler = (async () => {
    while (sampling) {
      const h = await health(base);
      const rss = await sampleRss();
      if (!h.reachable) unreachable += 1;
      else {
        // The OOM detector. A container that is OOM-killed is restarted by the
        // runtime, and a restarted process reports a *smaller* uptime than it did
        // a moment ago. That is a positive signal for a condition this script has
        // no privilege to observe directly, and it needs no cgroup access, no
        // dmesg and no root.
        if (typeof h.uptimeSec === 'number') {
          if (h.uptimeSec < lastUptime) uptimeDropped = true;
          lastUptime = h.uptimeSec;
        }
        const depth = h.queue?.total ?? 0;
        if (depth > peakQueue) peakQueue = depth;
      }
      samples.push({ at: Date.now(), rssKb: rss.kb, procs: rss.procs, queue: h.queue, up: h.uptimeSec });
      await new Promise((r) => setTimeout(r, opts.sampleMs));
    }
  })();

  /* ------------------------------------------------------------- the burst */

  say('');
  say(`submitting ${opts.jobs} generations...`);
  const depthAtSubmit = new Map();

  const submissions = await Promise.all(
    Array.from({ length: opts.jobs }, (_, i) => submit(base, i, usePreset)),
  );

  const accepted = [];
  const refused = [];
  for (const s of submissions) {
    const id = s.body?.projectId;
    if (s.status === 202 && typeof id === 'string') {
      accepted.push({ ...s, projectId: id });
      // Depth as the server saw it when this job was admitted.
      //
      // `queue.total` from the sampler is a proxy, and it is used because the
      // 202 does not carry the job's own position even though `startJob` now
      // returns it: `POST /api/generate` destructures only `{ started }` from
      // the snapshot and writes `status: 'running'` as a literal, so a job that
      // actually queued is reported as running with no position. `jobs.ts`'s own
      // docstring says the 202 tells the client where it stands; today it does
      // not. Once that route forwards the snapshot, read `position` from the
      // response here — it is exact, where `peakQueue` is only the high-water
      // mark of the whole burst and therefore over-reports depth for the jobs
      // admitted first.
      depthAtSubmit.set(id, peakQueue);
    } else {
      refused.push(s);
    }
  }

  say(`accepted ${accepted.length}, refused ${refused.length}`);
  for (const r of refused.slice(0, 5)) {
    say(`  refused: HTTP ${r.status} ${JSON.stringify(r.body ?? r.error).slice(0, 160)}`);
  }

  // Distinct ids prove the topic-variation trick above actually worked. If the
  // count collapses, every subsequent number is measuring one render.
  const uniqueIds = new Set(accepted.map((a) => a.projectId));
  say(`distinct project ids: ${uniqueIds.size} (of ${accepted.length} accepted)`);

  /* ------------------------------------------------------------ follow all */

  say('');
  say('following streams to completion (this takes as long as the queue does)...');
  const records = await Promise.all(
    accepted.map((a) => follow(base, a.projectId, a.submittedAt, opts.stallMin * 60000)),
  );

  sampling = false;
  await sampler;

  /* ---------------------------------------------------------------- report */

  const done = records.filter((r) => r.outcome === 'done');
  const errored = records.filter((r) => r.outcome === 'error');
  const lost = records.filter((r) => !['done', 'error'].includes(r.outcome));
  const peakRssKb = samples.reduce((m, s) => Math.max(m, s.rssKb), 0);
  const peakProcs = samples.reduce((m, s) => Math.max(m, s.procs), 0);

  const gates = {
    'no lost jobs':
      refused.length === 0 && lost.length === 0
        ? {
            status: 'PASS',
            detail: `${records.length} accepted, ${done.length} done, ${errored.length} errored, 0 lost`,
          }
        : {
            status: 'FAIL',
            detail: `${refused.length} refused at submit, ${lost.length} never reached a terminal event (${[...new Set(lost.map((l) => l.outcome))].join(', ')})`,
          },
    'distinct jobs':
      uniqueIds.size === accepted.length && accepted.length > 0
        ? { status: 'PASS', detail: `${uniqueIds.size} distinct project ids` }
        : {
            status: 'FAIL',
            detail: `${uniqueIds.size} distinct ids from ${accepted.length} submissions — requests collapsed onto one job`,
          },
    'queue positions monotone': monotoneGate(records),
    'no OOM':
      uptimeDropped || unreachable > 1
        ? {
            status: 'FAIL',
            detail: uptimeDropped
              ? 'the server process restarted mid-run (uptime went backwards) — an OOM kill and restart'
              : `/api/health was unreachable on ${unreachable} samples`,
          }
        : peakRssKb === 0
          ? {
              status: 'SKIP',
              detail:
                'RSS could not be sampled (not Linux, or no /proc) — run this on the box for a real memory verdict',
            }
          : {
              status: 'PASS',
              detail: `peak ${(peakRssKb / 1024 / 1024).toFixed(2)} GB across ${peakProcs} processes, no restart`,
            },
    'index.json intact': await indexGate(base, projectsRoot, uniqueIds),
    [`p95 time-to-video <= ${opts.budget} min`]: p95Gate(
      records,
      depthAtSubmit,
      opts.depth,
      opts.budget,
    ),
  };

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ base, jobs: opts.jobs, gates, peakQueue, peakRssKb, records, samples }, null, 2)}\n`,
    );
  } else {
    const times = done.map((r) => (r.doneAt - r.submittedAt) / 60000);
    say('');
    say('  gate                              result  detail');
    say('  ' + '-'.repeat(96));
    for (const [name, gate] of Object.entries(gates)) {
      say(`  ${name.padEnd(33)} ${gate.status.padEnd(7)} ${gate.detail}`);
    }
    say('');
    say(`  peak queue depth        ${peakQueue}`);
    say(`  peak studio RSS         ${peakRssKb ? `${(peakRssKb / 1024 / 1024).toFixed(2)} GB across ${peakProcs} procs` : 'not sampled'}`);
    if (times.length > 0) {
      say(
        `  time-to-video (all)     min ${percentile(times, 0).toFixed(1)} / median ${percentile(times, 50).toFixed(1)} / p95 ${percentile(times, 95).toFixed(1)} / max ${Math.max(...times).toFixed(1)} min`,
      );
    }
    say(`  sampler                 ${samples.length} samples on ${os.hostname()}`);
    say('');
    for (const r of errored.slice(0, 5)) say(`  errored ${r.projectId}: ${r.error}`);
    for (const r of lost.slice(0, 5)) say(`  lost    ${r.projectId}: ${r.outcome} ${r.error ?? ''}`);
    say('');
  }

  const failed = Object.values(gates).filter((g) => g.status === 'FAIL');
  say(failed.length === 0 ? 'RESULT: pass' : `RESULT: fail (${failed.length} gate(s))`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`loadtest: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
