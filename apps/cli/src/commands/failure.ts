/**
 * Failure output. A failed run should tell you which stage broke, why, and what
 * to do about it — the three things a stack trace does not.
 */
import { rootCauseMessage, StageError } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { paint } from '../ui.js';

/** Known failure shapes and the one command that fixes each. */
const HINTS: Array<{ test: RegExp; hint: string }> = [
  {
    test: /playwright|chromium|browserType\.launch|executablePath/i,
    hint: 'Install the browser once: `pnpm exec playwright install chromium`',
  },
  {
    test: /ffmpeg|ffprobe|ENOENT.*ffmpeg/i,
    hint: 'Install ffmpeg (macOS: `brew install ffmpeg`, Debian: `apt install ffmpeg`)',
  },
  {
    test: /cannot load @inkcast|Cannot find (module|package)/i,
    hint: 'Run `pnpm install` at the repo root',
  },
  {
    test: /401|403|authentication|invalid.*api key|unauthorized/i,
    hint: 'A provider rejected its key. Unset it in .env to fall back to the local default.',
  },
  {
    test: /ENOTFOUND|EAI_AGAIN|fetch failed|network/i,
    hint: 'Network unavailable. The local providers need no network once model weights are cached.',
  },
  {
    test: /ENOSPC/i,
    hint: 'The disk is full — frames and audio need room under projects/.',
  },
];

export function reportFailure(ctx: CliContext, err: unknown): void {
  const c = paint(ctx.color);
  const stage = err instanceof StageError ? err.stage : undefined;
  const message = err instanceof Error ? err.message : String(err);
  const cause = rootCauseMessage(err);

  const where = stage ? c.magenta(`${stage} stage`) : 'inkcast';
  process.stderr.write(`\n${c.red('✗')} ${where} failed\n`);
  process.stderr.write(`  ${message.replace(/^\[[a-z]+\]\s*/, '')}\n`);
  if (cause && cause !== message && !message.includes(cause)) {
    process.stderr.write(`  ${c.dim(`cause: ${cause}`)}\n`);
  }

  const haystack = `${message}\n${cause}`;
  const hint = HINTS.find((h) => h.test.test(haystack))?.hint;
  if (hint) process.stderr.write(`\n  ${c.yellow('→')} ${hint}\n`);

  if (err instanceof StageError && err.projectId) {
    process.stderr.write(
      `  ${c.dim(`Nothing is lost: re-run the same command to resume project ${err.projectId}.`)}\n`,
    );
  }
  if (ctx.verbose && err instanceof Error && err.stack) {
    process.stderr.write(`\n${c.dim(err.stack)}\n`);
  } else if (!ctx.verbose) {
    process.stderr.write(`  ${c.dim('Re-run with --verbose for the full stack trace.')}\n`);
  }
  process.stderr.write('\n');
}
