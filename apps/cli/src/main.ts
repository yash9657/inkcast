/**
 * Argument parsing and command dispatch, on `node:util`'s `parseArgs`.
 *
 * Exit codes are the contract with scripts and CI: 0 success, 1 handled
 * failure, 2 bad usage. Every path through this file returns one of those three.
 *
 * One ordering rule matters here: stored API keys are copied into `process.env`
 * *before* any command that runs a stage, because every stage adapter picks its
 * provider by reading the environment. The `keys` command is the deliberate
 * exception — it has to see the real environment to report which key wins.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { styleIds } from '@inkcast/core';
import type { StoryboardMeta } from '@inkcast/core';
import type { CliContext } from './env.js';
import { paint } from './ui.js';
import { usage } from './usage.js';
import { hydrateKeys } from './vault.js';

const ASPECTS = ['16:9', '9:16', '1:1'] as const;
/*
 * The style list is *loaded*, not literal (plan 7.3): a style is a JSON file in `styles/`,
 * so a fifth one has to be accepted by the flag and printed in the help without either
 * being edited. `styleIds()` reads that directory once and both callers ask it — see
 * `usage.ts`, and the mirror test in `test/flags.test.ts` that holds the two together the
 * way the preset list is held.
 */
const PALETTES = ['mono', 'color'] as const;
/*
 * The third copy of this list, and the one that *rejects*. `packages/planner/src/presets.ts`
 * defines the presets, `packages/pipeline/src/stages.ts` mirrors the names into the stage
 * contract, and this validates the flag — so `explainer`, missing from the second and third,
 * was a preset the planner had and no user could ask for: `readFlags` threw
 * `--preset must be one of standard | short | square, got "explainer"`.
 *
 * Kept as a local literal rather than imported from the planner because `oneOf` needs a
 * runtime array and the CLI must be able to parse flags and print usage before any stage
 * package is loaded — the whole point of `stages.ts`'s lazy thunks. `usage.ts` carries the
 * same four names in prose and has to move with this line; there is no way to make a help
 * string a compile error, so the pair is checked in `test/flags.test.ts` instead.
 */
const PRESETS = ['standard', 'short', 'square', 'explainer'] as const;
const DEPTHS = ['quick', 'standard', 'deep'] as const;
const ROUTES = ['lesson', 'document'] as const;
const BOARDS = ['accumulate', 'wipe'] as const;

const COMMANDS = [
  'teach',
  'cast',
  'lesson',
  'keys',
  'list',
  'open',
  'edit',
  'rerender',
  'preview',
  'providers',
  'help',
] as const;
type Command = (typeof COMMANDS)[number];

/** Commands that never run a stage, so they must not have the env hydrated. */
const NO_HYDRATE: ReadonlySet<Command> = new Set(['keys', 'help', 'list']);

export type Flags = {
  title?: string;
  aspect?: (typeof ASPECTS)[number];
  lang?: string;
  voice?: string;
  style?: string;
  palette?: (typeof PALETTES)[number];
  preset?: (typeof PRESETS)[number];
  depth?: (typeof DEPTHS)[number];
  via?: (typeof ROUTES)[number];
  /** What the board does between beats. See `--board` in `usage.ts`. */
  board?: (typeof BOARDS)[number];
  /** Hard runtime target in seconds. */
  seconds?: number;
  audience?: string;
  objective?: string;
  brief?: string;
  /** Path to a hand-authored `*.lesson.json`. */
  lesson?: string;
  out?: string;
  project?: string;
  port?: number;
  force: boolean;
  open: boolean;
  /**
   * `--degrade`: run with the quality gates in log-and-continue mode. The default
   * is strict — a detected defect (uncovered glyph, equation fallback, missing
   * font, missed cue on a dominant visual) stops the run before the encode.
   */
  degrade: boolean;
  /**
   * `--emit-plan`: also write the compiled render plan to `<project>/plan.json`.
   *
   * A report, never an input — nothing reads it back (see `emitPlan` in
   * `@inkcast/render`). Off by default because a plan written on every run is a
   * derived copy that can drift out of step with the storyboard it came from.
   */
  emitPlan: boolean;
};

