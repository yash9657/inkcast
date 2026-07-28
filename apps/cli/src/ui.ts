/**
 * Terminal output: a real progress bar when stdout is a TTY, honest plain lines
 * when it is not (CI, pipes, `--json`, `--verbose`).
 *
 * The bar hijacks `stdout.write`/`stderr.write` while it is live so a warning
 * from a stage erases the bar, prints cleanly, and the bar redraws underneath —
 * without that, one `logger.warn` shreds the line and the run looks broken.
 */
import type { Progress } from '@inkcast/core';
import { STAGE_LABEL, STAGES, type StageName } from '@inkcast/pipeline';
import type { CliContext } from './env.js';

/* ------------------------------------------------------------------ colours */

export type Paint = Record<
  'dim' | 'bold' | 'cyan' | 'green' | 'red' | 'yellow' | 'magenta' | 'grey',
  (s: string) => string
>;

const CODES = {
  dim: '2',
  bold: '1',
  cyan: '36',
  green: '32',
  red: '31',
  yellow: '33',
  magenta: '35',
  grey: '90',
} as const;

export function paint(color: boolean): Paint {
  const out = {} as Paint;
  for (const [name, code] of Object.entries(CODES) as [keyof typeof CODES, string][]) {
    out[name] = color ? (s: string) => `\x1b[${code}m${s}\x1b[0m` : (s: string) => s;
  }
  return out;
}

/* ------------------------------------------------------------------- format */

/** `92` -> `1:32`. Used for video runtimes. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `1234` -> `1.2s`, `340` -> `0.3s`, `95000` -> `95.0s`. */
export function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/* ----------------------------------------------------------------- reporter */

export type Reporter = {
  /** Hand this to the pipeline's `onProgress`. */
  progress: (p: Progress) => void;
  /** Print a line without breaking the bar. */
  note: (msg: string) => void;
  /** Stop drawing and restore the streams. Safe to call twice. */
  stop: () => void;
  /** Milliseconds observed per stage, as a fallback for a failed run. */
  observed: () => Partial<Record<StageName, number>>;
};

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ERASE = '\r\x1b[2K';

export function reporter(ctx: CliContext): Reporter {
  const c = paint(ctx.color);
  const started = Date.now();
  const observed: Partial<Record<StageName, number>> = {};
  const stageStart = new Map<StageName, number>();

  let stage: StageName = 'ingest';
  let pct = 0;
  let stagePct = 0;
  let note = '';
  let frame = 0;
  let live = false;
  let lastPlain = -1;

  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  const track = (next: StageName) => {
    if (!stageStart.has(next)) stageStart.set(next, Date.now());
    if (next !== stage) {
      observed[stage] = Date.now() - (stageStart.get(stage) ?? started);
      // In plain mode the finished-stage line is the only timing feedback there
      // is; in --json / --quiet mode stdout belongs to the payload alone.
      if (!ctx.tty && !ctx.quiet) {
        stdoutWrite(`${c.green('✓')} ${stage} ${c.dim(secs(observed[stage] ?? 0))}\n`);
      }
      stage = next;
      lastPlain = -1;
    }
  };

  const line = () => {
    const width = Math.max(10, Math.min((process.stdout.columns ?? 80) - 46, 34));
    const filled = Math.round((pct / 100) * width);
    const bar = `${'█'.repeat(filled)}${c.dim('░'.repeat(width - filled))}`;
    const head = `${c.cyan(FRAMES[frame % FRAMES.length]!)} ${c.bold(stage.padEnd(7))}`;
    const tail = `${String(Math.round(pct)).padStart(3)}%  ${c.dim(`${note || STAGE_LABEL[stage]} · ${secs(Date.now() - started)}`)}`;
    return `${head}${bar} ${tail}`;
  };

  const draw = () => {
    if (!live) return;
    stdoutWrite(`${ERASE}${line()}`);
  };

  let timer: NodeJS.Timeout | undefined;
  const start = () => {
    if (live || !ctx.tty) return;
    live = true;
    // Route other writers around the bar.
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      stdoutWrite(ERASE);
      const r = (stdoutWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
      draw();
      return r;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      stdoutWrite(ERASE);
      const r = (stderrWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
      draw();
      return r;
    }) as typeof process.stderr.write;
    stdoutWrite('\x1b[?25l'); // hide cursor
    timer = setInterval(() => {
      frame++;
      draw();
    }, 90);
    timer.unref();
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!live) return;
    live = false;
    process.stdout.write = stdoutWrite as typeof process.stdout.write;
    process.stderr.write = stderrWrite as typeof process.stderr.write;
    stdoutWrite(`${ERASE}\x1b[?25h`); // erase bar, show cursor
  };

  return {
    progress(p: Progress) {
      const next = (STAGES as readonly string[]).includes(p.stage) ? (p.stage as StageName) : stage;
      track(next);
      pct = p.pct;
      stagePct = (p as { stagePct?: number }).stagePct ?? p.pct;
      note = p.note ?? '';
      if (ctx.tty) {
        start();
        draw();
        return;
      }
      if (ctx.quiet) return;
      // Plain mode: one line per 10% of a stage, so logs stay readable.
      const bucket = Math.floor(stagePct / 10);
      if (bucket !== lastPlain) {
        lastPlain = bucket;
        const tail = note ? `  ${c.dim(note)}` : '';
        stdoutWrite(`${stage.padEnd(8)}${String(Math.round(p.pct)).padStart(3)}%${tail}\n`);
      }
    },
    note(msg: string) {
      if (ctx.quiet) return;
      if (live) {
        stdoutWrite(`${ERASE}${msg}\n`);
        draw();
      } else {
        stdoutWrite(`${msg}\n`);
      }
    },
    stop() {
      observed[stage] = Date.now() - (stageStart.get(stage) ?? started);
      stop();
    },
    observed: () => observed,
  };
}
