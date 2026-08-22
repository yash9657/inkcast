/**
 * Per-IP admission control for the hosted studio — the whole of plan item D2.
 *
 * ## What this is defending
 *
 * A generation is not a page view. One `POST /api/generate` spends real money
 * (an Anthropic lesson call, then ElevenLabs characters) and then occupies a
 * Chromium context and an ffmpeg process for minutes. Launch runs on **one box**
 * with no paywall and no accounts, so the only thing between "hundreds of
 * users" and a bill nobody approved is a counter. Three videos a day per address
 * is roughly one person trying the product properly; ten total operations a day
 * absorbs the edit/re-render loop that follows those three without letting a
 * script sit in a `while true`.
 *
 * ## Why a token bucket rather than a daily counter
 *
 * "3 per day" as a calendar counter has two failure modes: everybody's quota
 * resets at the same instant (a thundering herd against a two-render queue), and
 * a user who spends their three at 23:55 is told to come back in five minutes
 * and then blocked again. A bucket of capacity 3 refilling continuously over 24 h
 * has neither: the capacity *is* the burst cap the plan asks for, the refill rate
 * is the sustained rate, and "come back in about 8 hours" is both true and
 * explainable. `retryAfterSec` on a denial is therefore a real number, not a
 * guess at midnight.
 *
 * ## Two limits, one decision
 *
 * `generation` (POST /api/generate) draws from both buckets; `operation`
 * (/edit, /rerender) draws from the total bucket only. That is what makes
 * "3 generations, 10 total" a single coherent rule instead of two limits that
 * can disagree: the expensive action can never exceed the cheap one's budget,
 * and a denial always names which ceiling was hit so the copy can be specific.
 *
 * Both buckets are debited only after *both* have been checked. Debiting as we
 * go would charge a token for a request we then refuse — the user pays for a 429,
 * which is the kind of quiet unfairness nobody ever reports and nobody can
 * reproduce.
 *
 * ## Storage
 *
 * In-process `Map`, pinned to `globalThis` so `next dev`'s hot reload cannot
 * hand an attacker a fresh quota on every file save (the same reason
 * `lib/jobs.ts` pins its registry). **This is correct for exactly one box**,
 * which is what D5 deploys: a second app instance would each keep half a limit.
 * That is why `BucketStore` is an interface and `createLimiter` takes one — the
 * day there are two boxes, a Redis implementation of three methods is the whole
 * change, and nothing in the routes moves.
 *
 * Nothing here imports `next/server` or `@/lib/store`: the decision is a pure
 * function of headers, a clock and a store, so it is unit-testable under plain
 * `node --test` and the 429 *response* is built by `tooManyRequests` in
 * `./http`. Environment variables are read per call rather than at module load,
 * because the root `.env` is loaded by `lib/store`'s bootstrap and this module
 * must not care whether that has happened yet.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/* --------------------------------------------------------------- the client */

/**
 * How many reverse proxies in front of this process append to
 * `X-Forwarded-For`, and therefore how far from the right of that list the real
 * client sits.
 *
 * **The proxy assumption, stated exactly**: production is `client → Caddy →
 * Next`, and Caddy's `reverse_proxy` *appends* the address of the peer it
 * accepted the connection from. So the list we receive is
 * `<whatever the client made up>, <the address Caddy actually saw>` and the
 * **rightmost** entry is the only one that was not written by the client.
 *
 * Reading the *leftmost* entry — which is what almost every naive
 * implementation does, because that is where the client IP lives when nobody is
 * lying — makes this whole file decorative: `curl -H 'X-Forwarded-For: 1.2.3.4'`
 * with a random address per request buys unlimited generations. Hence
 * `parts[parts.length - hops]`, and hence the deliberate refusal to fall back to
 * the leftmost entry when the list is shorter than expected: a chain with fewer
 * hops than configured means the request did not come through the proxy we
 * trust, so its headers are worth nothing.
 *
 * Set `INKCAST_TRUSTED_PROXY_HOPS` if a CDN is ever put in front of Caddy (each
 * appending hop adds one). Getting it *too high* fails closed — unknown client,
 * shared bucket — rather than open.
 */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INKCAST_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 8) return 1;
  return n;
}

/**
 * The bucket key for a request: an address family–aware client identity.
 *
 * IPv6 is truncated to its /64 prefix on purpose. A residential IPv6 client is
 * routinely handed a /64 (often a /56) and can pick a new full address per
 * request at zero cost, so keying on all 128 bits limits nobody. IPv4 is used
 * whole — CGNAT means a /24 would sweep in strangers.
 *
 * Returns `undefined` when the chain is missing or too short to trust, so the
 * caller can decide what an unattributable request costs. Never throws: a
 * malformed header is a reason to distrust it, not to 500.
 */
