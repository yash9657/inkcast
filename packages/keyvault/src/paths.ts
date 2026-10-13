/**
 * Where the vault lives, and the two measures that keep it out of a repo.
 *
 * The threat this file addresses is mundane and by far the most likely: the
 * vault ends up inside a checkout and gets committed, or swept into a backup of
 * the project directory. Two independent guards, because either one alone has a
 * hole:
 *
 *   1. Every vault directory we create gets its own `.gitignore` containing `*`.
 *      This works even when the vault sits at the default `~/.inkcast/` and the
 *      home directory itself turns out to be a dotfiles repo.
 *   2. A vault path inside a git working tree is refused outright — unless that
 *      tree is the home directory (the dotfiles case, already covered by 1) or
 *      the user opts in with `INKCAST_VAULT_ALLOW_IN_REPO=1`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { stateDir as inkcastStateDir } from '@inkcast/core';
import { KeyvaultError } from './errors.js';

/**
 * The Inkcast state directory. Never inside the project.
 *
 * Re-exported from `@inkcast/core` rather than computed again: the shared asset
 * cache lives under the same root, and a second reading of `INKCAST_HOME` here is
 * how the vault and the cache would end up in different places.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return inkcastStateDir(env);
}

/** Absolute path of the encrypted vault. */
export function vaultPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.INKCAST_VAULT_PATH
    ? path.resolve(env.INKCAST_VAULT_PATH)
    : path.join(stateDir(env), 'vault.json');
}

/** Absolute path of the non-secret metadata sidecar. */
export function metaPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.INKCAST_KEYVAULT_META
    ? path.resolve(env.INKCAST_KEYVAULT_META)
    : path.join(stateDir(env), 'keyvault-meta.json');
}

/** Nearest ancestor of `from` (inclusive) that contains a `.git` entry. */
export function gitRoot(from: string): string | undefined {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Refuse to put a vault somewhere git would see it.
 *
 * The home-directory exemption is deliberate: dotfiles repos are common, the
 * default vault path lives in `~/.inkcast/`, and hard-failing there would break
 * ordinary use for a case the directory-level `.gitignore` already handles.
 */
export function assertNotInRepo(file: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.INKCAST_VAULT_ALLOW_IN_REPO === '1') return;
  const root = gitRoot(path.dirname(file));
  if (!root) return;
  if (path.resolve(root) === path.resolve(homedir())) return;
  throw new KeyvaultError(
    'vault-in-repo',
    `refusing to write a vault inside the git repository at ${root}`,
    {
      hint:
        'A committed vault is a leaked vault. Leave INKCAST_VAULT_PATH unset to use ~/.inkcast/vault.json, ' +
        'or set INKCAST_VAULT_ALLOW_IN_REPO=1 if you have genuinely excluded this path from git.',
    },
  );
}

/** `.gitignore` lines that cover every artefact this package can create. */
export const GITIGNORE_RULES = [
  '# @inkcast/keyvault — a committed vault is a leaked vault.',
  'vault.json',
  '*.vault.json',
  'keyvault-meta.json',
  '.inkcast/',
].join('\n');

/**
 * Create `dir` with owner-only permissions and drop a `.gitignore` that excludes
 * everything under it.
 *
 * `mkdir` mode is masked by the process umask, so the mode is set explicitly
 * afterwards by the caller for files; for the directory 0o700 survives any
 * reasonable umask because umask only ever removes bits.
 */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ignore = path.join(dir, '.gitignore');
  const body = '# Everything in here is credential state. Never commit any of it.\n*\n';
  try {
    if (!existsSync(ignore)) {
      writeFileSync(ignore, body, { mode: 0o600 });
      return;
    }
    // Someone else's .gitignore — only append if it does not already blanket-ignore.
    const current = readFileSync(ignore, 'utf8');
    if (!/^\*\s*$/m.test(current)) writeFileSync(ignore, `${current.replace(/\n?$/, '\n')}*\n`);
  } catch {
    // A missing .gitignore is a defence-in-depth loss, not a failure: the vault
    // itself is still encrypted and 0600. Never block storing a key over it.
  }
}
