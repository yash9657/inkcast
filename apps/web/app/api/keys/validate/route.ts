import { accountKeys } from '../../_lib/deployment';
import { guardRequest, readCredentialBody } from '../../_lib/request-guard';
/**
 * `POST /api/keys/validate` — ask the provider whether a key works, right now.
 *
 * Two modes, and the difference matters:
 *
 *  - `{ provider }` validates the key the pipeline would actually use, whether it
 *    came from the vault or from the environment. This is the one that answers
 *    "is my setup working".
 *  - `{ provider, key }` validates a key that has *not* been saved, so a paste can
 *    be checked before it is committed. The key is used for one outbound request
 *    and never written anywhere.
 *
 * Same secrecy rules as `../route.ts`: the key travels inbound only, every
 * outbound string is scrubbed, and nothing is logged but a fixed line. A verdict
 * of `unknown` is a real answer here — see `_vault/validate.ts` for why.
 *
 * And the same two-store split, with one extra rule of its own: on the hosted box
 * the second mode checks **the caller's own stored key and nothing else**. It never
 * falls back to the operator's environment or vault. A fallback there would let any
 * visitor confirm the operator's Anthropic key is live — and spend a request of the
 * operator's quota to do it — which is a small leak of a large secret.
 */

import { z } from 'zod';

import { badRequest, fail, isHosted, json } from '../../_lib/http';
import { PROVIDER_IDS, judgeKeyShape, providerInfo } from '@/components/settings/catalog';
import {
  accountKeyPlaintext,
  accountOwner,
  recordAccountValidation,
  validateAccountKey,
  withAccountCookie,
  type AccountOwner,
} from '../_account.js';
import { scrub } from '../_wire.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_KEY_CHARS = 8192;

const Body = z
  .object({
    provider: z.enum(PROVIDER_IDS),
    /** Absent means "check the one that is configured". */
    key: z.string().min(1).max(MAX_KEY_CHARS).optional(),
  })
  .strict();

/**
 * One check per caller per provider per second.
 *
 * Validation makes an outbound authenticated request, so an accidental render loop
 * or a held-down Enter key must not turn into a burst against a provider's rate
 * limiter. The bucket is keyed by *owner* and provider on the hosted box, which is
 * the whole difference between a local studio and a shared one: a map keyed by
 * provider alone lets one visitor holding down Enter deny every other visitor a
 * check they are entitled to. Locally there is one owner and the key is the
 * provider, exactly as before.
 *
 * Per-process and deliberately crude — `_lib/ratelimit.ts` is the real limiter for
 * the expensive endpoint, and this is a debounce.
 */
const lastCheck = new Map<string, number>();
const MIN_GAP_MS = 1000;
/**
 * Bounded, because on a shared box the key space is now "however many accounts
 * ask", and an unbounded `Map` on a long-lived server is a slow leak. Pruning
 * expired entries is enough at this size; the clear is the backstop.
 */
const MAX_TRACKED = 5000;

function tooSoon(bucket: string): boolean {
  const now = Date.now();
  const previous = lastCheck.get(bucket) ?? 0;
  if (now - previous < MIN_GAP_MS) return true;
  if (lastCheck.size >= MAX_TRACKED) {
    for (const [seen, at] of lastCheck) if (now - at >= MIN_GAP_MS) lastCheck.delete(seen);
    if (lastCheck.size >= MAX_TRACKED) lastCheck.clear();
  }
  lastCheck.set(bucket, now);
  return false;
}

export async function POST(request: Request) {
  const refused = guardRequest(request, true);
  if (refused) return refused;
  let key = '';
  try {
    // Identity before the body, before the debounce, before any read: an
    // unauthenticated hosted request must not be able to consume another account's
    // rate budget or learn whether a provider is configured.
    const who = accountKeys() ? await accountOwner(request) : undefined;
    if (who !== undefined && !who.ok) return who.response;
    const owner: AccountOwner | undefined = who !== undefined && who.ok ? who.owner : undefined;

    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const { provider } = parsed.data;
    const info = providerInfo(provider);

    if (tooSoon(owner === undefined ? provider : `${owner.tag}|${provider}`)) {
      return fail(429, 'Give it a second — that check is already on its way.');
    }

    /* ---------------------------------------------- which key are we checking */

    let source: 'body' | 'env' | 'vault' | 'keychain';
    if (parsed.data.key !== undefined) {
      key = parsed.data.key.trim();
      const shape = judgeKeyShape(provider, key);
      if (!shape.ok) return badRequest(shape.problem);
      source = 'body';
    } else if (owner !== undefined) {
      // The caller's own stored key, addressed by their owner digest. A record
      // belonging to anyone else fails to decrypt rather than answering here.
      const stored = await accountKeyPlaintext(owner, provider);
      if (!stored.ok) {
        return withAccountCookie(
          json({
            result: {
              status: 'unknown' as const,
              message:
                stored.reason === 'unreadable'
                  ? `Your ${info.label} key is stored but can no longer be unsealed on this server, so there is nothing to check. Paste it again to replace it.`
                  : `You have no ${info.label} key stored, so there is nothing to check.`,
            },
          }),
          owner,
        );
      }
      key = stored.key;
      source = 'vault';
    } else {
      const { effectiveKey } = await import('../_store.js');
      const found = await effectiveKey(provider);
      if (!found.ok) {
        return json({
          result: {
            status: 'unknown' as const,
            message:
              found.reason === 'unreadable'
                ? `A ${info.label} key is stored but cannot be unsealed, so there is nothing to check. Settings says whether that needs a passphrase or a fresh paste.`
                : `No ${info.label} key is configured, so there is nothing to check.`,
          },
        });
      }
      key = found.key;
      // `none` is unreachable: `effectiveKey` only succeeds with a real source.
      source = found.source === 'none' ? 'vault' : found.source;
    }

    const result =
      owner === undefined
        ? await (await import('../_store.js')).validateKey(provider, key)
        : await validateAccountKey(provider, key);

    if (owner !== undefined && source === 'vault' && result.status !== 'unknown') {
      // Only a definitive verdict is recorded, and only for the stored key: an
      // `unknown` says nothing about the key (a 5xx, a train tunnel) and writing it
      // down would overwrite a real answer with a shrug.
      await recordAccountValidation(owner, provider, result.status === 'valid', process.env, key);
    }

    const body = json({
      result: {
        ...result,
        message: scrub(result.message, [key]),
        ...(result.detail === undefined ? {} : { detail: scrub(result.detail, [key]) }),
      },
      /** Which key was checked, so the UI can say so without guessing. */
      checked: source,
    });
    return owner === undefined ? body : withAccountCookie(body, owner);
  } catch (err) {
    const message = scrub(err instanceof Error ? err.message : 'unknown failure', [key]);
    console.error(`[api:keys] validate failed: ${message}`);
    return fail(500, `Could not run the check: ${message}`);
  } finally {
    key = '';
  }
}

type Read = { ok: true; data: z.infer<typeof Body> } | { ok: false; response: Response };

async function readBody(request: Request): Promise<Read> {
  const read = await readCredentialBody(request);
  if (!read.ok) return read;
  const raw = read.data;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequest(
        `the request body must be { provider, key? } with provider one of ${PROVIDER_IDS.join(', ')}`,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
