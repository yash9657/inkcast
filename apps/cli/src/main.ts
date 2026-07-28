/**
 * Argument parsing and command dispatch, on `node:util`'s `parseArgs`.
 *
 * Exit codes are the contract with scripts and CI: 0 success, 1 handled
 * failure, 2 bad usage. Every path through this file returns one of those three.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { StoryboardMeta } from '@inkcast/core';
import type { CliContext } from './env.js';
import { paint } from './ui.js';
import { usage } from './usage.js';

const ASPECTS = ['16:9', '9:16', '1:1'] as const;
const STYLES = ['marker', 'pencil', 'chalk', 'ink'] as const;
const PALETTES = ['mono', 'color'] as const;

const COMMANDS = [
  'cast',
  'list',
  'open',
  'edit',
  'rerender',
  'preview',
  'providers',
  'help',
] as const;
type Command = (typeof COMMANDS)[number];

export type Flags = {
  title?: string;
  aspect?: (typeof ASPECTS)[number];
  lang?: string;
  voice?: string;
  style?: (typeof STYLES)[number];
  palette?: (typeof PALETTES)[number];
  out?: string;
  project?: string;
  port?: number;
  force: boolean;
  open: boolean;
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
        lang: { type: 'string' },
        voice: { type: 'string' },
        style: { type: 'string' },
        palette: { type: 'string' },
        out: { type: 'string', short: 'o' },
        project: { type: 'string' },
        port: { type: 'string' },
        force: { type: 'boolean', short: 'f', default: false },
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

  try {
    const flags = readFlags(values);
    switch (command ?? 'cast') {
      case 'help':
        process.stdout.write(usage(ctx.color));
        return 0;
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
        if (rest.length === 0 && !values.help) {
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

function readFlags(values: Record<string, unknown>): Flags {
  const flags: Flags = {
    force: values.force === true,
    open: values.open === true,
  };
  if (typeof values.title === 'string') flags.title = values.title;
  if (typeof values.out === 'string') flags.out = values.out;
  if (typeof values.project === 'string') flags.project = values.project;
  if (typeof values.lang === 'string') flags.lang = values.lang.trim();
  if (typeof values.voice === 'string') flags.voice = values.voice.trim();
  if (typeof values.aspect === 'string') flags.aspect = oneOf('aspect', values.aspect, ASPECTS);
  if (typeof values.style === 'string') flags.style = oneOf('style', values.style, STYLES);
  if (typeof values.palette === 'string') {
    flags.palette = oneOf('palette', values.palette, PALETTES);
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

export function version(): string {
  try {
    const file = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string };
    return `inkcast ${pkg.version ?? '0.0.0'}`;
  } catch {
    return 'inkcast (unknown version)';
  }
}