export function clientKey(
  headers: Headers,
  options: { hops?: number; env?: NodeJS.ProcessEnv } = {},
): string | undefined {
  const hops = options.hops ?? trustedProxyHops(options.env);
  const forwarded = headers.get('x-forwarded-for');

  if (hops === 0) {
    // No proxy: nothing in the request may be believed about its origin, and
    // Next does not expose the socket address to a route handler. `x-real-ip` is
    // only meaningful if *we* configured the proxy that sets it, which at zero
    // hops we did not.
    return undefined;
  }
  if (forwarded === null) return undefined;

  const parts = forwarded
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  // Fewer hops present than we trust ⇒ this request did not traverse our proxy.
  if (parts.length < hops) return undefined;

  const raw = parts[parts.length - hops];
  if (raw === undefined) return undefined;
  const address = normaliseAddress(raw);
  if (address === undefined) return undefined;
  return address;
}

/**
 * Reduce one `X-Forwarded-For` entry to a comparable identity.
 *
 * Handles the three shapes that actually turn up: a bare address, an IPv4
 * `host:port` (some proxies include the ephemeral port, which would otherwise
 * make every request a new client), and a bracketed IPv6 `[::1]:443`.
 */
function normaliseAddress(input: string): string | undefined {
  let value = input.trim().toLowerCase();
  if (value === '') return undefined;

  const bracketed = /^\[([0-9a-f:.]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.indexOf(':'));

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    // Reject 1.2.3.999 and friends rather than trusting them as an identity.
    return value.split('.').every((o) => Number(o) <= 255) ? value : undefined;
  }
  if (value.includes(':')) {
    if (!/^[0-9a-f:.]+$/.test(value)) return undefined;
    // ::ffff:1.2.3.4 is an IPv4 client arriving over a v6 socket.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
    if (mapped) return normaliseAddress(mapped[1]!);
    return ipv6Prefix(value);
  }
  return undefined;
}

