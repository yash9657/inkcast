/**
 * Startup wiring that has to happen *before* anything imports @inkcast/core.
 *
 * Two things depend on it:
 *  - `PROJECTS_ROOT` is read once when core loads, so `INKCAST_PROJECTS` has to
 *    be set first. Without this, `pnpm cast …` (which runs with the CLI package
 *    as its cwd) would scatter project directories inside `apps/cli/`.
 *  - `INKCAST_LOG`'s threshold is also captured at import time, and info-level
 *    logging would fight the progress bar for the terminal.
 *
 * No imports from the workspace here on purpose.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type CliContext = {
  /** Repo root — where `projects/` and `examples/` live. */
  root: string;
  /** Where the user actually ran the command. */
  cwd: string;
  /** Render a live progress bar rather than plain lines. */
  tty: boolean;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  /** Colours are safe to emit. */
  color: boolean;
};

const MARKERS = ['pnpm-workspace.yaml', 'tsconfig.base.json'];

/** Nearest ancestor of `from` (or of this file) that looks like the repo root. */
export function workspaceRoot(from: string = process.cwd()): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const start of [from, here]) {
    let dir = path.resolve(start);
    for (;;) {
      if (MARKERS.every((m) => existsSync(path.join(dir, m)))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return path.resolve(from);
}

/**
 * Minimal `.env` reader: `KEY=value`, `#` comments, optional quotes, and it
 * never overwrites a variable that is already set. A real dotenv dependency
 * would not earn its place for this.
 */
export function loadDotEnv(root: string): void {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2]!;
    else value = value.replace(/\s+#.*$/, '').trim();
    process.env[key] = value;
  }
}

/** Read the few flags that must be known before the real parse, then set env. */
export function bootstrap(argv: string[] = process.argv.slice(2)): CliContext {
  const has = (...names: string[]) => names.some((n) => argv.includes(n));
  const json = has('--json');
  const verbose = has('--verbose');
  const quiet = has('--quiet') || json;
  const root = workspaceRoot();

  loadDotEnv(root);

  if (!process.env.INKCAST_PROJECTS) {
    process.env.INKCAST_PROJECTS = path.join(root, 'projects');
  }
  if (!process.env.INKCAST_LOG) {
    // The bar and the summary carry the narrative; logs are for problems.
    process.env.INKCAST_LOG = verbose ? 'debug' : quiet ? 'error' : 'warn';
  }

  const color =
    !process.env.NO_COLOR &&
    process.env.TERM !== 'dumb' &&
    (process.stdout.isTTY ?? false) &&
    !json;

  return {
    root,
    cwd: process.cwd(),
    tty: (process.stdout.isTTY ?? false) && !json && !quiet && !verbose,
    json,
    verbose,
    quiet,
    color,
  };
}
