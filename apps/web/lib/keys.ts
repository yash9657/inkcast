import path from 'node:path';
import {
  PROVIDER_SPECS,
  createKeyvault,
  installRedaction,
  redact,
  redactDeep,
  withSecretRedaction,
} from '@inkcast/keyvault';
import { accountKeys } from '../app/api/_lib/deployment';
import { readOwnerKey } from '../app/api/_lib/secrets';
import { ownerTagFor, type Session } from '../app/api/_lib/session';
import { loadCore, PROJECTS_DIR } from './store';
import type { JobRunner } from './jobs';
import { defaultSelection, type ProviderSelection } from './provider-selection';

installRedaction();

// Operational model/delivery settings only. No operator credentials, provider
// endpoints or unrelated deployment secrets are inherited by account jobs.
const CONFIG = [
  'INKCAST_FIREWORKS_MODEL',
  'INKCAST_FIREWORKS_REASONING',
  'INKCAST_DRAW_FIX',
  'INKCAST_FIGURE_MODEL',
  'ELEVENLABS_MODEL_ID',
  'INKCAST_VOICE_WPM',
  'INKCAST_VOICE_SPEED',
  'INKCAST_VOICE_PAD',
] as const;

export async function defaultProviders(session: Session): Promise<ProviderSelection> {
  const keys = accountKeys()
    ? await (
        await import('../app/api/keys/_account')
      ).accountKeyStatuses({
        tag: ownerTagFor(session),
        session,
        signedIn: session.kind === 'user',
      })
    : await (await import('../app/api/keys/_store')).keyStatuses();
  return defaultSelection(keys);
}

/** Resolve at job admission, never while a job sits in the queue. */
export async function credentialEnvironment(
  session: Session,
  selection: ProviderSelection,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const isolated = accountKeys(env);
  const snapshot: NodeJS.ProcessEnv = isolated ? { NODE_ENV: env.NODE_ENV } : { ...env };
  for (const spec of Object.values(PROVIDER_SPECS)) {
    for (const name of spec.envVars) delete snapshot[name];
  }
  if (isolated)
    for (const name of CONFIG) {
      if (env[name] !== undefined) snapshot[name] = env[name];
    }
  if (isolated) {
    snapshot.INKCAST_PUBLIC_SOURCES = '1';
    snapshot.INKCAST_CACHE_DIR = path.join(
      PROJECTS_DIR,
      '.account-cache',
      ownerTagFor(session, env),
    );
  }
  snapshot.INKCAST_PLANNER = selection.planner;
  snapshot.INKCAST_IMAGES = selection.images === 'local' ? 'off' : 'auto';
  snapshot.INKCAST_VOICE = selection.speech === 'elevenlabs' ? 'elevenlabs' : 'kokoro';
  if (selection.planner === 'fireworks') {
    for (const name of [
      'INKCAST_LESSON_MODEL',
      'INKCAST_PLANNER_MODEL',
      'INKCAST_DRAW_MODEL',
      'INKCAST_ROUTER_MODEL',
    ])
      delete snapshot[name];
  }
  const wanted = [
    ...(selection.planner === 'local' ? [] : [selection.planner]),
    ...(selection.speech === 'local' ? [] : (['elevenlabs'] as const)),
    ...(selection.images === 'local' ? [] : (['replicate', 'fal'] as const)),
  ];
  const vault = isolated ? undefined : createKeyvault({ interactive: false, track: false, env });
  for (const provider of wanted) {
    let key: string | undefined;
    try {
      key = isolated
        ? await readOwnerKey({ owner: ownerTagFor(session, env), provider }, env)
        : await vault!.getKey(provider);
    } catch {
      throw new Error(
        `Your ${provider} key cannot be read. Replace it in Settings before creating this video.`,
      );
    }
    if (!key && provider !== 'replicate' && provider !== 'fal') {
      throw new Error(`Add your ${provider} key in Settings, or select the local option.`);
    }
    if (key) snapshot[PROVIDER_SPECS[provider].envVars[0]!] = key;
  }
  return snapshot;
}

/** Redact before crossing back out of the scope, including errors and SSE notes. */
export async function runWithKeys<T>(
  session: Session,
  selection: ProviderSelection,
  work: () => Promise<T>,
): Promise<T> {
  const env = await credentialEnvironment(session, selection);
  const secrets = Object.values(PROVIDER_SPECS).flatMap((spec) =>
    spec.envVars.map((name) => env[name]).filter((key): key is string => Boolean(key)),
  );
  const core = await loadCore();
  return withSecretRedaction(secrets, () =>
    core.withProviderEnv(env, async () => {
      try {
        return await work();
      } catch (err) {
        const error = new Error(redact(err instanceof Error ? err.message : String(err)));
        if (err instanceof Error) error.name = err.name;
        const stage = (err as { stage?: unknown } | null)?.stage;
        if (typeof stage === 'string') Object.assign(error, { stage: redact(stage) });
        throw error;
      }
    }),
  );
}

export function withKeys(
  session: Session,
  selection: ProviderSelection,
  run: JobRunner,
): JobRunner {
  return (onProgress, ctx) =>
    runWithKeys(session, selection, () => run((progress) => onProgress(redactDeep(progress)), ctx));
}
