/**
 * Validate-now: ask the provider whether the key works.
 *
 * ## Three outcomes, not two
 *
 * A validator that only says yes or no is a liar, because "the request failed"
 * has two causes and they need opposite responses from the user. So:
 *
 *  - `valid`   — the provider answered and accepted the credential.
 *  - `invalid` — the provider answered and *rejected* it (401/403). Re-paste it.
 *  - `unknown` — we could not get an answer: offline, DNS, a timeout, a 500, or
 *                an endpoint that changed shape. The key is kept and used as-is.
 *
 * Collapsing `unknown` into `invalid` would tell someone on a train that their
 * perfectly good key is wrong, and they would delete it.
 *
 * ## Cost
 *
 * Every probe is a read-only endpoint that lists or describes the account. None
 * of them generate tokens, audio or images, so validating is free.
 *
 * ## Secrecy
 *
 * The key travels in a header, never a URL or a query string, so it cannot reach
 * a redirect log. `redirect: 'error'` refuses to follow a redirect at all, which
 * is what stops a hijacked hostname bouncing the credential somewhere else. Every
 * message returned from here goes through `scrub` with the key in hand.
 */

import { scrub } from './crypto.js';
import type { ProviderId } from '@/components/settings/catalog';

export type ValidationStatus = 'valid' | 'invalid' | 'unknown';

export type ValidationResult = {
  status: ValidationStatus;
  /** One sentence for the user. Already scrubbed. */
  message: string;
  /** What the provider told us about the account, when it told us anything. */
  detail?: string;
  /** HTTP status, when we got one. Useful in a bug report. */
  httpStatus?: number;
};

/** Long enough for a cold TLS handshake on hotel wifi, short enough to not hang. */
const TIMEOUT_MS = 12_000;

export async function validateKey(id: ProviderId, key: string): Promise<ValidationResult> {
  const trimmed = key.trim();
  if (trimmed === '') {
    return { status: 'unknown', message: 'There is no key to check.' };
  }
  try {
    switch (id) {
      case 'anthropic':
        return await checkAnthropic(trimmed);
      case 'elevenlabs':
        return await checkElevenLabs(trimmed);
      case 'replicate':
        return await checkReplicate(trimmed);
      case 'fal':
        return await checkFal(trimmed);
    }
  } catch (err) {
    return offline(err, trimmed);
  }
}

/* ---------------------------------------------------------------- transport */

