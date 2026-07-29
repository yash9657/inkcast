/**
 * The studio's translation layer: what a user is told about a key.
 *
 * The vault itself is no longer tested here — `@inkcast/keyvault` owns that, and
 * the studio's duplicate implementation is gone. What is left to pin down is the
 * part that used to be wrong in ways a unit test can catch: a status that says
 * "configured" for an entry the pipeline cannot use, a status that loses the
 * *reason* an entry is unusable, and an outbound message with a key still in it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderStatus } from '@inkcast/keyvault';

import { describeProbe, scrub, toWire } from './_wire.js';

const ANTHROPIC = 'sk-ant-api03-Aa0bCc1dEe2fGg3hIi4jKk5lMm6nOo7pQq8rSs9tUu0vWw1xYy2zZz3-AbCdEf';

/** A status with every field explicit, so each test varies exactly one thing. */
function status(over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider: 'anthropic',
    configured: false,
    availability: 'absent',
    masked: null,
    length: null,
    envVar: 'ANTHROPIC_API_KEY',
    updatedAt: null,
    lastValidated: null,
    lastValidatedOk: null,
    source: null,
    shadowedByEnv: false,
    ...over,
  };
}

/* ------------------------------------------------------------- status mapping */

test('a readable stored key is reported as configured', () => {
  const wire = toWire(
    status({
      configured: true,
      availability: 'stored',
      masked: 'sk-ant-api03-Aa…CdEf',
      length: ANTHROPIC.length,
      updatedAt: '2026-07-01T10:00:00.000Z',
      source: 'keychain',
    }),
  );
  assert.equal(wire.configured, true);
  assert.equal(wire.source, 'keychain');
  assert.equal(wire.length, ANTHROPIC.length);
  assert.equal(wire.updatedAt, '2026-07-01T10:00:00.000Z');
  assert.equal(wire.unreadable, undefined);
  assert.equal(wire.locked, undefined);
});

test('nothing configured omits every optional field rather than sending null', () => {
  const wire = toWire(status());
  assert.equal(wire.configured, false);
  assert.equal(wire.source, 'none');
  // The client parser treats absence as "unknown"; null would make it special-case
  // two empty values at every site.
  assert.ok(!('mask' in wire), 'mask must be omitted, not null');
  assert.ok(!('length' in wire));
  assert.ok(!('updatedAt' in wire));
});

test('a locked entry is unusable, and says the reason is the passphrase', () => {
  const wire = toWire(
    status({ availability: 'locked', masked: 'sk-ant-api03-Aa…CdEf', length: 66 }),
  );
  // Not configured, because that is what the pipeline experiences — reporting it
  // as configured is what let a stored key look usable while renders ran locally.
  assert.equal(wire.configured, false);
  assert.equal(wire.unreadable, true);
  assert.equal(wire.locked, true);
  // The preview survives, so the page can still say *which* key is stuck.
  assert.equal(wire.mask, 'sk-ant-api03-Aa…CdEf');
});

test('a damaged entry is unusable, and does not claim to need a passphrase', () => {
  const wire = toWire(status({ availability: 'unreadable', masked: 'sk-ant-api03-Aa…CdEf' }));
  assert.equal(wire.configured, false);
  assert.equal(wire.unreadable, true);
  // The distinction the UI branches on: `locked` means "set a passphrase", its
  // absence means "paste it again". Conflating them makes a user destroy a good key.
  assert.equal(wire.locked, undefined);
});

test('an environment key reports the variable that actually supplied it', () => {
  const wire = toWire(
    status({
      provider: 'fal',
      configured: true,
      availability: 'env',
      source: 'env',
      // fal's legacy name, not the canonical FAL_KEY.
      envVar: 'FAL_API_KEY',
      shadowedByEnv: true,
    }),
  );
  assert.equal(wire.envVar, 'FAL_API_KEY');
  assert.equal(wire.shadowedByEnv, true);
});

/* ------------------------------------------------------------------ redaction */

test('scrub removes the key it is holding', () => {
  const out = scrub(`the request with ${ANTHROPIC} failed`, [ANTHROPIC]);
  assert.ok(!out.includes(ANTHROPIC), `the key survived: ${out}`);
  assert.ok(out.includes('[redacted]'));
});

