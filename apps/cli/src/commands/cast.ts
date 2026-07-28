/**
 * `cast <file|url|->` — the main command.
 *
 * Resolves the input, runs the pipeline with live progress, then prints a
 * summary that answers the three questions people actually have: where is my
 * video, how long did each stage take, and what did it cost.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { frameSize, totalDuration } from '@inkcast/core';
import { cast, formatCost, STAGES, type CastInput, type CastResult } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { metaFromFlags, UsageError, type Flags } from '../main.js';
import { bytes, clock, paint, reporter, secs } from '../ui.js';
import { openInOs, pretty } from './shared.js';

const DOCUMENT_EXT = /\.(md|markdown|txt|text|pdf|docx|html?|rtf|json|adoc|rst)$/i;

export async function castCommand(
  ctx: CliContext,
  positionals: string[],
  flags: Flags,
): Promise<number> {
  const c = paint(ctx.color);
  const input = await buildInput(ctx, positionals, flags);

  const rep = reporter(ctx);
  const cleanup = () => rep.stop();
  process.once('SIGINT', () => {
    cleanup();
    process.stderr.write(
      `\n${c.yellow('interrupted')} — progress is on disk, re-run the same command to resume.\n`,
    );
    process.exit(1);
  });

  if (!ctx.json && !ctx.quiet) {
    rep.note(
      `${c.bold('inkcast')} ${c.dim('·')} ${describe(input)} ${c.dim('·')} ${input.meta?.aspect ?? '16:9'} ${input.meta?.style ?? 'marker'}`,
    );
  }

  let result: CastResult;
  try {
    result = await cast(input, {
      ...(flags.project ? { projectId: flags.project } : {}),
      force: flags.force,
      onProgress: rep.progress,
    });
  } catch (err) {
    cleanup();
    if (ctx.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2)}\n`,
      );
      return 1;
    }
    throw err;
  }
  cleanup();

  const copied = flags.out ? await copyOut(ctx, result, flags.out) : undefined;

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(jsonResult(result, copied), null, 2)}\n`);
  } else if (!ctx.quiet) {
    await printSummary(ctx, result, copied);
  }

  if (flags.open) openInOs(copied ?? result.videoPath);
  return 0;
}

/* -------------------------------------------------------------------- input */

async function buildInput(
  ctx: CliContext,
  positionals: string[],
  flags: Flags,
): Promise<CastInput> {
  const meta = metaFromFlags(flags);
  const base: CastInput = {
    ...(flags.title ? { title: flags.title } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
  const first = positionals[0];
  if (!first) throw new UsageError('nothing to cast — pass a file, a URL, `-` for stdin, or text');

  if (first === '-') {
    if (process.stdin.isTTY) {
      throw new UsageError('`-` reads from stdin, but stdin is a terminal. Pipe something in.');
    }
    const text = await readStdin();
    if (text.trim() === '') throw new Error('stdin was empty');
    return { ...base, text };
  }

  if (/^https?:\/\//i.test(first)) return { ...base, url: first };

  for (const candidate of [path.resolve(ctx.cwd, first), path.resolve(ctx.root, first)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { ...base, filePath: candidate };
    }
  }

  // Anything path-shaped that does not exist is a mistake, not a prompt.
  if (first.includes('/') || first.includes(path.sep) || DOCUMENT_EXT.test(first)) {
    throw new Error(`no such file: ${first}`);
  }

  const text = positionals.join(' ').trim();
  if (text.length < 12) {
    throw new UsageError(
      `"${text}" is neither a file nor enough text to make a video. Pass a document, a URL, or a sentence.`,
    );
  }
  return { ...base, text };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function describe(input: CastInput): string {
  if (input.filePath) return path.basename(input.filePath);
  if (input.url) return input.url;
  return `${(input.text ?? '').trim().split(/\s+/).length} words of text`;
}

/* ------------------------------------------------------------------- output */

async function copyOut(ctx: CliContext, result: CastResult, out: string): Promise<string> {
  let target = path.resolve(ctx.cwd, out);
  const intoDir = out.endsWith('/') || out.endsWith(path.sep) || isDir(target);
  if (intoDir) target = path.join(target, `${slug(result.storyboard.title)}.mp4`);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(result.videoPath, target);
  return target;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s === '' ? 'inkcast' : s.slice(0, 60);
}

function jsonResult(result: CastResult, copied?: string) {
  const sb = result.storyboard;
  const { w, h } = frameSize(sb.meta.aspect);
  return {
    ok: true,
    projectId: result.projectId,
    title: sb.title,
    videoPath: result.videoPath,
    ...(copied ? { copiedTo: copied } : {}),
    dir: result.dir,
    storyboardPath: path.join(result.dir, 'storyboard.json'),
    durationSec: Math.round(totalDuration(sb) * 100) / 100,
    scenes: sb.scenes.length,
    assets: sb.assets.length,
    width: w,
    height: h,
    meta: sb.meta,
    timings: result.timings,
    skipped: result.skipped,
    cost: result.cost,
    providers: {
      planner: result.providers.planner.name,
      voice: result.providers.voice.name,
      images: result.providers.images.name,
    },
  };
}

async function printSummary(ctx: CliContext, result: CastResult, copied?: string): Promise<void> {
  const c = paint(ctx.color);
  const sb = result.storyboard;
  const { w, h } = frameSize(sb.meta.aspect);
  const size = await stat(result.videoPath)
    .then((s) => bytes(s.size))
    .catch(() => 'unknown size');
  const total = Object.values(result.timings).reduce((a, b) => a + (b ?? 0), 0);

  const row = (label: string, value: string) => `  ${c.dim(label.padEnd(11))}${value}\n`;
  let out = `\n${c.green('✔')} ${c.bold(sb.title)} ${c.dim(`· ${clock(totalDuration(sb))} · ${secs(total)}`)}\n\n`;
  out += row(
    'video',
    `${pretty(ctx, result.videoPath)} ${c.dim(`(${w}×${h}, ${sb.meta.fps}fps, ${size})`)}`,
  );
  if (copied) out += row('copied', pretty(ctx, copied));
  out += row(
    'storyboard',
    `${pretty(ctx, path.join(result.dir, 'storyboard.json'))} ${c.dim(`(${count(sb.scenes.length, 'scene')}, ${count(sb.assets.length, 'asset')})`)}`,
  );
  out += row(
    'stages',
    STAGES.map((s) =>
      result.skipped.includes(s)
        ? c.dim(`${s} cached`)
        : `${s} ${c.dim(secs(result.timings[s] ?? 0))}`,
    ).join(c.dim(' · ')),
  );
  out += row(
    'providers',
    [
      `plan ${result.providers.planner.name}`,
      `voice ${result.providers.voice.name}`,
      `art ${result.providers.images.name}`,
    ]
      .map((s) => c.dim(s))
      .join(c.dim(' · ')),
  );

  const cost = result.cost;
  const costLine = cost.local
    ? `${c.green(formatCost(cost))} ${c.dim('— nothing left this machine')}`
    : `${c.yellow(formatCost(cost))} ${c.dim(`(estimated · ${cost.lines.map((l) => `${l.stage} ${l.provider} $${l.usd.toFixed(4)}`).join(', ')} · $${cost.perMinuteUsd.toFixed(3)}/min)`)}`;
  out += row('cost', costLine);

  out += `\n  ${c.dim(`next: inkcast preview ${result.projectId}   ·   inkcast edit ${result.projectId} "…"`)}\n\n`;
  process.stdout.write(out);
}
