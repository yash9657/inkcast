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
 *   - **A stored key wins.** The key the user deliberately saved is the one the
 *     stages use, even when the environment already carries a value for the same
 *     provider. This is the reversal of the original rule, and it was reversed on
 *     a real failure: a stale exported `ANTHROPIC_API_KEY` kept an unfunded
 *     account in play while the freshly pasted, working key sat sealed in the
 *     vault, ignored — and every surface said "configured". Pasting a key is the
 *     more deliberate act than having a variable in a long-lived shell, so the
 *     paste is what wins. A run that must use the environment instead can simply
 *     not store a key, or delete the stored one.
 *   - **What we injected, we can retract — including what we overrode.** An
 *     injection leaves the environment's own prior value recoverable, so
 *     `dehydrate()` and a deleted key restore the environment exactly rather
 *     than leaving a hole or a leftover.
 *
 * ## Why the bookkeeping lives in `process.env` itself
 *
 * Two earlier designs failed the same way. A module-level map was emptied by
 * `next dev` re-evaluating modules while `process.env` kept the injected values,
 * so a fresh module instance mistook its own package's injections for "the real
 * environment" and refused to replace them with a newly saved key. Pinning the
 * map to `globalThis` did not survive either: Next's dev server evaluates route
 * bundles in separate realms with separate `globalThis` objects, so realm B's
 * hydration found realm A's injections already sitting in the (process-wide)
 * environment, with no way to know they were injections — and recorded the vault
 * key as a shell value to be faithfully preserved.
 *
 * `process.env` is the one object that is process-wide by construction — it is
 * the thing being mutated — so the record of what was done to it lives beside
 * the mutation, marker and shadow both:
 *
 *   - `INKCAST_INJECTED_<VAR>=1` marks `<VAR>` as populated by hydration. Any
 *     module copy, realm, or even child process can tell an injection from a
 *     genuine shell export.
 *   - `INKCAST_SHADOWED_<VAR>` holds the environment's own value when hydration
 *     displaced one, so retraction is a restore rather than a delete. It is the
 *     same secret at the same exposure — a second name in an environment that
 *     already carries the value.
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

/** Marks `variable` as populated by hydration rather than by the environment. */
function markerName(variable: string): string {
  return `INKCAST_INJECTED_${variable}`;
}

/** Holds the environment's own value for `variable` while an injection displaces it. */
function shadowName(variable: string): string {
  return `INKCAST_SHADOWED_${variable}`;
}

/** Whether `variable` in `env` was put there by hydration. */
function isInjected(env: NodeJS.ProcessEnv, variable: string): boolean {
  return env[markerName(variable)] === '1';
}

/**
 * Undo one injection on `env`: restore the displaced shell value if one was
 * recorded, otherwise remove the variable, and drop the bookkeeping either way.
 */
function retract(env: NodeJS.ProcessEnv, variable: string): void {
  const shadowed = env[shadowName(variable)];
  if (shadowed === undefined) delete env[variable];
  else env[variable] = shadowed;
  delete env[markerName(variable)];
  delete env[shadowName(variable)];
}

export type HydrateResult = {
  /** Providers populated from storage by this call — overriding env if it had one. */
  injected: Provider[];
  /** Providers with no stored key whose value comes from the real environment. */
  fromEnv: Provider[];
  /** Providers with nothing available anywhere — these stages run locally. */
  missing: Provider[];
};

/**
 * Copy stored keys into `env`, overriding any value the environment carries for
 * the same provider. Providers with nothing stored keep their environment value.
 *
 * Idempotent and safe to call repeatedly — a re-run after a key is saved or
 * deleted converges on storage's current contents, from any module copy or realm
 * (see the header). Defaults to `process.env`; pass a different object in tests.
 * A provider whose key cannot be read (no passphrase, a tampered entry) is
 * treated as having nothing stored and logged once — never thrown, so one
 * unreadable entry cannot stop the other three stages from upgrading.
 */
export async function hydrateEnv(
  opts: KeyvaultOptions & { target?: NodeJS.ProcessEnv } = {},
): Promise<HydrateResult> {
  const target = opts.target ?? process.env;

  // Storage is read through an instance that sees the environment as the shell
  // supplied it, so a value hydration set can never be mistaken for configuration.
  const kv = createKeyvault({ ...opts, env: realEnv(opts.env ?? target) });
  const result: HydrateResult = { injected: [], fromEnv: [], missing: [] };

  for (const provider of PROVIDERS) {
    const canonical = PROVIDER_SPECS[provider].envVars[0]!;

    let stored: string | undefined;
    try {
      stored = await kv.storedKey(provider);
    } catch (err) {
      log.warn(
        `could not read the stored ${provider} key — falling back to the environment`,
        err as Error,
      );
    }

    if (stored) {
      // A genuine shell value is moved into the shadow slot the first time it is
      // displaced, so a later retraction restores it exactly. On re-runs the
      // marker says the current value is ours, and the slot is left alone.
      const current = target[canonical];
      if (current !== undefined && current !== stored && !isInjected(target, canonical)) {
        target[shadowName(canonical)] = current;
        if (current.trim() !== '') {
          log.info(`the stored ${provider} key overrides ${canonical} from the environment`);
        }
      }
      target[canonical] = stored;
      target[markerName(canonical)] = '1';
      result.injected.push(provider);
      continue;
    }

    // Nothing stored: retract anything hydration previously injected, so a
    // deleted key stops applying immediately and the shell's own value resurfaces.
    if (isInjected(target, canonical)) retract(target, canonical);

    if (envKey(provider, target)) result.fromEnv.push(provider);
    else result.missing.push(provider);
  }

  if (result.injected.length > 0) {
    log.debug(`populated the environment from storage for: ${result.injected.join(', ')}`);
  }
  return result;
}

/**
 * Remove every variable `hydrateEnv()` set, restoring what the real environment
 * held there before.
 *
 * Call this after deleting a key, and on shutdown, so an injected credential does
 * not outlive its purpose.
 */
export function dehydrate(target: NodeJS.ProcessEnv = process.env): Provider[] {
  const removed: Provider[] = [];
  for (const provider of PROVIDERS) {
    const canonical = PROVIDER_SPECS[provider].envVars[0]!;
    if (!isInjected(target, canonical)) continue;
    retract(target, canonical);
    removed.push(provider);
  }
  return removed;
}

/** Providers whose env var is currently populated by hydration. */
export function hydratedProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  return PROVIDERS.filter((provider) => isInjected(env, PROVIDER_SPECS[provider].envVars[0]!));
}

/**
 * `target` as the real environment supplied it: a clone with every injection
 * reversed — the displaced values restored, the purely-injected ones removed,
 * and the bookkeeping variables dropped.
 *
 * Status paths need this. Without it, provenance is read back through the very
 * variables hydration wrote, so every stored key reports as coming from an
 * environment variable the user never set.
 */
export function realEnv(target: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const injected = hydratedProviders(target);
  if (injected.length === 0) return target;
  const env: NodeJS.ProcessEnv = { ...target };
  for (const provider of injected) retract(env, PROVIDER_SPECS[provider].envVars[0]!);
  return env;
}
