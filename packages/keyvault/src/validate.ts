/**
 * Live key validation: the cheapest authenticated request each provider offers.
 *
 * "Cheapest" means an endpoint that authenticates but bills nothing and mutates
 * nothing — a metadata or account read, never an inference or synthesis call. All
 * four were probed against this repo's network with a deliberately invalid key to
 * confirm the URL and header shape are right (each returns 401, not 404):
 *
 *   | provider   | request                                        | auth header               |
 *   | ---------- | --------------------------------------------- | ------------------------- |
 *   | anthropic  | GET  api.anthropic.com/v1/models?limit=1      | `x-api-key` + version     |
 *   | elevenlabs | GET  api.elevenlabs.io/v1/user                | `xi-api-key`              |
 *   | replicate  | GET  api.replicate.com/v1/account             | `Authorization: Token …`  |
 *   | fal        | POST rest.alpha.fal.ai/tokens/                | `Authorization: Key …`    |
 *
 * These are raw `fetch` calls rather than SDK calls on purpose. Adding
 * `@anthropic-ai/sdk` to a credential-storage package to make one unauthenticated
 * metadata GET would give the vault a dependency on the very layer it exists to
 * serve, and three of the four providers have no SDK in this workspace at all —
 * one uniform code path keeps the security-relevant surface small and identical
 * across providers. No Messages/inference API is called from here.
 *
 * fal is the odd one out: it has no free account-read endpoint, so we ask its
 * token service for a short-lived scoped JWT. That is fal's own documented way to
 * exchange a key, it costs nothing, and a bad key is rejected with
 * `{"detail":"No user found for Key ID and Secret"}` at 401.
 */
import { logger } from '@inkcast/core';
import type { Provider } from './providers.js';
import { redact, withSecretRedaction } from './redact.js';

const log = logger('keyvault:validate');

const TIMEOUT_MS = 15_000;

export type ValidationReason =
  /** No key at all — not an error, just nothing to check. */
  | 'not-configured'
  /** The provider authenticated the key. */
  | 'accepted'
  /** 401: the key is wrong, revoked, or malformed. */
  | 'rejected'
  /** 403: the key is real but lacks permission (or the account is suspended). */
  | 'forbidden'
  /** 429: throttled; authentication is not established. */
  | 'rate-limited'
  /** 5xx: the provider is having a bad day; says nothing about the key. */
  | 'server-error'
  /** DNS, TLS, offline, timeout. Says nothing about the key. */
  | 'network'
  /** A status we do not have a rule for. */
  | 'unexpected';

export type ValidationResult = {
  provider: Provider;
  /** True only when the provider positively authenticated the key. */
  ok: boolean;
  reason: ValidationReason;
  /** HTTP status, when there was a response. */
  status?: number;
  /** Short, redacted, human-readable detail. Safe to log or show. */
  message?: string;
  /** ISO timestamp, present when the answer was definitive. */
  checkedAt?: string;
  /** Where the key came from, so a failure names the right thing to fix. */
  source?: 'env' | 'keychain' | 'vault';
};

type Probe = {
  url: string;
  init: (key: string) => RequestInit;
};

const PROBES: Record<Provider, Probe> = {
  fireworks: {
    url: 'https://api.fireworks.ai/inference/v1/models',
    init: (key) => ({ method: 'GET', headers: { Authorization: `Bearer ${key}` } }),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models?limit=1',
    init: (key) => ({
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    }),
  },
  elevenlabs: {
    url: 'https://api.elevenlabs.io/v1/user',
    init: (key) => ({ method: 'GET', headers: { 'xi-api-key': key } }),
  },
  replicate: {
    url: 'https://api.replicate.com/v1/account',
    init: (key) => ({ method: 'GET', headers: { Authorization: `Token ${key}` } }),
  },
  fal: {
    url: 'https://rest.alpha.fal.ai/tokens/',
    init: (key) => ({
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
      // Narrowest possible request: one app, the shortest useful lifetime.
      body: JSON.stringify({ allowed_apps: ['fal-ai/fast-sdxl'], token_expiration: 60 }),
    }),
  },
};

/** Map a status onto a verdict. Only 2xx confirms that the key authenticated. */
function classify(status: number): { ok: boolean; reason: ValidationReason } {
  if (status >= 200 && status < 300) return { ok: true, reason: 'accepted' };
  if (status === 401) return { ok: false, reason: 'rejected' };
  if (status === 403) return { ok: false, reason: 'forbidden' };
  // A throttle may be applied before authentication; do not mark the key valid.
  if (status === 429) return { ok: false, reason: 'rate-limited' };
  if (status >= 500) return { ok: false, reason: 'server-error' };
  return { ok: false, reason: 'unexpected' };
}

/**
 * Read a bounded, redacted slice of the response body.
 *
 * Error bodies from these providers echo request context, and we are about to
 * put this in a log line — so it goes through `redact()` and gets truncated
 * before it is allowed anywhere near a message.
 */
async function detail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.text()).trim();
    if (!body) return undefined;
    return redact(body).replace(/\s+/g, ' ').slice(0, 200);
  } catch {
    return undefined;
  }
}

/**
 * Make the live call for `provider` with `key`.
 *
 * Never throws: a validator that crashes an offline machine would violate the
 * zero-key, zero-network guarantee. Everything becomes a `ValidationResult`.
 */
export function probeKey(provider: Provider, key: string): Promise<ValidationResult> {
  return withSecretRedaction([key], () => runProbe(provider, key));
}
async function runProbe(provider: Provider, key: string): Promise<ValidationResult> {
  const probe = PROBES[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(probe.url, {
      ...probe.init(key),
      redirect: 'error',
      signal: controller.signal,
    });
    const { ok, reason } = classify(res.status);
    const message = ok ? undefined : await detail(res);
    // Only 'network' and 'server-error' are indefinite: they say nothing about
    // the key, so they must not overwrite a previously recorded verdict.
    const definitive = reason === 'accepted' || reason === 'rejected';
    return {
      provider,
      ok,
      reason,
      status: res.status,
      message,
      checkedAt: definitive ? new Date().toISOString() : undefined,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    log.debug(`${provider} validation could not reach the provider`);
    return {
      provider,
      ok: false,
      reason: 'network',
      message: aborted ? `no response within ${TIMEOUT_MS}ms` : 'Could not reach the provider',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One-line, safe-to-print summary of a result. */
export function describeValidation(r: ValidationResult): string {
  const where = r.source ? ` (from ${r.source})` : '';
  switch (r.reason) {
    case 'not-configured':
      return `${r.provider}: no key configured`;
    case 'accepted':
      return `${r.provider}: key accepted${where}`;
    case 'rate-limited':
      return `${r.provider}: check rate limited${where} — try again; the key was not verified`;
    case 'rejected':
      return `${r.provider}: key rejected${where} — ${r.message ?? 'HTTP 401'}`;
    case 'forbidden':
      return `${r.provider}: metadata check refused${where}; check permissions — ${r.message ?? 'HTTP 403'}`;
    case 'server-error':
      return `${r.provider}: provider returned ${r.status ?? '5xx'} — try again later, this says nothing about the key`;
    case 'network':
      return `${r.provider}: could not reach the provider — ${r.message ?? 'network error'}`;
    default:
      return `${r.provider}: unexpected HTTP ${r.status ?? '?'} — ${r.message ?? 'no detail'}`;
  }
}
