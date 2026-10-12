import { AsyncLocalStorage } from 'node:async_hooks';

// A job's credentials are never installed in process.env. Keep one context even
// across Next server chunks / development reloads. CLI callers retain env defaults.
const scope = globalThis as typeof globalThis & {
  __inkcastProviderContext?: AsyncLocalStorage<NodeJS.ProcessEnv>;
};
const context = (scope.__inkcastProviderContext ??= new AsyncLocalStorage<NodeJS.ProcessEnv>());

export function providerEnv(): NodeJS.ProcessEnv {
  return context.getStore() ?? process.env;
}

/** A complete snapshot, not a merge: absent keys must never fall through to env. */
export function withProviderEnv<T>(env: NodeJS.ProcessEnv, work: () => T): T {
  return context.run(Object.freeze({ ...env }), work);
}

/** Exact redaction at artifact boundaries while the provider scope is alive. */
export function redactProviderSecrets(message: string): string {
  let out = message;
  const env = providerEnv();
  for (const name of [
    'FIREWORKS_API_KEY',
    'ANTHROPIC_API_KEY',
    'ELEVENLABS_API_KEY',
    'FAL_KEY',
    'FAL_API_KEY',
    'REPLICATE_API_TOKEN',
  ]) {
    const key = env[name];
    if (!key || key.length < 8) continue;
    for (const value of [
      key,
      Buffer.from(key).toString('base64'),
      encodeURIComponent(key),
      JSON.stringify(key).slice(1, -1),
    ])
      out = out.split(value).join('[redacted]');
  }
  return out;
}
