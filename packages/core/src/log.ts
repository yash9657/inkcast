/** Shared progress + logging so the CLI and the web studio speak one language. */

export type Progress = { stage: string; pct: number; note?: string };
export type OnProgress = (p: Progress) => void;

/**
 * Where a stage says it did something worse than it should have.
 *
 * `onProgress`'s sibling, and it exists for the same reason: the stage knows, and the
 * caller is the one that can persist. A stage that resolved an icon by a score-0
 * guess, minted an asset the planner never declared, or skipped a correction because
 * no preview rendered has produced a *worse artefact*, silently — the audit's X-e
 * class (plan item 3.4). A `log.warn` for those scrolls past in a four-minute render;
 * routed here they reach `problems[]` and `qc.json`, where they outlive the run.
 *
 * Deliberately not the same channel as `gate()`: a gate decides whether to *stop*.
 * This only records, and every gate that continues under `degrade` also lands here.
 */
export type OnProblem = (problem: string) => void;

/**
 * One billable call a stage actually made (plan item 3.5; audit X-c).
 *
 * The cost report is built from *observed quantities* — that is the rule at the top of
 * `pipeline/src/cost.ts` — and until this existed the only quantities the pipeline
 * could observe were the ones it could see from outside a stage: characters of
 * narration, images that appeared in the manifest, bytes of lesson JSON. Everything
 * that happens *inside* the lesson stage was therefore free by construction: the
 * drawing author composes a picture per beat and the critic looks at each one again,
 * five to ten pictures a video, two Opus calls each, and none of it appeared in any
 * total anybody was shown.
 *
 * Reported per call, at the call site, because that is the only place the numbers are
 * real: the Messages API returns its own `usage` block, so a line built from this is
 * priced from the provider's own token count rather than from characters divided by
 * four. The pipeline sums them.
 */
export type ModelSpend = {
  /** Which lane spent it — `drawing`, `drawing-fix`, `underlay`. */
  lane: string;
  provider: string;
  model?: string;
  /** Tokens the API reported. A text model reports both. */
  inTokens?: number;
  outTokens?: number;
  /** Images that were really generated. Never a cache hit — a cache hit is free. */
  images?: number;
};

export type OnSpend = (spend: ModelSpend) => void;

export type StageOptions = {
  onProgress?: OnProgress;
  /** Recompute even when a cached artefact is present. */
  force?: boolean;
  /** Where degradations this stage chose are recorded. See `OnProblem`. */
  onProblem?: OnProblem;
  /** Where billable calls this stage made are recorded. See `ModelSpend`. */
  onSpend?: OnSpend;
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(process.env.INKCAST_LOG as Level) ?? 'info'] ?? LEVELS.info;

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const COLOR: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  if (LEVELS[level] < threshold) return;
  const line = `${COLOR[level]}${level.padEnd(5)}${RESET} ${DIM}${scope}${RESET} ${msg}`;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(extra === undefined ? `${line}\n` : `${line} ${format(extra)}\n`);
}

function format(v: unknown): string {
  if (v instanceof Error) return `${DIM}${v.message}${RESET}`;
  if (typeof v === 'string') return v;
  try {
    return `${DIM}${JSON.stringify(v)}${RESET}`;
  } catch {
    return String(v);
  }
}

export type Logger = {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
  child(sub: string): Logger;
};

export function logger(scope: string): Logger {
  return {
    debug: (m, e) => emit('debug', scope, m, e),
    info: (m, e) => emit('info', scope, m, e),
    warn: (m, e) => emit('warn', scope, m, e),
    error: (m, e) => emit('error', scope, m, e),
    child: (sub) => logger(`${scope}:${sub}`),
  };
}

/** Clamp + forward progress, tolerating a missing callback. */
export function report(opts: StageOptions | undefined, p: Progress): void {
  opts?.onProgress?.({ ...p, pct: Math.max(0, Math.min(100, Math.round(p.pct))) });
}

/**
 * Record a degradation, tolerating a caller that is not collecting them.
 *
 * Always alongside a `log.warn`, never instead of one: the log is for the person
 * watching the render, this is for the person reading `qc.json` next week.
 */
export function noteProblem(opts: StageOptions | undefined, message: string): void {
  opts?.onProblem?.(message);
}

/** Record a billable call, tolerating a caller that is not costing them. */
export function noteSpend(opts: StageOptions | undefined, spend: ModelSpend): void {
  opts?.onSpend?.(spend);
}