export class UsageError extends Error {}

export async function run(argv: string[], ctx: CliContext): Promise<number> {
  const c = paint(ctx.color);
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        title: { type: 'string', short: 't' },
        aspect: { type: 'string' },
        short: { type: 'boolean', default: false },
        lang: { type: 'string' },
        voice: { type: 'string' },
        style: { type: 'string' },
        palette: { type: 'string' },
        preset: { type: 'string' },
        depth: { type: 'string' },
        board: { type: 'string' },
        seconds: { type: 'string' },
        audience: { type: 'string' },
        objective: { type: 'string' },
        brief: { type: 'string' },
        lesson: { type: 'string' },
        via: { type: 'string' },
        out: { type: 'string', short: 'o' },
        project: { type: 'string' },
        port: { type: 'string' },
        force: { type: 'boolean', short: 'f', default: false },
        degrade: { type: 'boolean', default: false },
        'emit-plan': { type: 'boolean', default: false },
        open: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        verbose: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', default: false },
      },
    });
  } catch (err) {
    process.stderr.write(
      `${c.red('usage:')} ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.stderr.write(`Try ${c.cyan('inkcast --help')}.\n`);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (values.help && positionals.length === 0) {
    process.stdout.write(usage(ctx.color));
    return 0;
  }

  const command = pickCommand(positionals);
  const rest = command && positionals[0] === command ? positionals.slice(1) : positionals;
  const effective: Command = command ?? 'cast';

  try {
    const flags = readFlags(values);
    if (!NO_HYDRATE.has(effective)) {
      // Stored keys only take effect once they are in the environment.
      await hydrateKeys();
    }

    switch (effective) {
      case 'help':
        process.stdout.write(usage(ctx.color));
        return 0;
      case 'keys': {
        const { keysCommand } = await import('./commands/keys.js');
        return await keysCommand(ctx, rest);
      }
      case 'lesson': {
        const { lessonCommand } = await import('./commands/lesson.js');
        return await lessonCommand(ctx, rest[0]);
      }
      case 'teach': {
        const { teachCommand } = await import('./commands/teach.js');
        return await teachCommand(ctx, rest, flags);
      }
      case 'list': {
        const { listCommand } = await import('./commands/list.js');
        return await listCommand(ctx);
      }
      case 'open': {
        const { openCommand } = await import('./commands/open.js');
        return await openCommand(ctx, rest[0]);
      }
      case 'edit': {
        const { editCommand } = await import('./commands/edit.js');
        return await editCommand(ctx, rest[0], rest.slice(1).join(' '));
      }
      case 'rerender': {
        const { rerenderCommand } = await import('./commands/rerender.js');
        return await rerenderCommand(ctx, rest[0], flags);
      }
      case 'preview': {
        const { previewCommand } = await import('./commands/preview.js');
        return await previewCommand(ctx, rest[0], flags);
      }
      case 'providers': {
        const { providersCommand } = await import('./commands/providers.js');
        return await providersCommand(ctx);
      }
      default: {
        // `cast` with nothing to cast, and no --lesson to fall back on.
        if (rest.length === 0 && !flags.lesson && !values.help) {
          process.stdout.write(usage(ctx.color));
          return 2;
        }
        const { castCommand } = await import('./commands/cast.js');
        return await castCommand(ctx, rest, flags);
      }
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${c.red('usage:')} ${err.message}\n`);
      return 2;
    }
    const { reportFailure } = await import('./commands/failure.js');
    reportFailure(ctx, err);
    return 1;
  }
}

/** A leading positional is a subcommand unless a file by that name exists. */
function pickCommand(positionals: string[]): Command | undefined {
  const first = positionals[0];
  if (!first) return undefined;
  if (!(COMMANDS as readonly string[]).includes(first)) return undefined;
  // A file literally named `list` still wins — reading it is what the user meant.
  if (existsSync(first)) return undefined;
  return first as Command;
}

