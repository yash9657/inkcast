/**
 * Env hydration: the mechanism by which a stored key reaches stages that read
 * `process.env` directly. Every test uses an explicit target object, so nothing
 * here mutates the real environment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKeyvault,
  dehydrate,
  hydrateEnv,
  hydratedProviders,
  lock,
  realEnv,
} from '../src/index.js';
import { FAKE, sandbox } from './helpers.js';

test('hydrateEnv populates the canonical variable from storage', async () => {
  const box = sandbox();
  const target: NodeJS.ProcessEnv = {};
  try {
    const kv = createKeyvault(box.opts());
    await kv.setKey('anthropic', FAKE.anthropic);
    await kv.setKey('fal', FAKE.fal);

    const result = await hydrateEnv({ ...box.opts({ env: target }), target });

    assert.equal(target.ANTHROPIC_API_KEY, FAKE.anthropic);
    assert.equal(target.FAL_KEY, FAKE.fal);
    assert.deepEqual(result.injected.sort(), ['anthropic', 'fal']);
    assert.deepEqual(result.missing.sort(), ['elevenlabs', 'fireworks', 'replicate']);
    assert.deepEqual(result.fromEnv, []);
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('hydrateEnv overrides a key the environment supplied, and restores it', async () => {
  const box = sandbox();
  const fromShell = 'sk-ant-api03-FromTheShell00001111222233334444555566667777';
  const target: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: fromShell };
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    const result = await hydrateEnv({ ...box.opts({ env: target }), target });

    // The pasted key is the deliberate one, so it displaces the shell's — a
    // stale export must not keep running renders on the wrong account.
    assert.equal(target.ANTHROPIC_API_KEY, FAKE.anthropic, 'the stored key must win');
    assert.deepEqual(result.injected, ['anthropic']);
    assert.ok(!result.fromEnv.includes('anthropic'));

    // What was overridden can be put back exactly: retraction is a restore, not
    // a delete, or dehydrating would erase a variable the user set themselves.
    dehydrate(target);
    assert.equal(target.ANTHROPIC_API_KEY, fromShell, "the shell's own value comes back");
    assert.deepEqual(
      Object.keys(target).filter((k) => k.startsWith('INKCAST_')),
      [],
      'retraction leaves no bookkeeping behind',
    );
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('deleting a key restores the environment value it was overriding', async () => {
  const box = sandbox();
  const fromShell = 'sk-ant-api03-FromTheShell99998888777766665555444433332222';
  const target: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: fromShell };
  try {
    const kv = createKeyvault(box.opts());
    await kv.setKey('anthropic', FAKE.anthropic);
    await hydrateEnv({ ...box.opts({ env: target }), target });
    assert.equal(target.ANTHROPIC_API_KEY, FAKE.anthropic);

    await kv.deleteKey('anthropic');
    const after = await hydrateEnv({ ...box.opts({ env: target }), target });

    assert.equal(target.ANTHROPIC_API_KEY, fromShell, 'the shell value resurfaces');
    assert.ok(after.fromEnv.includes('anthropic'), 'and is reported as the source');
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('a second hydration recognises the first one from the environment alone', async () => {
  const box = sandbox();
  const target: NodeJS.ProcessEnv = {};
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    await hydrateEnv({ ...box.opts({ env: target }), target });

    // The bookkeeping must live in the environment itself: `next dev` evaluates
    // route bundles in separate realms with separate `globalThis`, so a second
    // module copy has nothing else to consult. Before this was true, that copy
    // recorded the first copy's injection as a shell value to preserve — and the
    // vault key masqueraded as an environment variable forever after.
    assert.equal(target.INKCAST_INJECTED_ANTHROPIC_API_KEY, '1', 'the marker is in the env');
    await hydrateEnv({ ...box.opts({ env: target }), target });
    assert.equal(
      'INKCAST_SHADOWED_ANTHROPIC_API_KEY' in target,
      false,
      'a re-run must not mistake the injection for a shell value and shadow it',
    );
    assert.equal(
      'ANTHROPIC_API_KEY' in realEnv(target),
      false,
      'the real environment never supplied this key',
    );
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('hydrateEnv is idempotent', async () => {
  const box = sandbox();
  const target: NodeJS.ProcessEnv = {};
  try {
    await createKeyvault(box.opts()).setKey('replicate', FAKE.replicate);
    await hydrateEnv({ ...box.opts({ env: target }), target });
    const second = await hydrateEnv({ ...box.opts({ env: target }), target });
    // Still ours, so still reported as injected rather than as environment-provided.
    assert.deepEqual(second.injected, ['replicate']);
    assert.equal(target.REPLICATE_API_TOKEN, FAKE.replicate);
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('a deleted key is retracted from the environment on the next pass', async () => {
  const box = sandbox();
  const target: NodeJS.ProcessEnv = {};
  try {
    const kv = createKeyvault(box.opts());
    await kv.setKey('elevenlabs', FAKE.elevenlabs);
    await hydrateEnv({ ...box.opts({ env: target }), target });
    assert.equal(target.ELEVENLABS_API_KEY, FAKE.elevenlabs);

    await kv.deleteKey('elevenlabs');
    const after = await hydrateEnv({ ...box.opts({ env: target }), target });

    assert.equal(
      'ELEVENLABS_API_KEY' in target,
      false,
      'a revoked key must stop applying immediately, not at the next restart',
    );
    assert.ok(after.missing.includes('elevenlabs'));
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('dehydrate removes only what we injected', async () => {
  const box = sandbox();
  const fromShell = 'r8_FromTheShell00112233445566778899';
  const target: NodeJS.ProcessEnv = { REPLICATE_API_TOKEN: fromShell };
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    await hydrateEnv({ ...box.opts({ env: target }), target });
    assert.ok(hydratedProviders(target).includes('anthropic'));

    dehydrate(target);
    assert.equal('ANTHROPIC_API_KEY' in target, false, 'our injection should be gone');
    assert.equal(target.REPLICATE_API_TOKEN, fromShell, "the shell's own variable must survive");
    assert.deepEqual(hydratedProviders(target), []);
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('an unreadable vault degrades to "runs locally" instead of throwing', async () => {
  const box = sandbox();
  const target: NodeJS.ProcessEnv = {};
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    lock();
    // No passphrase available at all: hydration must report the provider missing
    // so the stage falls back to its local default.
    const result = await hydrateEnv({
      backend: 'vault',
      vaultPath: box.vaultPath,
      metaPath: box.metaPath,
      env: target,
      target,
      track: false,
    });
    assert.ok(result.missing.includes('anthropic'));
    assert.equal('ANTHROPIC_API_KEY' in target, false);
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});
