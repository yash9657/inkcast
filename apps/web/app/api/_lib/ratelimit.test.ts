/**
 * The rate limiter, pinned down where it would actually be attacked.
 *
 * Four properties are worth a test and the rest is arithmetic:
 *
 *  1. **The limit is enforced.** Three generations, then a 429 — with the
 *     ceiling *named*, because the copy depends on knowing which one was hit.
 *  2. **The window really refills.** A limiter that never forgives is a limiter
 *     that turns into a support ticket; a limiter whose refill is wrong in the
 *     other direction hands out free quota. Both directions are checked against
 *     an injected clock rather than a real one, so the suite stays instant.
 *  3. **A spoofed `X-Forwarded-For` does not escape the limit.** This is the
 *     test that justifies the whole file: with one trusted proxy hop, the
 *     rightmost entry is the only truthful one, so an attacker prepending a new
 *     address per request must keep landing in the same bucket. If this test can
 *     be made to pass while `clientKey` reads `parts[0]`, the limiter is theatre.
 *  4. **The bypass secret works, and only the real one does.** Including the
 *     case that has burned every codebase that has ever had a bypass: an unset
 *     environment variable must not match an absent header.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERATION_LIMIT,
  TOTAL_LIMIT,
  admit,
  bypassAllowed,
  clientKey,
  createLimiter,
  limitMessage,
  memoryStore,
} from './ratelimit.js';
import type { Denied, Limiter } from './ratelimit.js';

/**
 * The few environment variables a case cares about, as an environment.
 *
 * Written as a function rather than as `{ ... } as NodeJS.ProcessEnv` at each call site
 * because that cast does not compile: `ProcessEnv` declares named optional members, so
 * TypeScript reads an object literal of unrelated keys as insufficiently overlapping and
 * asks to be routed through `unknown`. Taking `Record<string, string>` and returning
 * `ProcessEnv` gets there honestly instead — the index signature accepts it — and it
 * keeps the assertion out of the tests, where a cast through `unknown` would have
 * silently accepted a misspelled variable name and produced a test that proves nothing.
 */
function asEnv(vars: Record<string, string>): NodeJS.ProcessEnv {
  // `NODE_ENV` is spread in because Next's type declarations make it a *required*
  // member of `ProcessEnv` rather than an optional one, so an object of only the
  // variables under test is not a `ProcessEnv` at all. It is written first so a case
  // can still override it deliberately.
  return { NODE_ENV: 'test', ...vars };
}

/** A limiter on a clock we own. `tick` moves time forward in milliseconds. */
function fixture(): { limiter: Limiter; tick: (ms: number) => void } {
  let clock = Date.UTC(2026, 7, 21, 9, 0, 0);
  const limiter = createLimiter({ store: memoryStore(), now: () => clock });
  return {
    limiter,
    tick: (ms) => {
      clock += ms;
    },
  };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

function denied(value: ReturnType<Limiter['take']>): Denied {
  assert.equal(value.allowed, false, 'expected this request to be refused');
  return value as Denied;
}

/* ------------------------------------------------------------ the limit bites */

test('three generations are allowed and the fourth is refused', () => {
  const { limiter } = fixture();
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) {
    const decision = limiter.take('203.0.113.7', 'generation');
    assert.equal(decision.allowed, true, `generation ${i + 1} should be allowed`);
  }
  const fourth = denied(limiter.take('203.0.113.7', 'generation'));
  assert.equal(fourth.limit, 'generation');
  assert.ok(fourth.retryAfterSec > 0, 'a denial must say when to come back');
});

test('remaining counts down and peek does not spend a token', () => {
  const { limiter } = fixture();
  const first = limiter.take('203.0.113.8', 'generation');
  assert.equal(first.allowed && first.remaining, GENERATION_LIMIT.capacity - 1);

  // Three peeks in a row must all report the same figure.
  for (let i = 0; i < 3; i += 1) {
    const look = limiter.peek('203.0.113.8', 'generation');
    assert.equal(look.allowed && look.remaining, GENERATION_LIMIT.capacity - 1);
  }
  const second = limiter.take('203.0.113.8', 'generation');
  assert.equal(second.allowed && second.remaining, GENERATION_LIMIT.capacity - 2);
});

test('one client running out does not affect another', () => {
  const { limiter } = fixture();
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) limiter.take('198.51.100.1', 'generation');
  denied(limiter.take('198.51.100.1', 'generation'));
  assert.equal(limiter.take('198.51.100.2', 'generation').allowed, true);
});

test('the total ceiling stops the edit/re-render loop at ten', () => {
  const { limiter } = fixture();
  // Three generations draw from both budgets, so seven cheap operations remain.
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) {
    assert.equal(limiter.take('203.0.113.9', 'generation').allowed, true);
  }
  const cheap = TOTAL_LIMIT.capacity - GENERATION_LIMIT.capacity;
  for (let i = 0; i < cheap; i += 1) {
    assert.equal(
      limiter.take('203.0.113.9', 'operation').allowed,
      true,
      `operation ${i + 1} of ${cheap} should be allowed`,
    );
  }
  const over = denied(limiter.take('203.0.113.9', 'operation'));
  assert.equal(over.limit, 'total');
});