test('scrub removes a key it is not holding, by shape', () => {
  // The leak is a *different* credential from the one in hand — a provider echoing
  // something back, or an error from a layer we did not build. The shape pass is
  // the only thing standing between that and the browser.
  const other = 'r8_AbCdEf0123456789GhIjKlMnOpQrStUvWx';
  const out = scrub(`upstream said ${other}`, [ANTHROPIC]);
  assert.ok(!out.includes(other), `an untracked key survived: ${out}`);
});

test('scrub ignores short "secrets" so ordinary prose is not corrupted', () => {
  // Below the threshold a value is likelier to be a word than a credential.
  assert.equal(scrub('the key is set', ['key']), 'the key is set');
});

test('scrub bounds the message length', () => {
  // Prose, not a long character run: a run would be eaten by the shape rules as a
  // suspected base64 blob, and this is testing the length cap rather than those.
  const out = scrub('the upstream service explained itself at length. '.repeat(100));
  assert.ok(out.length <= 401, `unbounded message: ${out.length} chars`);
  assert.ok(out.endsWith('…'));
});

/* ----------------------------------------------------------------- validation */

test('a rejected key is invalid, and the provider body is demoted to detail', () => {
  const raw = '{"type":"error","error":{"message":"invalid x-api-key"}}';
  const out = describeProbe(
    { reason: 'rejected', status: 401, message: raw },
    'Anthropic',
    ANTHROPIC,
  );

  assert.equal(out.status, 'invalid');
  assert.equal(out.httpStatus, 401);
  // The headline is prose a user can act on, not the provider's JSON. That JSON
  // stays available underneath for a bug report.
  assert.ok(out.message.startsWith('Anthropic rejected the key.'));
  assert.ok(!out.message.includes('x-api-key'), 'raw body leaked into the headline');
  assert.equal(out.detail, raw);
});

test('rate limiting means the key authenticated, so it is valid', () => {
  // 429 got past authentication to a quota check. Calling this invalid would be
  // wrong, and calling it unknown would be timid.
  const out = describeProbe({ reason: 'rate-limited', status: 429 }, 'ElevenLabs', ANTHROPIC);
  assert.equal(out.status, 'valid');
  assert.match(out.message, /rate-limited/);
});

test('an unreachable provider is unknown, never invalid', () => {
  // The failure a traveller hits. Reporting "invalid" here gets a good key deleted.
  const out = describeProbe({ reason: 'network', message: 'fetch failed' }, 'Replicate', ANTHROPIC);
  assert.equal(out.status, 'unknown');
  assert.match(out.message, /could not be checked/);
  assert.match(out.message, /saved and will be used/);
});

test('a 5xx says nothing about the key', () => {
  const out = describeProbe({ reason: 'server-error', status: 503 }, 'fal', ANTHROPIC);
  assert.equal(out.status, 'unknown');
  assert.equal(out.httpStatus, 503);
});

test('403 is invalid but is not described as a wrong key', () => {
  const out = describeProbe({ reason: 'forbidden', status: 403 }, 'Anthropic', ANTHROPIC);
  assert.equal(out.status, 'invalid');
  // The key is real; the fix is scopes or billing, not re-pasting.
  assert.match(out.message, /lacks the permission/);
  assert.ok(!/Copy it again/.test(out.message));
});

test('an unrecognised verdict degrades to unknown rather than throwing', () => {
  const out = describeProbe({ reason: 'something-new', status: 418 }, 'Anthropic', ANTHROPIC);
  assert.equal(out.status, 'unknown');
});

test('a validation detail never carries the key', () => {
  // The worst case: the provider echoes the credential we sent it straight back.
  const echoed = `{"error":"bad key: ${ANTHROPIC}"}`;
  const out = describeProbe({ reason: 'rejected', status: 401, message: echoed }, 'A', ANTHROPIC);
  assert.ok(out.detail !== undefined);
  assert.ok(!out.detail.includes(ANTHROPIC), `the key reached the browser: ${out.detail}`);
});
