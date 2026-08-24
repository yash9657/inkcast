/**
 * `cast <file|url|topic|lesson.json|->` and the shared run/report machinery.
 *
 * Resolves the input, prints anything that is running degraded *before* the work
 * starts (with the one command that fixes it), runs the pipeline with live
 * progress, then prints a summary that answers the four questions people actually
 * have: what does it teach, where is my video, how long did each stage take, and
 * what did it cost.
 *
 * `teach` is the same machinery with a topic instead of a document, so both
 * commands share `runCast`.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { frameSize, totalDuration } from '@inkcast/core';
import {
  cast,
  degradations,
  formatCost,
  providers as detectProviders,
  STAGES,
  type CastInput,
  type CastResult,
  type Degradation,
} from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { metaFromFlags, lessonFromFlags, UsageError, type Flags } from '../main.js';
import { bytes, clock, paint, reporter, secs } from '../ui.js';
import { openInOs, pretty } from './shared.js';

const DOCUMENT_EXT = /\.(md|markdown|txt|text|pdf|docx|html?|rtf|json|adoc|rst)$/i;
const LESSON_EXT = /\.lesson\.json$/i;

/**
 * Free text shorter than this is treated as a **topic** to teach, not as source
 * material to summarise. `cast "gradient descent"` should teach gradient descent;
 * only something document-length is a document.
 */
const TOPIC_MAX_CHARS = 140;

export async function castCommand(
  ctx: CliContext,
  positionals: string[],
  flags: Flags,
): Promise<number> {
  return runCast(ctx, await buildInput(ctx, positionals, flags), flags);
}

/* ---------------------------------------------------------------- the run */

export async function runCast(ctx: CliContext, input: CastInput, flags: Flags): Promise<number> {
  const c = paint(ctx.color);
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
      `${c.bold('inkcast')} ${c.dim('·')} ${describe(input)} ${c.dim('·')} ${input.meta?.aspect ?? '16:9'} ${input.meta?.style ?? 'marker'}${input.depth ? c.dim(` · ${input.depth}`) : ''}`,
    );
    // Before the work, not after: the point of saying it is that the user can
    // stop, run one command, and get a better video instead of a worse one.
    for (const line of degradationLines(ctx, input)) rep.note(line);
  }

  let result: CastResult;
  try {
    result = await cast(input, {
      ...(flags.project ? { projectId: flags.project } : {}),
      force: flags.force,
      ...(flags.degrade ? { gates: 'degrade' as const } : {}),
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
  const base = baseInput(flags);
  const lessonFlag = lessonFromFlags(ctx, flags);
  if (lessonFlag) return { ...base, lesson: lessonFlag };

  const first = positionals[0];
  if (!first) {
    throw new UsageError(
      'nothing to cast — pass a topic, a file, a URL, `-` for stdin, or a *.lesson.json',
    );
  }

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
      // A hand-authored lesson goes straight to the compiler: no planner, no key.
      return LESSON_EXT.test(candidate)
        ? { ...base, lesson: candidate }
        : { ...base, filePath: candidate };
    }
  }

  // Anything path-shaped that does not exist is a mistake, not a prompt.
  if (first.includes('/') || first.includes(path.sep) || DOCUMENT_EXT.test(first)) {
    throw new Error(`no such file: ${first}`);
  }

  const text = positionals.join(' ').trim();
  if (text.length < 3) {
    throw new UsageError(
      `"${text}" is neither a file nor a topic. Pass a topic, a document, or a URL.`,
    );
  }
  // Short free text is a topic to teach; document-length text is source material.
  return text.length <= TOPIC_MAX_CHARS && !text.includes('\n')
    ? { ...base, topic: text }
    : { ...base, text };
}