test('a refused generation is not charged to the total budget', () => {
  const { limiter } = fixture();
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) limiter.take('203.0.113.10', 'generation');
  // Four refused generations would silently burn four `total` tokens if the
  // buckets were debited as they were checked.
  for (let i = 0; i < 4; i += 1) denied(limiter.take('203.0.113.10', 'generation'));
  const remainingOperations = TOTAL_LIMIT.capacity - GENERATION_LIMIT.capacity;
  for (let i = 0; i < remainingOperations; i += 1) {
    assert.equal(
      limiter.take('203.0.113.10', 'operation').allowed,
      true,
      `the refusals must not have spent operation ${i + 1}`,
    );
  }
});

/* ------------------------------------------------------------- the window resets */

test('a full window restores the whole budget', () => {
  const { limiter, tick } = fixture();
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) limiter.take('192.0.2.5', 'generation');
  denied(limiter.take('192.0.2.5', 'generation'));

  tick(DAY);
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) {
    assert.equal(
      limiter.take('192.0.2.5', 'generation').allowed,
      true,
      `generation ${i + 1} should be allowed again a day later`,
    );
  }
  denied(limiter.take('192.0.2.5', 'generation'));
});

test('a third of the window returns exactly one of three tokens', () => {
  const { limiter, tick } = fixture();
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) limiter.take('192.0.2.6', 'generation');

  // Eight hours is one token at 3/day. Just under it is still a refusal — the
  // boundary is where an off-by-one in the refill maths would hide.
  tick(DAY / GENERATION_LIMIT.capacity - 1000);
  denied(limiter.take('192.0.2.6', 'generation'));

  tick(2000);
  assert.equal(limiter.take('192.0.2.6', 'generation').allowed, true);
  denied(limiter.take('192.0.2.6', 'generation'));
});

test('the refill is capped at the burst ceiling rather than accumulating', () => {
  const { limiter, tick } = fixture();
  limiter.take('192.0.2.7', 'generation');
  // A month idle must not bank thirty days of tokens.
  tick(30 * DAY);
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) {
    assert.equal(limiter.take('192.0.2.7', 'generation').allowed, true);
  }
  denied(limiter.take('192.0.2.7', 'generation'));
});

test('retryAfterSec is roughly the true wait and never zero', () => {
  const { limiter } = fixture();
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) limiter.take('192.0.2.8', 'generation');
  const { retryAfterSec } = denied(limiter.take('192.0.2.8', 'generation'));
  const eightHours = DAY / GENERATION_LIMIT.capacity / 1000;
  assert.ok(
    Math.abs(retryAfterSec - eightHours) <= 2,
    `expected about ${eightHours}s, got ${retryAfterSec}s`,
  );
  assert.match(limitMessage({ allowed: false, limit: 'generation', retryAfterSec }), /8 hours/);
});

/* --------------------------------------------------- spoofed forwarding headers */

test('the client is read from the right of x-forwarded-for, not the left', () => {
  // One trusted hop: Caddy appended `203.0.113.20`, the client invented the rest.
  const key = clientKey(headers({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9, 203.0.113.20' }), {
    hops: 1,
  });
  assert.equal(key, '203.0.113.20');
});

test('a spoofed x-forwarded-for cannot escape the limit', () => {
  const { limiter } = fixture();
  const attacker = '203.0.113.66';

  // Every request invents a fresh chain; Caddy appends the real peer.
  const spoof = (n: number) =>
    headers({ 'x-forwarded-for': `10.0.0.${n}, 172.16.0.${n}, ${attacker}` });

  const outcomes = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      admit(spoof(n), 'generation', {
        limiter,
        env: asEnv({ INKCAST_RATELIMIT: '1' }),
      }).allowed,
  );
  assert.deepEqual(
    outcomes,
    [true, true, true, false, false, false],
    'a new fake address per request must not buy a new bucket',
  );
});

test('a chain shorter than the trusted hop count is not believed', () => {
  // Direct hit on the app port with a hand-written header: with one trusted hop
  // the single entry *is* the rightmost, so this must not be read as a client
  // identity that the attacker chose. `undefined` sends it to the shared bucket.
  assert.equal(clientKey(headers({}), { hops: 1 }), undefined);
  assert.equal(clientKey(headers({ 'x-forwarded-for': '' }), { hops: 1 }), undefined);
  assert.equal(clientKey(headers({ 'x-forwarded-for': '1.2.3.4' }), { hops: 2 }), undefined);
});

test('unattributable requests share one bucket rather than being waved through', () => {
  const { limiter } = fixture();
  const env = asEnv({ INKCAST_RATELIMIT: '1' });
  for (let i = 0; i < GENERATION_LIMIT.capacity; i += 1) {
    assert.equal(admit(headers({}), 'generation', { limiter, env }).allowed, true);
  }
  assert.equal(admit(headers({}), 'generation', { limiter, env }).allowed, false);
});

