/**
 * The macOS keychain backend, exercised against the real `security` CLI.
 *
 * Opt-in, because it writes to the developer's login keychain: run with
 * `INKCAST_TEST_KEYCHAIN=1`. A unique service name per run keeps it isolated
 * from real Inkcast items, and the items are deleted in `finally`.
 *
 * These are the assertions that matter for the two traps documented in
 * `keychain.ts` — the argv exposure and the confirmation-prompt EOF that stores
 * an empty password with exit code 0.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createKeyvault, keychainAvailable, lock } from '../src/index.js';
import * as keychain from '../src/keychain.js';
import { FAKE } from './helpers.js';

const enabled = process.env.INKCAST_TEST_KEYCHAIN === '1' && keychainAvailable();
const why = keychainAvailable()
  ? 'set INKCAST_TEST_KEYCHAIN=1 to exercise the real login keychain'
  : 'no macOS keychain on this platform';

test('the keychain backend round-trips a key', { skip: enabled ? false : why }, async () => {
  const service = `inkcast-test-${randomBytes(6).toString('hex')}`;
  const kv = createKeyvault({
    backend: 'keychain',
    keychainService: service,
    env: {},
    track: false,
  });
  try {
    assert.equal(kv.backend, 'keychain');
    await kv.setKey('anthropic', FAKE.anthropic);
    assert.equal(await kv.getKey('anthropic'), FAKE.anthropic);

    // Existence is answerable without reading the secret.
    assert.equal(await keychain.has('anthropic', service), true);
    assert.equal(await keychain.has('replicate', service), false);

    // Rotation goes through `-U`, which is the difference between exit 0 and 45.
    const rotated = 'sk-ant-api03-RoTaTeD00001111222233334444555566667777888899990000';
    await kv.setKey('anthropic', rotated);
    assert.equal(await kv.getKey('anthropic'), rotated);

    const status = (await kv.listProviders()).find((p) => p.provider === 'anthropic');
    assert.equal(status?.configured, true);
    assert.equal(status?.source, 'keychain');
    assert.ok(status?.masked && !status.masked.includes(rotated), 'listing leaked the key');

    assert.equal(await kv.deleteKey('anthropic'), true);
    assert.equal(await kv.getKey('anthropic'), undefined);
    assert.equal(await kv.deleteKey('anthropic'), false, 'exit 44 means nothing to delete');
  } finally {
    await keychain.remove('anthropic', service).catch(() => undefined);
    lock();
  }
});

test(
  'a key with awkward characters survives the stdin prompt',
  { skip: enabled ? false : why },
  async () => {
    const service = `inkcast-test-${randomBytes(6).toString('hex')}`;
    const kv = createKeyvault({
      backend: 'keychain',
      keychainService: service,
      env: {},
      track: false,
    });
    // Shell metacharacters and quotes: proof the secret never goes through a
    // shell, and never through argv.
    const awkward = `sk-ant-api03-$(whoami)'";\`|&<>*?[]{}~!#%^-0123456789abcdef`;
    try {
      await kv.setKey('anthropic', awkward);
      assert.equal(await kv.getKey('anthropic'), awkward);
    } finally {
      await keychain.remove('anthropic', service).catch(() => undefined);
      lock();
    }
  },
);

test(
  'the keychain never stores an empty password on a successful write',
  { skip: enabled ? false : why },
  async () => {
    // `security add-generic-password ... -w` prompts twice and, given a single
    // line of stdin, stores an EMPTY password and exits 0. setKey() reads back
    // and compares to make that unreachable; this pins the read-back in place.
    const service = `inkcast-test-${randomBytes(6).toString('hex')}`;
    try {
      await keychain.write('elevenlabs', FAKE.elevenlabs, service);
      const stored = await keychain.read('elevenlabs', service);
      assert.equal(stored, FAKE.elevenlabs);
      assert.notEqual(stored, '', 'the confirmation prompt swallowed the password');
    } finally {
      await keychain.remove('elevenlabs', service).catch(() => undefined);
    }
  },
);

test('an invocation we feed has no controlling terminal', () => {
  // The bug this pins is invisible to every other test in this file, and that is the
  // point of testing the option rather than the outcome. `security -w` prompts, and a
  // prompt reads /dev/tty when the process has one — so the pipe we wrote is ignored and
  // the write blocks until the timeout. A test runner has no controlling terminal, so the
  // broken version round-tripped perfectly here while failing in the studio, whose dev
  // server was started from a terminal. `detached` is what removes the race.
  assert.equal(keychain.spawnOptions(true).detached, true, 'a fed invocation kept its tty');
  // And only there: an invocation that prompts for nothing has no race to lose, and
  // staying attached lets a locked-keychain prompt reach the person at the keyboard.
  assert.equal(keychain.spawnOptions(false).detached, false);
  assert.deepEqual(keychain.spawnOptions(true).stdio, ['pipe', 'pipe', 'pipe']);
});

test('keychain availability is platform-honest', () => {
  assert.equal(keychainAvailable(), process.platform === 'darwin');
});
