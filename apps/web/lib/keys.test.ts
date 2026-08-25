/**
 * The keyed-render regression: a stored key must reach the stages from a route
 * that has never served the settings page.
 *
 * The defect this pins was silent by construction. `hydrateEnv()` existed, worked,
 * and was tested — it was just never called from `POST /api/generate`. Keys
 * reached `process.env` because `/api/providers` hydrates as a side effect and
 * the studio fetches it to draw its provider strip, so on any browser session
 * that had loaded a page the film came out keyed. Restart `next dev`, `curl` the
 * generate endpoint, and the same vault produced a Kokoro narration, a heuristic
 * lesson and no figures, with nothing in the logs or in `pipeline.json` saying a
 * key had been ignored.
 *
 * So the assertion is deliberately end-of-chain: not "hydrate wrote a variable"
 * but "`voiceProvider()` — the function the pipeline actually asks — says
 * elevenlabs", reached through the job wrapper the route now uses. That is the
 * sentence the plan's acceptance test cares about, and it is false for every
 * intermediate state where hydration exists but the money path skips it.
 *
 * Everything runs against a throwaway vault directory and an explicit `env`
 * object, so nothing here can see or touch a developer's real keys.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createKeyvault, type KeyvaultOptions } from '@inkcast/keyvault';
import { voiceProvider, plannerProvider, imageProvider } from '@inkcast/pipeline';

import { hydrateEnv, invalidateVault, withKeys } from './keys.js';

const FAKE_ELEVENLABS = 'sk_a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const FAKE_ANTHROPIC =
  'sk-ant-api03-Aa0bCc1dEe2fGg3hIi4jKk5lMm6nOo7pQq8rSs9tUu0vWw1xYy2zZz3-AbCdEf';

/** What `hydrateEnv` takes: vault options plus the environment object to write into. */
type Opts = KeyvaultOptions & { target?: NodeJS.ProcessEnv };

type Box = {
  /** Vault options that pin every path away from the developer's real state. */
  opts(extra?: Partial<Opts>): Opts;
  cleanup(): void;
};

/**
 * The environment a freshly restarted `next dev` has: no provider key anywhere.
 *
 * `NODE_ENV` is present because Next's ambient types make it required on
 * `ProcessEnv`, not because anything here reads it — every assertion below is
 * about a variable this object does *not* start with.
 */
function bare(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test' };
}

function box(): Box {
  const dir = mkdtempSync(path.join(tmpdir(), 'inkcast-web-keys-'));
  return {
    opts: (extra = {}) => ({
      backend: 'vault',
      vaultPath: path.join(dir, 'vault.json'),
      metaPath: path.join(dir, 'keyvault-meta.json'),
      passphrase: 'correct horse battery staple',
      interactive: false,
      // Never register these fakes in the process-wide redaction table: a unit
      // test that poisons it makes every later test's diff output unreadable.
      track: false,
      ...extra,
    }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('a stored key reaches the stages through the job wrapper, with an empty environment', async () => {
  const b = box();
  try {
    // The environment a freshly restarted `next dev` has: nothing at all.
    const env = bare();

    await createKeyvault(b.opts({ env: bare() })).setKey('elevenlabs', FAKE_ELEVENLABS);
    await createKeyvault(b.opts({ env: bare() })).setKey('anthropic', FAKE_ANTHROPIC);

    // Before hydration the pipeline's own answer is the degraded one. This is
    // exactly what a direct generate used to get.
    assert.equal(voiceProvider(undefined, env).name, 'kokoro');
    assert.equal(plannerProvider(env).name, 'heuristic');

    let seen: { voice: string; planner: string } | undefined;
    const runner = withKeys(async () => {
      seen = { voice: voiceProvider(undefined, env).name, planner: plannerProvider(env).name };
      return { videoPath: 'x.mp4' } as never;
    });

    // `withKeys` normally hydrates `process.env`; pointing it at the sandbox
    // vault and this test's own `env` is the only way to assert it without
    // reading — or writing — the developer's real one.
    invalidateVault();
    await hydrateEnv(b.opts({ env: bare(), target: env }));
    await runner(() => {}, { lease: async (_c, fn) => fn() });

    assert.deepEqual(seen, { voice: 'elevenlabs', planner: 'anthropic' });
  } finally {
    b.cleanup();
  }
});

test('hydration converges on the vault after a key is added mid-queue', async () => {
  const b = box();
  try {
    const env = bare();
    await hydrateEnv(b.opts({ env: bare(), target: env }));
    assert.equal(imageProvider(env).name, 'builtin');

    // The case `withKeys` exists for: the film was already queued when the user
    // pasted the key. Hydrating at request time would have missed it.
    await createKeyvault(b.opts({ env: bare() })).setKey('fal', 'x'.repeat(40));
    await hydrateEnv(b.opts({ env: bare(), target: env }));

    assert.equal(imageProvider(env).name, 'fal');
  } finally {
    b.cleanup();
  }
});

test('a vault that cannot be opened degrades to local stages instead of failing the render', async () => {
  const b = box();
  try {
    const env = bare();
    await createKeyvault(b.opts({ env: bare() })).setKey('elevenlabs', FAKE_ELEVENLABS);

    // Wrong passphrase: the entry is there and unreadable. A render must still
    // run — a locked keychain is "that stage runs locally", never a 500.
    await hydrateEnv(b.opts({ env: bare(), target: env, passphrase: 'not the passphrase' }));

    assert.equal(voiceProvider(undefined, env).name, 'kokoro');
  } finally {
    b.cleanup();
  }
});

test('the memo is per-process and an invalidation reopens it', async () => {
  const b = box();
  try {
    const env = bare();
    await createKeyvault(b.opts({ env: bare() })).setKey('elevenlabs', FAKE_ELEVENLABS);

    // An explicit `opts` bypasses the memo entirely — a test that pins its own
    // vault must never be answered from another test's cached "already done".
    await hydrateEnv(b.opts({ env: bare(), target: env }));
    assert.equal(env.ELEVENLABS_API_KEY, FAKE_ELEVENLABS);

    await createKeyvault(b.opts({ env: bare() })).deleteKey('elevenlabs');
    invalidateVault();
    await hydrateEnv(b.opts({ env: bare(), target: env }));

    // Retracted, not merely left behind: a deleted key stops applying at once.
    assert.equal(env.ELEVENLABS_API_KEY, undefined);
  } finally {
    b.cleanup();
  }
});