/** Everything the flags contribute, independent of what the positional was. */
export function baseInput(flags: Flags): CastInput {
  const meta = metaFromFlags(flags);
  return {
    ...(flags.title ? { title: flags.title } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    ...(flags.preset ? { preset: flags.preset } : {}),
    // Beside `preset` and not inside `meta`: the mode is a request the compiler has to
    // act on, and `meta` is stamped onto the finished storyboard after it has compiled.
    ...(flags.board ? { board: flags.board } : {}),
    ...(flags.depth ? { depth: flags.depth } : {}),
    ...(flags.seconds ? { maxSeconds: flags.seconds } : {}),
    ...(flags.audience ? { audience: flags.audience } : {}),
    ...(flags.objective ? { objective: flags.objective } : {}),
    ...(flags.brief ? { brief: flags.brief } : {}),
    ...(flags.via ? { via: flags.via } : {}),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function describe(input: CastInput): string {
  if (input.topic) return `teaching “${input.topic}”`;
  if (input.lesson) {
    return typeof input.lesson === 'string'
      ? `lesson ${path.basename(input.lesson)}`
      : 'a supplied lesson';
  }
  if (input.filePath) return path.basename(input.filePath);
  if (input.url) return input.url;
  return `${(input.text ?? '').trim().split(/\s+/).length} words of text`;
}

/* ------------------------------------------------------------- degradation */

/** What is running in its lesser mode, and the command that fixes it. */
export function degradationLines(ctx: CliContext, input: CastInput): string[] {
  const c = paint(ctx.color);
  const provs = detectProviders(input.meta?.voice);
  const found: Degradation[] = degradations(provs, {
    ...(input.via ? { via: input.via } : {}),
    ...(input.lesson === undefined ? {} : { lessonSupplied: true }),
  });
  const lines: string[] = [];
  for (const d of found) {
    if (d.severity === 'major') {
      lines.push(
        `${c.yellow('degraded')} ${c.bold(d.stage)} ${c.dim(`— ${d.missing}.`)} ${d.effect}\n         ${c.dim('fix:')} ${c.cyan(d.fix)}`,
      );
    } else {
      lines.push(`${c.dim(`         ${d.stage}: ${d.missing} — ${d.effect} fix: ${d.fix}`)}`);
    }
  }
  return lines;
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
    ...(result.lessonPath ? { lessonPath: result.lessonPath } : {}),
    lesson: result.lesson
      ? {
          topic: result.lesson.topic,
          audience: result.lesson.audience,
          objective: result.lesson.objective,
          steps: result.lesson.steps.length,
        }
      : undefined,
    lessonProblems: result.problems,
    grounding: result.grounding,
    // Beside the lesson's problems and in the same shape, because they are the same
    // kind of fact: something about this render is worse than the command asked for.
    voiceProblems: result.voice.problems,
    lessonAuthor: result.author,
    route: result.route,
    preset: result.preset,
    targetSec: result.targetSec,
    durationSec: Math.round(totalDuration(sb) * 100) / 100,
    scenes: sb.scenes.length,
    assets: sb.assets.length,
    width: w,
    height: h,
    meta: sb.meta,
    timings: result.timings,
    skipped: result.skipped,
    cost: result.cost,
    degraded: result.degradations,
    providers: {
      planner: result.providers.planner.name,
      // The provider that spoke, not the key that was set. `result.providers.voice`
      // is the environment's intention and is wrong exactly when the chain demoted.
      voice: voiceLabel(result),
      images: result.providers.images.name,
    },
  };
}

/** One line for what the film's facts rest on. See `Grounding` in `@inkcast/pipeline`. */
function groundingLine(ctx: CliContext, result: CastResult): string {
  const c = paint(ctx.color);
  switch (result.grounding) {
    case 'document':
      return `${c.dim('the source document')} ${c.dim(`— ${path.join(result.dir, 'source.json')}`)}`;
    case 'supplied':
      return c.dim('the supplied lesson — this pipeline sourced nothing itself');
    default:
      return `${c.yellow('nothing')} ${c.dim('— every claim is the model’s own knowledge, unchecked')}`;
  }
}

/** `elevenlabs/eleven_flash_v2_5` — who spoke and what they spoke with. */
function voiceLabel(result: CastResult): string {
  return `${result.voice.provider}${result.voice.model ? `/${result.voice.model}` : ''}`;
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

  if (result.lesson) {
    // The objective is the acceptance test for the whole video, so it leads.
    out += row('teaches', result.lesson.objective);
    out += row(
      'lesson',
      `${pretty(ctx, result.lessonPath ?? path.join(result.dir, 'lesson.json'))} ${c.dim(
        `(${count(result.lesson.steps.length, 'step')}, for ${result.lesson.audience})`,
      )}`,
    );
  } else {
    out += row('lesson', c.yellow('none — this was cast with --via document, which summarises'));
  }
  // What the facts rest on (plan 5.1; audit S0-a). Said plainly and without alarm:
  // teaching a bare topic is the normal way this is used, and the thing worth knowing is
  // that nobody checked those claims against anything, because there was nothing to
  // check them against.
  out += row('grounded', groundingLine(ctx, result));
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
      result.skipped.includes(s) ? c.dim(`${s} —`) : `${s} ${c.dim(secs(result.timings[s] ?? 0))}`,
    ).join(c.dim(' · ')),
  );
  out += row(
    'providers',
    [
      // Who wrote the lesson, not which key happens to be set.
      `lesson ${result.author}`,
      `voice ${voiceLabel(result)}`,
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

  if (result.problems.length > 0) {
    out += `\n  ${c.yellow('the lesson has known weaknesses:')}\n`;
    for (const p of result.problems.slice(0, 5)) out += `    ${c.dim('·')} ${p}\n`;
    const major = result.degradations.find((d) => d.severity === 'major');
    if (major) out += `    ${c.dim('fix:')} ${c.cyan(major.fix)}\n`;
  }

  // Its own block rather than an addition to the one above, which is gated entirely on
  // the lesson's problems: a paid voice that ran out of credits half way through a
  // flawless lesson used to print nothing at all.
  if (result.voice.problems.length > 0) {
    out += `\n  ${c.yellow('the voice did not come out as asked:')}\n`;
    for (const p of result.voice.problems) out += `    ${c.dim('·')} ${p}\n`;
  }

  out += `\n  ${c.dim(`next: inkcast lesson ${result.projectId}   ·   inkcast preview ${result.projectId}   ·   inkcast edit ${result.projectId} "…"`)}\n\n`;
  process.stdout.write(out);
}
