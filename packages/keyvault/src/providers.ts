/**
 * The four providers Inkcast can upgrade to, and the environment variables that
 * already name them elsewhere in the repo.
 *
 * The env var names are not ours to invent: `@inkcast/pipeline`'s provider table
 * and every stage adapter read `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`,
 * `REPLICATE_API_TOKEN` and `FAL_KEY` directly. Keeping the same names is what
 * lets the vault be adopted incrementally — a user who exports the variable
 * keeps working, and a user who stores the key gets it injected under the same
 * name.
 */

export const PROVIDERS = ['anthropic', 'elevenlabs', 'replicate', 'fal'] as const;

export type Provider = (typeof PROVIDERS)[number];

export type ProviderSpec = {
  id: Provider;
  /** Human label for CLI and studio surfaces. */
  label: string;
  /**
   * Environment variables that hold this key, in precedence order. The first is
   * canonical — it is the one an integration writes into a child process env.
   */
  envVars: readonly string[];
  /** Which stage the key upgrades, for `inkcast providers`-style output. */
  stage: 'planning' | 'voice' | 'artwork';
  /** Where a user goes to mint or rotate one. */
  console: string;
};

export const PROVIDER_SPECS: Record<Provider, ProviderSpec> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    envVars: ['ANTHROPIC_API_KEY'],
    stage: 'planning',
    console: 'https://platform.claude.com/settings/keys',
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    envVars: ['ELEVENLABS_API_KEY'],
    stage: 'voice',
    console: 'https://elevenlabs.io/app/settings/api-keys',
  },
  replicate: {
    id: 'replicate',
    label: 'Replicate',
    envVars: ['REPLICATE_API_TOKEN'],
    stage: 'artwork',
    console: 'https://replicate.com/account/api-tokens',
  },
  fal: {
    id: 'fal',
    label: 'fal.ai',
    // FAL_KEY is what the pipeline reads; FAL_API_KEY is fal's older name and
    // still turns up in people's shells, so accept it on read.
    envVars: ['FAL_KEY', 'FAL_API_KEY'],
    stage: 'artwork',
    console: 'https://fal.ai/dashboard/keys',
  },
};

/** True when `value` names a provider we support. */
export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Narrow an untrusted string to a `Provider`, or throw a message that lists the
 * valid options rather than making the caller guess.
 */
export function assertProvider(value: unknown): Provider {
  if (isProvider(value)) return value;
  throw new Error(
    `unknown provider ${JSON.stringify(String(value))} — expected one of ${PROVIDERS.join(', ')}`,
  );
}

/**
 * The value of the first environment variable set for this provider.
 *
 * Whitespace-only counts as unset. That matters: an exported-but-empty variable
 * is the classic way to accidentally shadow a stored key, and treating it as
 * "not configured" is both what the rest of the repo does (`Boolean(env.X)`) and
 * the behaviour least likely to surprise.
 */
export function envKey(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
): { name: string; value: string } | undefined {
  for (const name of PROVIDER_SPECS[provider].envVars) {
    const raw = env[name];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length > 0) return { name, value };
  }
  return undefined;
}