/** First four hextets of an IPv6 address — its /64 — with `::` expanded. */
function ipv6Prefix(value: string): string | undefined {
  const [head = '', tail = '', extra] = value.split('::');
  if (extra !== undefined) return undefined;
  const left = head.split(':').filter((h) => h !== '');
  const right = tail.split(':').filter((h) => h !== '');
  const groups = value.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  if (groups.length !== 8) return undefined;
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  // Canonicalise the hextets: `2001:0db8` and `2001:db8` are the same prefix,
  // and a client that alternated the two spellings would otherwise get two
  // buckets out of one address.
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::/64`;
}

/* ---------------------------------------------------------------- the bypass */

/**
 * The team's escape hatch: one shared secret in `INKCAST_BYPASS_TOKEN`,
 * presented as `X-Inkcast-Bypass`.
 *
 * Two properties this deliberately has. It is compared in **constant time** —
 * a byte-by-byte `===` over a secret leaks its prefix to anyone willing to time
 * a few thousand requests, and a rate limiter is precisely the endpoint an
 * attacker is allowed to hammer. Both sides are hashed first so `timingSafeEqual`
 * gets equal-length buffers (it throws otherwise, and the throw itself would
 * leak the length).
 *
 * And an **unset or blank env disables the bypass entirely**. Without that
 * check, a deployment that forgot to set the variable would accept an empty
 * header as the empty secret — the classic way a bypass becomes a bypass of the
 * bypass.
 */
export function bypassAllowed(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.INKCAST_BYPASS_TOKEN;
  if (secret === undefined || secret.trim() === '') return false;
  const presented = headers.get('x-inkcast-bypass');
  if (presented === null || presented === '') return false;
  return sameSecret(presented, secret);
}

function sameSecret(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/* ---------------------------------------------------------------- the bucket */

/** What an action costs. A generation spends from both budgets; see the header. */
export type Action = 'generation' | 'operation';

export type Limit = {
  /** Appears in the 429 body so support can tell the two ceilings apart. */
  readonly name: 'generation' | 'total';
  /** Burst cap, and the number of tokens restored per window. */
  readonly capacity: number;
  readonly windowMs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 3 generations a day, 10 operations a day, per the plan's D2. */
export const GENERATION_LIMIT: Limit = { name: 'generation', capacity: 3, windowMs: DAY_MS };
export const TOTAL_LIMIT: Limit = { name: 'total', capacity: 10, windowMs: DAY_MS };

/** Fractional tokens are the whole point of a bucket — do not round this. */
export type BucketState = { tokens: number; updatedAt: number };

/**
 * The swappable half. Three synchronous methods, because the in-process
 * implementation has nothing to await and a Redis one can keep its own
 * write-behind; `read` returning `undefined` must mean "full bucket", which is
 * what makes eviction safe.
 */
export interface BucketStore {
  read(key: string): BucketState | undefined;
  write(key: string, state: BucketState): void;
  /** Entry count, for `/api/health` to report pressure without naming anyone. */
  size(): number;
}

/**
 * Bounded in-memory store.
 *
 * The bound matters: a rotating-IP flood would otherwise grow this Map until the
 * box swaps, which is a cheaper attack than the one we are preventing. Eviction
 * prefers entries that have refilled to capacity, because dropping those loses
 * no information at all — `read` → `undefined` and a full bucket are the same
 * fact. Only if every entry is still penalised do we evict the least-penalised,
 * and we accept the consequence honestly: an attacker with tens of thousands of
 * addresses can push their own entry out and win back a token. The backstop for
 * that is not this file, it is the two-render global semaphore in D1 — the box
 * cannot be made to do more work than that allows, whatever the counter says.
 */
export function memoryStore(maxEntries = 50_000): BucketStore {
  const map = new Map<string, BucketState>();
  return {
    read: (key) => map.get(key),
    write(key, state) {
      map.set(key, state);
      if (map.size <= maxEntries) return;
      const ranked = [...map.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
      for (const [key] of ranked.slice(0, Math.ceil(maxEntries / 10))) map.delete(key);
    },
    size: () => map.size,
  };
}

export type Allowed = {
  allowed: true;
  /** True when the team secret was presented; nothing was debited. */
  bypassed: boolean;
  /**
   * Whole actions left in the tighter of the two budgets, and `Infinity` when
   * the limiter is off or was bypassed. Clamp it before it reaches JSON —
   * `JSON.stringify(Infinity)` is `null`, the same trap `finite()` in
   * `lib/store.ts` exists to avoid.
   */
  remaining: number;
};

export type Denied = {
  allowed: false;
  /** Which ceiling was hit. */
  limit: Limit['name'];
  /** Seconds until one token is available again. Always ≥ 1. */
  retryAfterSec: number;
};

export type Decision = Allowed | Denied;

export type Limiter = {
  /** Check and, if allowed, debit. */
  take(key: string, action: Action): Decision;
  /** What `take` would say, without spending anything. For a UI hint. */
  peek(key: string, action: Action): Decision;
  /** How many distinct clients are being tracked. */
  tracked(): number;
};

export function createLimiter(
  options: {
    store?: BucketStore;
    now?: () => number;
    generation?: Limit;
    total?: Limit;
  } = {},
): Limiter {
  const store = options.store ?? memoryStore();
  const now = options.now ?? (() => Date.now());
  const generation = options.generation ?? GENERATION_LIMIT;
  const total = options.total ?? TOTAL_LIMIT;

  const limitsFor = (action: Action): Limit[] =>
    action === 'generation' ? [generation, total] : [total];

  function decide(key: string, action: Action, spend: boolean): Decision {
    const at = now();
    const limits = limitsFor(action);
    const states = limits.map((limit) => ({ limit, state: refill(store, limit, key, at) }));

    // Check everything before debiting anything: a refused request must not be
    // charged for the budget that was not the problem.
    const denials = states
      .filter(({ state }) => state.tokens < 1)
      .map(({ limit, state }) => ({
        allowed: false as const,
        limit: limit.name,
        retryAfterSec: waitFor(limit, state.tokens),
      }));
    if (denials.length > 0) {
      // Report the longest wait, so a client that obeys `Retry-After` is not
      // sent back into a second 429 by the other ceiling.
      return denials.reduce((a, b) => (b.retryAfterSec > a.retryAfterSec ? b : a));
    }

    if (spend) {
      for (const { limit, state } of states) {
        store.write(bucketKey(limit, key), { tokens: state.tokens - 1, updatedAt: at });
      }
    }

    return {
      allowed: true,
      bypassed: false,
      remaining: Math.min(...states.map(({ state }) => Math.floor(state.tokens - (spend ? 1 : 0)))),
    };
  }

  return {
    take: (key, action) => decide(key, action, true),
    peek: (key, action) => decide(key, action, false),
    tracked: () => store.size(),
  };
}

/** Buckets are namespaced per limit so `generation` and `total` never collide. */
function bucketKey(limit: Limit, key: string): string {
  return `${limit.name}:${key}`;
}

/**
 * The bucket's only arithmetic: restore `capacity` tokens per `windowMs`,
 * clamped to `capacity`.
 *
 * An absent entry is a full bucket, which is what lets the store evict freely.
 * A clock that moved backwards (NTP step, or a test) contributes nothing rather
 * than draining the bucket, because `Math.max(0, …)` on the elapsed time is
 * cheaper than reasoning about negative refills.
 */
function refill(store: BucketStore, limit: Limit, key: string, at: number): BucketState {
  const previous = store.read(bucketKey(limit, key));
  if (previous === undefined) return { tokens: limit.capacity, updatedAt: at };
  const elapsed = Math.max(0, at - previous.updatedAt);
  const gained = (elapsed * limit.capacity) / limit.windowMs;
  return { tokens: Math.min(limit.capacity, previous.tokens + gained), updatedAt: at };
}

/** Seconds until `tokens` reaches 1. Never 0 — `Retry-After: 0` invites a retry storm. */
function waitFor(limit: Limit, tokens: number): number {
  const needed = Math.max(0, 1 - tokens);
  return Math.max(1, Math.ceil((needed * limit.windowMs) / limit.capacity / 1000));
}

/* ------------------------------------------------------- the shared instance */

/**
 * One limiter per process, pinned across hot reloads for the reason given in the
 * header. `lib/jobs.ts` pins its registry the same way and for the same reason.
 */
const shared = ((
  globalThis as typeof globalThis & { __inkcastRateLimiter?: Limiter }
).__inkcastRateLimiter ??= createLimiter());

export function sharedLimiter(): Limiter {
  return shared;
}

/**
 * Is the limiter switched on?
 *
 * **Off by default**, and that is not laziness. The studio's primary mode is a
 * local single-user app run by the person who owns the API keys; telling that
 * person they have used up their three videos for the day would be absurd, and
 * they are behind no proxy at all so every request would land in the same
 * unattributable bucket anyway. `INKCAST_HOSTED=1` (D5) is what turns it on,
 * with `INKCAST_RATELIMIT=1` as an independent switch for testing the limiter on
 * a laptop without pretending to be the hosted deployment.
 */
export function limiterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INKCAST_HOSTED === '1' || env.INKCAST_RATELIMIT === '1';
}

/**
 * The route-facing decision, still free of any Next types.
 *
 * A request with no trustworthy address is *not* let through: it is charged to
 * one shared `unattributable` bucket. That fails closed on the only case that
 * matters — a misconfigured proxy in front of the hosted deployment — and costs
 * nothing locally, where the limiter is off.
 *
 * `spend: false` asks the same question without paying for the answer, which is
 * how a route can refuse an over-quota client before reading its body and still
 * charge only for requests that reach real work. A user whose paste was two
 * characters too short should not lose one of three films for the day to a 400;
 * see the two call sites in `generate/route.ts`.
 */
export function admit(
  headers: Headers,
  action: Action,
  options: { limiter?: Limiter; env?: NodeJS.ProcessEnv; spend?: boolean } = {},
): Decision {
  const env = options.env ?? process.env;
  if (!limiterEnabled(env)) return { allowed: true, bypassed: false, remaining: Infinity };
  if (bypassAllowed(headers, env)) return { allowed: true, bypassed: true, remaining: Infinity };
  const limiter = options.limiter ?? sharedLimiter();
  const key = clientKey(headers, { env }) ?? 'unattributable';
  return options.spend === false ? limiter.peek(key, action) : limiter.take(key, action);
}

/* ------------------------------------------------------------------ the copy */

/**
 * What a 429 says out loud.
 *
 * The plan asks for "friendly copy", which in practice means three things: name
 * the actual limit (a user who does not know the number cannot plan around it),
 * say *why* a free product has one, and give a concrete time rather than "later".
 * No apology, and no suggestion that paying would help — nothing to pay for yet.
 */
export function limitMessage(denied: Denied): string {
  const when = humaniseWait(denied.retryAfterSec);
  if (denied.limit === 'generation') {
    return `You've used all ${GENERATION_LIMIT.capacity} videos for today. Inkcast runs on one machine and every film costs real compute, so the daily cap is what keeps it free and the queue short — your next one unlocks ${when}.`;
  }
  return `That's ${TOTAL_LIMIT.capacity} requests today, which is the daily ceiling for edits and re-renders. Your storyboards are safe and nothing is lost; you can pick up ${when}.`;
}

/** "in about 7 hours" — deliberately vague at the top end, exact near zero. */
export function humaniseWait(seconds: number): string {
  if (seconds < 90) return `in a moment`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.round(seconds / 3600);
  if (hours <= 1) return `in about an hour`;
  if (hours < 24) return `in about ${hours} hours`;
  return `tomorrow`;
}