async function probe(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * The shared shape of every check: 2xx is a yes, 401/403 is a no, and anything
 * else is honestly unknown.
 */
function judge(
  res: Response,
  provider: string,
  detail: string | undefined,
  secret: string,
): ValidationResult {
  if (res.ok) {
    return {
      status: 'valid',
      message: `${provider} accepted the key.`,
      ...(detail === undefined ? {} : { detail: scrub(detail, [secret]) }),
      httpStatus: res.status,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      status: 'invalid',
      message: `${provider} rejected the key. Copy it again from the dashboard — a key is only shown once, and a truncated paste fails exactly like this.`,
      httpStatus: res.status,
    };
  }
  if (res.status === 429) {
    return {
      status: 'unknown',
      message: `${provider} is rate-limiting this account, so the key could not be checked. It is saved and will be used.`,
      httpStatus: res.status,
    };
  }
  return {
    status: 'unknown',
    message: `${provider} answered ${res.status}, which is neither an acceptance nor a rejection. The key is saved and will be used.`,
    httpStatus: res.status,
  };
}

function offline(err: unknown, secret: string): ValidationResult {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const timedOut =
    err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  return {
    status: 'unknown',
    message: timedOut
      ? 'The provider did not answer within twelve seconds. The key is saved and will be used.'
      : 'Could not reach the provider from this machine. The key is saved and will be used.',
    detail: scrub(raw, [secret]),
  };
}

/**
 * Read a small JSON body without letting a huge or malformed one become the
 * failure. Returns `undefined` rather than throwing, because the body is only
 * ever used for the `detail` line — the verdict comes from the status code.
 */
async function smallJson(res: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const text = (await res.text()).slice(0, 4000);
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/* ------------------------------------------------------------------ probes */

/**
 * `GET /v1/models` — the cheapest authenticated call Anthropic has. It lists the
 * models this key may use, which is exactly what the planner needs to know, and
 * it consumes no tokens.
 */
async function checkAnthropic(key: string): Promise<ValidationResult> {
  const res = await probe('https://api.anthropic.com/v1/models?limit=20', {
    method: 'GET',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      accept: 'application/json',
    },
  });
  // Drained unconditionally: an unread body holds its socket open, and the
  // rejection path is the one that runs most often.
  const drained = await smallJson(res);
  const body = res.ok ? drained : undefined;
  const models = Array.isArray(body?.data) ? (body.data as unknown[]) : [];
  const names = models
    .map((m) => (m && typeof m === 'object' ? str((m as Record<string, unknown>).id) : undefined))
    .filter((v): v is string => v !== undefined);
  const detail =
    names.length > 0
      ? `${names.length} models available, including ${names.slice(0, 3).join(', ')}.`
      : undefined;
  return judge(res, 'Anthropic', detail, key);
}

/**
 * `GET /v1/user` returns the subscription, so the detail line can say what the
 * quota actually is — the thing a user wants to know at the moment they paste a
 * voice key.
 */
async function checkElevenLabs(key: string): Promise<ValidationResult> {
  const res = await probe('https://api.elevenlabs.io/v1/user', {
    method: 'GET',
    headers: { 'xi-api-key': key, accept: 'application/json' },
  });
  const drained = await smallJson(res);
  const body = res.ok ? drained : undefined;
  const sub =
    body?.subscription && typeof body.subscription === 'object'
      ? (body.subscription as Record<string, unknown>)
      : undefined;
  const tier = str(sub?.tier);
  const used = typeof sub?.character_count === 'number' ? sub.character_count : undefined;
  const limit = typeof sub?.character_limit === 'number' ? sub.character_limit : undefined;
  const parts: string[] = [];
  if (tier) parts.push(`${tier} plan`);
  if (used !== undefined && limit !== undefined) {
    parts.push(`${(limit - used).toLocaleString('en')} characters left this month`);
  }
  return judge(res, 'ElevenLabs', parts.length > 0 ? `${parts.join(' · ')}.` : undefined, key);
}

/** `GET /v1/account` identifies the account the token belongs to. Free. */
async function checkReplicate(key: string): Promise<ValidationResult> {
  const res = await probe('https://api.replicate.com/v1/account', {
    method: 'GET',
    headers: { authorization: `Token ${key}`, accept: 'application/json' },
  });
  const drained = await smallJson(res);
  const body = res.ok ? drained : undefined;
  const username = str(body?.username);
  const type = str(body?.type);
  const detail = username ? `Signed in as ${username}${type ? ` (${type})` : ''}.` : undefined;
  return judge(res, 'Replicate', detail, key);
}

/**
 * fal has no account endpoint, so the probe mints a short-lived scoped token
 * instead — the same call fal's own browser client makes. It costs nothing, it
 * expires in five minutes, and it is refused with a 401 for a bad key, which is
 * all the verdict needs.
 *
 * If that endpoint ever moves, this returns `unknown` rather than `invalid`, so
 * the failure mode is "we could not check" and not "your key is broken".
 */
async function checkFal(key: string): Promise<ValidationResult> {
  const res = await probe('https://rest.alpha.fal.ai/tokens/', {
    method: 'POST',
    headers: {
      authorization: `Key ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ allowed_apps: ['fal-ai/flux/schnell'], token_expiration: 300 }),
  });
  if (res.status === 404 || res.status === 405) {
    // Read and discard, so the socket is released rather than left dangling.
    await res.text().catch(() => '');
    return {
      status: 'unknown',
      message:
        'fal did not offer the endpoint this check uses, so the key could not be verified. It is saved and will be used.',
      httpStatus: res.status,
    };
  }
  // The response body is a signed token. It is a credential in its own right and
  // must not be read, echoed or logged, so the verdict comes from the status
  // alone and the body is drained without inspection.
  await res.text().catch(() => '');
  return judge(res, 'fal', undefined, key);
}
