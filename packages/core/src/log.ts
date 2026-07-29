/** Shared progress + logging so the CLI and the web studio speak one language. */

export type Progress = { stage: string; pct: number; note?: string };
export type OnProgress = (p: Progress) => void;

export type StageOptions = {
  onProgress?: OnProgress;
  /** Recompute even when a cached artefact is present. */
  force?: boolean;
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