/** Exported for tests: the mapping from raw `parseArgs` values to `Flags`. */
export function readFlags(values: Record<string, unknown>): Flags {
  const flags: Flags = {
    force: values.force === true,
    open: values.open === true,
    degrade: values.degrade === true,
    emitPlan: values['emit-plan'] === true,
  };
  if (typeof values.title === 'string') flags.title = values.title;
  if (typeof values.out === 'string') flags.out = values.out;
  if (typeof values.project === 'string') flags.project = values.project;
  if (typeof values.lang === 'string') flags.lang = values.lang.trim();
  if (typeof values.voice === 'string') flags.voice = values.voice.trim();
  if (typeof values.audience === 'string') flags.audience = values.audience.trim();
  if (typeof values.objective === 'string') flags.objective = values.objective.trim();
  if (typeof values.brief === 'string') flags.brief = values.brief.trim();
  if (typeof values.lesson === 'string') flags.lesson = values.lesson;
  if (typeof values.aspect === 'string') flags.aspect = oneOf('aspect', values.aspect, ASPECTS);
  if (typeof values.style === 'string') flags.style = oneOf('style', values.style, styleIds());
  if (typeof values.palette === 'string') {
    flags.palette = oneOf('palette', values.palette, PALETTES);
  }
  if (typeof values.preset === 'string') flags.preset = oneOf('preset', values.preset, PRESETS);
  if (typeof values.depth === 'string') flags.depth = oneOf('depth', values.depth, DEPTHS);
  if (typeof values.via === 'string') flags.via = oneOf('via', values.via, ROUTES);
  if (typeof values.board === 'string') flags.board = oneOf('board', values.board, BOARDS);

  // Refused rather than ignored. `--via document` never reaches `compileLesson`, and
  // the document planners compose their own boards, so accepting `--board` on that
  // route would print a mode nothing performs — the same silent no-op that let `wipe`
  // ship with nothing able to ask for it. Two flags that contradict each other are a
  // question for the user, not something to resolve on their behalf.
  if (flags.board && flags.via === 'document') {
    throw new UsageError(
      '--board only applies to the lesson route; --via document summarises and composes ' +
        'its own board. Drop one of the two.',
    );
  }

  // `--short` is the headline form of "9:16 vertical, short-form pacing". It sets
  // both the aspect and the preset, because a short is not a cropped landscape
  // video — it has its own beat budget and its own type scale.
  if (values.short === true) {
    flags.preset ??= 'short';
    flags.aspect ??= '9:16';
  }
  // An explicit --aspect 9:16 without a preset means the same thing.
  if (flags.aspect === '9:16') flags.preset ??= 'short';

  if (typeof values.seconds === 'string') {
    const seconds = Number(values.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new UsageError(`--seconds must be a positive number, got "${values.seconds}"`);
    }
    flags.seconds = Math.round(seconds);
  }
  if (typeof values.port === 'string') {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new UsageError(`--port must be a number between 1 and 65535, got "${values.port}"`);
    }
    flags.port = port;
  }
  return flags;
}

function oneOf<T extends readonly string[]>(name: string, value: string, allowed: T): T[number] {
  const v = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(v)) return v as T[number];
  throw new UsageError(`--${name} must be one of ${allowed.join(' | ')}, got "${value}"`);
}

/** Storyboard meta overrides from the flags the user actually passed. */
export function metaFromFlags(flags: Flags): Partial<StoryboardMeta> {
  const meta: Partial<StoryboardMeta> = {};
  if (flags.aspect) meta.aspect = flags.aspect;
  if (flags.style) meta.style = flags.style;
  if (flags.palette) meta.palette = flags.palette;
  if (flags.lang) meta.language = flags.lang;
  if (flags.voice) meta.voice = flags.voice;
  return meta;
}

/** `--lesson <path>`, resolved against the cwd then the repo root. */
export function lessonFromFlags(
  ctx: { cwd: string; root: string },
  flags: Flags,
): string | undefined {
  if (!flags.lesson) return undefined;
  for (const candidate of [
    path.resolve(ctx.cwd, flags.lesson),
    path.resolve(ctx.root, flags.lesson),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new UsageError(`no such lesson file: ${flags.lesson}`);
}

export function version(): string {
  try {
    const file = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string };
    return `inkcast ${pkg.version ?? '0.0.0'}`;
  } catch {
    return 'inkcast (unknown version)';
  }
}
