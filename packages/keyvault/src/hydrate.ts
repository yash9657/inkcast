/**
 * Making a stored key actually take effect, by populating `process.env`.
 *
 * Every stage decides its provider by reading `process.env` — that is what
 * `packages/pipeline/src/providers.ts` does, and it is the one mechanism the CLI,
 * the studio and a CI run all share. A vault that invented a second mechanism
 * would mean every adapter needed teaching about it. So this does not add one; it
 * *populates the existing one*.
 *
 * Two rules keep that honest, and they mirror `getKey()`'s precedence exactly:
 *
 *   - **The real environment always wins.** A key already in the shell or `.env`
 *     is authoritative and is never overwritten, because a value you can see
 *     being silently shadowed by one you cannot is the worst possible outcome.
 *   - **What we injected, we can retract.** `dehydrate()` removes only the
 *     variables this process set, so deleting a key stops it applying immediately
 *     rather than at the next restart. Variables that came from the environment
 *     are never touched.
 *
 * ## Why this is opt-in, and the cost of using it
 *
 * A key in `process.env` is inherited by every child process and shows up in
 * anything that dumps the environment — `docker inspect`, a crash report, some
 * error reporters. That is strictly weaker than holding it for the duration of one
 * call, which is why `getKey()` is the default and this is a deliberate,
 * separately-named step for the one caller that needs it: a long-lived server
 * process driving stages that read env directly.
 *
 * Prefer `getKey()` and pass the value explicitly wherever a stage lets you.
 */
import { logger } from '@inkcast/core';
import { PROVIDERS, PROVIDER_SPECS, envKey, type Provider } from './providers.js';
import { createKeyvault, type KeyvaultOptions } from './store.js';

const log = logger('keyvault:hydrate');

/** Providers whose env var this process populated, and with which variable. */
const injected = new Map<Provider, string>();

export type HydrateResult = {
  /** Providers newly populated from storage by this call. */
  injected: Provider[];
  /** Providers left alone because the real environment already supplied them. */
  fromEnv: Provider[];
  /** Providers with nothing available anywhere — these stages run locally. */
  missing: Provider[];
};

/**
 * Copy stored keys into `env` for any provider the environment did not supply.
 *
 * Idempotent and safe to call repeatedly. Defaults to `process.env`; pass a
 * different object in tests. A provider whose key cannot be read (no passphrase,
 * a tampered entry) is reported as missing and logged once — never thrown, so one
 * unreadable entry cannot stop the other three stages from upgrading.
 */
export async function hydrateEnv(
  opts: KeyvaultOptions & { target?: NodeJS.ProcessEnv } = {},
): Promise<HydrateResult> {
  const target = opts.target ?? process.env;

  // Resolve against an environment with *our own* injections removed. Without
  // this, `getKey()`'s env-first precedence would find the variable we set on the
  // previous pass and report it as configured — so a deleted key would keep
  // re-injecting itself forever and could never be retracted. Keys the real
  // environment supplies are still visible, and are short-circuited below.
  const base = opts.env ?? target;
  const scrubbed: NodeJS.ProcessEnv = { ...base };
  for (const name of injected.values()) delete scrubbed[name];

  const kv = createKeyvault({ ...opts, env: scrubbed });
  const result: HydrateResult = { injected: [], fromEnv: [], missing: [] };

  for (const provider of PROVIDERS) {
    const canonical = PROVIDER_SPECS[provider].envVars[0]!;

    // Already in the environment, and not by us: authoritative, hands off.
    const present = envKey(provider, target);
    if (present && injected.get(provider) !== present.name) {
      result.fromEnv.push(provider);
      continue;
    }

    let key: string | undefined;
    try {
      key = await kv.getKey(provider);
    } catch (err) {
      log.warn(
        `could not read the stored ${provider} key — that stage will run locally`,
        err as Error,
      );
    }

    if (key) {
      target[canonical] = key;
      injected.set(provider, canonical);
      result.injected.push(provider);
    } else {
      // Retract a value we previously injected that is no longer stored.
      const stale = injected.get(provider);
      if (stale) {
        delete target[stale];
        injected.delete(provider);
      }
      result.missing.push(provider);
    }
  }

  if (result.injected.length > 0) {
    log.debug(`populated the environment from storage for: ${result.injected.join(', ')}`);
  }
  return result;
}

/**
 * Remove every variable `hydrateEnv()` set, leaving the real environment intact.
 *
 * Call this after deleting a key, and on shutdown, so an injected credential does
 * not outlive its purpose.
 */
export function dehydrate(target: NodeJS.ProcessEnv = process.env): Provider[] {
  const removed: Provider[] = [];
  for (const [provider, name] of injected) {
    delete target[name];
    removed.push(provider);
  }
  injected.clear();
  return removed;
}

/** Providers whose env var is currently populated by this process. */
export function hydratedProviders(): Provider[] {
  return [...injected.keys()];
}