test('two trusted hops read one entry further left', () => {
  const chain = { 'x-forwarded-for': '1.2.3.4, 203.0.113.30, 198.51.100.9' };
  assert.equal(clientKey(headers(chain), { hops: 2 }), '203.0.113.30');
  assert.equal(
    clientKey(headers(chain), { env: asEnv({ INKCAST_TRUSTED_PROXY_HOPS: '2' }) }),
    '203.0.113.30',
  );
});

test('addresses are normalised so one client cannot look like many', () => {
  // A port makes every request unique unless it is stripped.
  assert.equal(clientKey(headers({ 'x-forwarded-for': '203.0.113.7:51234' })), '203.0.113.7');
  assert.equal(
    clientKey(headers({ 'x-forwarded-for': '[2001:db8:1:2::1]:443' })),
    '2001:db8:1:2::/64',
  );
  // A /64 is handed out per household, so the suffix must not be part of the key.
  assert.equal(
    clientKey(headers({ 'x-forwarded-for': '2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd' })),
    '2001:db8:1:2::/64',
  );
  assert.equal(clientKey(headers({ 'x-forwarded-for': '::ffff:203.0.113.7' })), '203.0.113.7');
  // Nonsense is distrusted rather than adopted as an identity.
  assert.equal(clientKey(headers({ 'x-forwarded-for': '1.2.3.999' })), undefined);
  assert.equal(clientKey(headers({ 'x-forwarded-for': 'not-an-address' })), undefined);
});

test('a rotating IPv6 suffix stays in one bucket', () => {
  const { limiter } = fixture();
  const env = asEnv({ INKCAST_RATELIMIT: '1' });
  const outcomes = [1, 2, 3, 4].map(
    (n) =>
      admit(headers({ 'x-forwarded-for': `2001:db8:5:6::${n}` }), 'generation', { limiter, env })
        .allowed,
  );
  assert.deepEqual(outcomes, [true, true, true, false]);
});

/* --------------------------------------------------------------- the bypass */

test('the bypass token lifts the limit without spending anything', () => {
  const { limiter } = fixture();
  const env = asEnv({ INKCAST_RATELIMIT: '1', INKCAST_BYPASS_TOKEN: 's3cret-team-token' });
  const request = headers({
    'x-forwarded-for': '203.0.113.77',
    'x-inkcast-bypass': 's3cret-team-token',
  });

  for (let i = 0; i < 25; i += 1) {
    const decision = admit(request, 'generation', { limiter, env });
    assert.equal(decision.allowed, true, `bypassed request ${i + 1} should be allowed`);
    assert.equal(decision.allowed && decision.bypassed, true);
  }
  // Nothing was debited, so the same address still has its full budget.
  assert.equal(limiter.peek('203.0.113.77', 'generation').allowed, true);
});

test('a wrong, absent or unconfigured bypass token does not lift the limit', () => {
  const configured = asEnv({ INKCAST_BYPASS_TOKEN: 's3cret-team-token' });
  assert.equal(bypassAllowed(headers({ 'x-inkcast-bypass': 'wrong' }), configured), false);
  // A prefix of the real secret is the case a non-constant-time compare leaks.
  assert.equal(bypassAllowed(headers({ 'x-inkcast-bypass': 's3cret' }), configured), false);
  assert.equal(bypassAllowed(headers({}), configured), false);

  // The trap: no secret configured must not mean "everything matches".
  assert.equal(bypassAllowed(headers({ 'x-inkcast-bypass': '' }), asEnv({})), false);
  assert.equal(bypassAllowed(headers({ 'x-inkcast-bypass': 'anything' }), asEnv({})), false);
  assert.equal(
    bypassAllowed(headers({ 'x-inkcast-bypass': '   ' }), asEnv({ INKCAST_BYPASS_TOKEN: '   ' })),
    false,
  );
});

/* ------------------------------------------------------------- the switch off */

test('the limiter is inert until the deployment asks for it', () => {
  const { limiter } = fixture();
  for (let i = 0; i < 40; i += 1) {
    const decision = admit(headers({ 'x-forwarded-for': '203.0.113.88' }), 'generation', {
      limiter,
      env: asEnv({}),
    });
    assert.equal(decision.allowed, true, 'the local studio must never be rate limited');
  }
  assert.equal(limiter.tracked(), 0, 'a disabled limiter should not even allocate buckets');
});

/* ---------------------------------------------------------------- the store */

test('the memory store is bounded and evicts the least penalised first', () => {
  const store = memoryStore(20);
  const limiter = createLimiter({ store, now: () => 1_000 });
  for (let i = 0; i < 200; i += 1)
    limiter.take(`10.1.${Math.floor(i / 250)}.${i % 250}`, 'operation');
  assert.ok(store.size() <= 20, `store grew to ${store.size()} entries`);

  // A client that has spent everything is the one worth remembering, so it must
  // survive a flood of clients that have spent one token each.
  const heavy = memoryStore(20);
  const second = createLimiter({ store: heavy, now: () => 1_000 });
  for (let i = 0; i < TOTAL_LIMIT.capacity; i += 1) second.take('192.0.2.99', 'operation');
  for (let i = 0; i < 100; i += 1) second.take(`10.2.0.${i}`, 'operation');
  assert.equal(second.peek('192.0.2.99', 'operation').allowed, false);
});
