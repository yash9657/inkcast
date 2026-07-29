/**
 * Env hydration: the mechanism by which a stored key reaches stages that read
 * `process.env` directly. Every test uses an explicit target object, so nothing
 * here mutates the real environment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeyvault, dehydrate, hydrateEnv, hydratedProviders, lock } from '../src/index.js';
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
    assert.deepEqual(result.missing.sort(), ['elevenlabs', 'replicate']);
    assert.deepEqual(result.fromEnv, []);
  } finally {
    dehydrate(target);
    lock();
    box.cleanup();
  }
});

test('hydrateEnv never overwrites a key the real environment supplied', async () => {
  const box = sandbox();
  const fromShell = 'sk-ant-api03-FromTheShell00001111222233334444555566667777';
  const target: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: fromShell };
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    const result = await hydrateEnv({ ...box.opts({ env: target }), target });

    assert.equal(target.ANTHROPIC_API_KEY, fromShell, 'the visible value must win');
    assert.deepEqual(result.fromEnv, ['anthropic']);
    assert.ok(!result.injected.includes('anthropic'));
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
    assert.ok(hydratedProviders().includes('anthropic'));

    dehydrate(target);
    assert.equal('ANTHROPIC_API_KEY' in target, false, 'our injection should be gone');
    assert.equal(target.REPLICATE_API_TOKEN, fromShell, "the shell's own variable must survive");
    assert.deepEqual(hydratedProviders(), []);
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
