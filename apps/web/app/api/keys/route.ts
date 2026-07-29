/**
 * `/api/keys` — list, set and delete the provider credentials.
 *
 * **This is the most security-sensitive file in the repository.** The invariants
 * below are not style preferences; breaking any one of them leaks a credential.
 *
 *  1. **A raw key only ever travels inbound.** It arrives in a POST body, goes
 *     straight into the vault, and the handler returns a masked status derived
 *     from `keyStatuses()`. There is no code path from any method here to a
 *     plaintext key in a response — `GET` never even unseals one, because the
 *     mask is stored in plaintext beside the ciphertext.
 *  2. **Nothing is logged.** These handlers deliberately do not use
 *     `unexpected()` from `_lib/http`: it calls `console.error(err)` with the
 *     whole error, and an error thrown while a key is in scope can carry that key
 *     in a message or a `cause`. Failures here are logged as one scrubbed line.
 *  3. **Every outbound string is scrubbed.** `scrub()` removes the key we are
 *     holding and anything else shaped like a credential, so a message can be
 *     forwarded to the browser without anyone auditing it by eye.
 *  4. **No caching, ever.** `_lib/http`'s `json()` sets `no-store`, and the route
 *     is `force-dynamic`. A cached key list is a key list served to the next
 *     person on this port.
 *
 * The key never reaches the client bundle either: the settings page is a server
 * component that renders a client panel with no props, and the panel fetches
 * these endpoints at runtime. Nothing about a key is ever serialised into HTML.
 */

import { z } from 'zod';

import { badRequest, fail, json } from '../_lib/http';
import { PROVIDER_IDS, judgeKeyShape, providerInfo } from '@/components/settings/catalog';
import { deleteKey, keyStatuses, saveKey, scrub, vaultInfo } from './_store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 8 KB. The longest key any of the four providers issues is around 200
 * characters; the ceiling exists so a runaway paste (or a probe) is refused by
 * the schema rather than sealed and written to disk.
 */
const MAX_KEY_CHARS = 8192;

const ProviderParam = z.enum(PROVIDER_IDS);

const SetBody = z
  .object({
    provider: ProviderParam,
    /**
     * Not `.trim()`ed by zod but by us, after the length check — trimming first
     * would let a 1 MB body of spaces pass a `max()` on the trimmed value.
     */
    key: z.string().min(1, 'paste the key').max(MAX_KEY_CHARS, 'that is far too long to be a key'),
  })
  .strict();

const DeleteQuery = z.object({ provider: ProviderParam }).strict();

/* --------------------------------------------------------------------- GET */

/** The four providers, their status, and where the vault lives. Masks only. */
export async function GET() {
  try {
    const keys = await keyStatuses();
    return json({ keys, vault: vaultInfo() });
  } catch (err) {
    return oops('list', err);
  }
}

/* -------------------------------------------------------------------- POST */

export async function POST(request: Request) {
  let key = '';
  try {
    const body = await readJson(request);
    if (!body.ok) return body.response;

    const provider = body.data.provider;
    key = body.data.key.trim();

    const shape = judgeKeyShape(provider, key);
    if (!shape.ok) {
      // A refusal quotes the *problem*, never the input.
      return badRequest(shape.problem);
    }

    const status = await saveKey(provider, key);
    return json({
      ok: true,
      key: status,
      /** Saved, but the shape is unusual — validate it to be sure. */
      ...(shape.warning === undefined ? {} : { warning: shape.warning }),
      /** What changes now that this is set. */
      note: `${providerInfo(provider).label} is set for this machine. It ${providerInfo(provider).role.toLowerCase()} from the next render on.`,
    });
  } catch (err) {
    return oops('save', err, key);
  } finally {
    // Not a security control on its own — V8 owns the string — but it does stop
    // the value being captured by a closure or a later stack frame.
    key = '';
  }
}

/* ------------------------------------------------------------------ DELETE */

/**
 * The provider arrives as a query parameter rather than a body.
 *
 * `fetch` can send a body with DELETE, but proxies and service workers are
 * allowed to drop it, and a delete that silently targets nothing is a bad failure
 * mode for a destructive verb.
 */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = DeleteQuery.safeParse({
      provider: url.searchParams.get('provider') ?? undefined,
    });
    if (!parsed.success) {
      return badRequest(`delete needs ?provider=<${PROVIDER_IDS.join('|')}>`);
    }

    const outcome = await deleteKey(parsed.data.provider);
    const info = providerInfo(parsed.data.provider);
    return json({
      ok: true,
      removed: outcome.removed,
      stillFromEnv: outcome.stillFromEnv,
      key: outcome.status,
      note: outcome.stillFromEnv
        ? `Removed from the vault, but ${info.envVar} is still set in the environment, so ${info.label} keeps being used. Remove it from your .env or shell to stop that.`
        : outcome.removed
          ? `${info.label} is no longer configured. ${info.without}`
          : `There was nothing saved for ${info.label}.`,
    });
  } catch (err) {
    return oops('delete', err);
  }
}

/* ------------------------------------------------------------------ helpers */

type Read =
  | { ok: true; data: z.infer<typeof SetBody> }
  | { ok: false; response: ReturnType<typeof badRequest> };

/**
 * Read the body ourselves instead of using `parseJsonBody`.
 *
 * That helper is right for every other route, and wrong for this one: on a schema
 * failure it returns `issueLines()`, which prints the offending value's path and
 * lets a zod message quote input. Here the only safe response is a fixed sentence.
 */
async function readJson(request: Request): Promise<Read> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: badRequest('could not read the request body') };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: badRequest('the request body is not valid JSON') };
  }
  const parsed = SetBody.safeParse(raw);
  if (!parsed.success) {
    // **Field names only.** A zod message quotes the offending value
    // (`received 'sk-ant-…'`), so `issue.message` must never be forwarded from
    // this route. `issue.path` is a key name we defined, so it is safe.
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'body')),
    ].slice(0, 4);
    return {
      ok: false,
      response: badRequest(
        `the request body must be { provider, key } with provider one of ${PROVIDER_IDS.join(', ')}`,
        fields.map((field) => `${field} is missing or not acceptable`),
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * The only failure path. Logs one scrubbed line — no error object, no `cause`
 * chain, no body — and returns the same scrubbed sentence.
 */
function oops(what: string, err: unknown, secret?: string) {
  const message = scrub(
    err instanceof Error ? err.message : 'unknown failure',
    secret === undefined ? [] : [secret],
  );
  console.error(`[api:keys] ${what} failed: ${message}`);
  return fail(500, `Could not ${what} the key: ${message}`);
}
