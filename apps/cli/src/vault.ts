/**
 * The CLI's door onto `@inkcast/keyvault`.
 *
 * One credential store for the terminal and the studio: keys live in the macOS
 * keychain (or an encrypted vault file elsewhere), and both surfaces read them
 * through the same package. The CLI does two things with it.
 *
 * **Hydrate before running stages.** Every stage adapter decides its provider by
 * reading `process.env`, so a stored key only takes effect once it is copied
 * there. That is `hydrateEnv()`, and it is deliberately *not* called for the
 * `keys` command itself: those subcommands have to report where a key actually
 * lives and which one wins, which is impossible if we have already shadowed the
 * environment with our own injections.
 *
 * **Load lazily, and survive absence.** The import is dynamic so `inkcast --help`
 * and a bare `cast` on a machine mid-`pnpm install` do not fail on a missing
 * package, and so nothing pays for the keychain probe unless keys are in play.
 */

import { paint } from './ui.js';

export type Keyvault = typeof import('@inkcast/keyvault');

let cached: Promise<Keyvault | undefined> | undefined;

async function tryLoad(): Promise<Keyvault | undefined> {
  try {
    return await import('@inkcast/keyvault');
  } catch {
    return undefined;
  }
}

/** The keyvault, or `undefined` when the package is not installed. */
export function loadVault(): Promise<Keyvault | undefined> {
  return (cached ??= tryLoad());
}

/** The keyvault, or a clear failure — for commands that are *about* keys. */
export async function requireVault(): Promise<Keyvault> {
  const kv = await loadVault();
  if (!kv) {
    throw new Error(
      'key storage is unavailable: @inkcast/keyvault could not be loaded. ' +
        'Run `pnpm install` at the repo root, then retry.',
    );
  }
  return kv;
}

/**
 * Copy stored keys into the environment so the stages can see them, and install
 * redaction so a key can never reach a log line or a stack trace.
 *
 * Never throws: a locked vault or an unreadable entry must degrade to "that stage
 * runs locally", exactly as having no key at all does.
 */
export async function hydrateKeys(): Promise<string[]> {
  const kv = await loadVault();
  if (!kv) return [];
  try {
    kv.installRedaction();
    const result = await kv.hydrateEnv();
    return result.injected;
  } catch {
    return [];
  }
}

/**
 * The one command that fixes a missing key, coloured for the terminal.
 *
 * Centralised because the wording has to match `degradations()` in the pipeline —
 * a user told two different commands trusts neither.
 */
export function fixHint(color: boolean, command: string): string {
  const c = paint(color);
  return `${c.dim('fix:')} ${c.cyan(command)}`;
}
