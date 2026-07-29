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
 */

import { z } from 'zod';

import { badRequest, fail, json } from '../../_lib/http';
import { PROVIDER_IDS, judgeKeyShape, providerInfo } from '@/components/settings/catalog';
import { scrub } from '../_vault/crypto.js';
import { effectiveKey } from '../_vault/index.js';
import { validateKey } from '../_vault/validate.js';

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
 * One check per provider per second.
 *
 * Validation makes an outbound authenticated request, so an accidental render
 * loop or a held-down Enter key must not turn into a burst against a provider's
 * rate limiter. Per-process and deliberately crude: this is a local studio, not a
 * multi-tenant service, and a real limiter would be more machinery than the
 * problem deserves.
 */
const lastCheck = new Map<string, number>();
const MIN_GAP_MS = 1000;

export async function POST(request: Request) {
  let key = '';
  try {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const { provider } = parsed.data;
    const info = providerInfo(provider);

    const now = Date.now();
    const previous = lastCheck.get(provider) ?? 0;
    if (now - previous < MIN_GAP_MS) {
      return fail(429, 'Give it a second — that check is already on its way.');
    }
    lastCheck.set(provider, now);

    /* ---------------------------------------------- which key are we checking */

    let source: 'body' | 'env' | 'vault';
    if (parsed.data.key !== undefined) {
      key = parsed.data.key.trim();
      const shape = judgeKeyShape(provider, key);
      if (!shape.ok) return badRequest(shape.problem);
      source = 'body';
    } else {
      const found = await effectiveKey(provider);
      if (!found.ok) {
        return json({
          result: {
            status: 'unknown' as const,
            message:
              found.reason === 'unreadable'
                ? `A ${info.label} key is saved but can no longer be decrypted, so there is nothing to check. Paste it again.`
                : `No ${info.label} key is configured, so there is nothing to check.`,
          },
        });
      }
      key = found.key;
      source = found.source === 'env' ? 'env' : 'vault';
    }

    const result = await validateKey(provider, key);
    return json({
      result: {
        ...result,
        message: scrub(result.message, [key]),
        ...(result.detail === undefined ? {} : { detail: scrub(result.detail, [key]) }),
      },
      /** Which key was checked, so the UI can say so without guessing. */
      checked: source,
    });
  } catch (err) {
    const message = scrub(err instanceof Error ? err.message : 'unknown failure', [key]);
    console.error(`[api:keys] validate failed: ${message}`);
    return fail(500, `Could not run the check: ${message}`);
  } finally {
    key = '';
  }
}

type Read =
  { ok: true; data: z.infer<typeof Body> } | { ok: false; response: ReturnType<typeof badRequest> };

async function readBody(request: Request): Promise<Read> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: badRequest('could not read the request body') };
  }
  let raw: unknown;
  try {
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    return { ok: false, response: badRequest('the request body is not valid JSON') };
  }
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
