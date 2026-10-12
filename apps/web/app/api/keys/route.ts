import { accountKeys } from '../_lib/deployment';
import { guardRequest, readCredentialBody } from '../_lib/request-guard';
/**
 * `/api/keys` — list, set and delete the provider credentials.
 *
 * **This is the most security-sensitive file in the repository.** The invariants
 * below are not style preferences; breaking any one of them leaks a credential.
 *
 *  1. **A raw key only ever travels inbound.** It arrives in a POST body, goes
 *     straight into the vault, and the handler returns a masked status derived
 *     from `keyStatuses()`. There is no code path from any method here to a
 *     plaintext key in a response. GET opens stored records to verify readability,
 *     but returns only their masked status.
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
 *
 *  5. **Two stores, chosen by deployment, and never both.** `INKCAST_HOSTED=1`
 *     switches every handler to the per-account store in `_lib/secrets.ts`;
 *     locally they use `@inkcast/keyvault` through `_store.ts` exactly as before.
 *     The two must not be reachable from one another, because on a hosted box the
 *     keychain/vault holds the *operator's* credentials — the ones paying for
 *     every visitor's film — and a fall-through would let a stranger list,
 *     overwrite or delete them. That is not hypothetical: these endpoints were
 *     once live and unguarded on the hosted box while `/settings` had already
 *     stopped rendering the panel, which is precisely why it was easy to miss —
 *     the door was closed in the UI and left open in the API, and an unlinked
 *     endpoint is not a private one. So the local store is now loaded with a
 *     **lazy import inside the local branch**: on a hosted box `_store.ts` is
 *     never imported at all, and "a hosted request cannot reach the operator's
 *     keychain" is a property of the module graph rather than of an `if`.
 *
 *  6. **Hosted requests are per-account, and identity decides before anything
 *     else does.** `accountOwner()` resolves the caller through the one identity
 *     module, refuses a signed-out caller when Clerk is configured, and yields
 *     only a keyed digest of that identity. Every read and write below is
 *     addressed by that digest, and the digest is bound into the AEAD that seals
 *     the record — so one account's key does not decrypt for another even if a
 *     bug or a hand-edited file puts the bytes in the wrong place. The guard runs
 *     above `readJson`, so an unauthenticated hosted request never has a key
 *     parsed out of its body.
 */

import { z } from 'zod';

import { badRequest, fail, isHosted, json } from '../_lib/http';
import { blobStorage } from '@/lib/store';
import { PROVIDER_IDS, judgeKeyShape, providerInfo } from '@/components/settings/catalog';
import {
  accountKeyStatuses,
  accountOwner,
  accountVaultInfo,
  deleteAccountKey,
  saveAccountKey,
  withAccountCookie,
} from './_account.js';
import { scrub } from './_wire.js';

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

/**
 * The local store, loaded only on a local box. See invariant 5.
 *
 * The same lazy-workspace-import shape `lib/store.ts` uses for the pipeline: the
 * cost is one `await` on a path that is already async, and the benefit is that the
 * module able to read the operator's keychain is absent from the module graph of
 * every hosted request.
 */
function localStore() {
  return import('./_store.js');
}

/* --------------------------------------------------------------------- GET */

/** The four providers, their status, and what protects them. Masks only. */
export async function GET(request: Request) {
  const refused = guardRequest(request, true);
  if (refused) return refused;
  try {
    if (accountKeys()) {
      const who = await accountOwner(request);
      if (!who.ok) return who.response;
      const keys = await accountKeyStatuses(who.owner);
      return withAccountCookie(json({ keys, vault: accountVaultInfo() }), who.owner);
    }
    const { keyStatuses, vaultInfo } = await localStore();
    const keys = await keyStatuses();
    return json({ keys, vault: vaultInfo() });
  } catch (err) {
    return oops('list', err);
  }
}

/* -------------------------------------------------------------------- POST */

export async function POST(request: Request) {
  const refused = guardRequest(request, true);
  if (refused) return refused;
  let key = '';
  try {
    if (blobStorage() && !accountKeys()) return keysAreServerSide();
    // Identity first, and above `readJson`: a request that may not store a key
    // must not have one parsed out of its body, let alone sealed and written.
    const who = accountKeys() ? await accountOwner(request) : undefined;
    if (who !== undefined && !who.ok) return who.response;

    const body = await readJson(request);
    if (!body.ok) return body.response;

    const provider = body.data.provider;
    key = body.data.key.trim();

    const shape = judgeKeyShape(provider, key);
    if (!shape.ok) {
      // A refusal quotes the *problem*, never the input.
      return badRequest(shape.problem);
    }
    const info = providerInfo(provider);

    if (who !== undefined && who.ok) {
      const status = await saveAccountKey(who.owner, provider, key);
      return withAccountCookie(
        json({
          ok: true,
          key: status,
          ...(shape.warning === undefined ? {} : { warning: shape.warning }),
          note: `${info.label} is set for your account. It is stored encrypted, it is never shown again, and it is available only to requests authenticated as your account. Select it in the studio to use it.`,
        }),
        who.owner,
      );
    }

    const { saveKey } = await localStore();
    const status = await saveKey(provider, key);
    return json({
      ok: true,
      key: status,
      /** Saved, but the shape is unusual — validate it to be sure. */
      ...(shape.warning === undefined ? {} : { warning: shape.warning }),
      /** What changes now that this is set. */
      note: `${info.label} is set for this machine. It ${info.role.toLowerCase()} from the next render on.`,
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
  const refused = guardRequest(request, true);
  if (refused) return refused;
  try {
    if (blobStorage() && !accountKeys()) return keysAreServerSide();
    const who = accountKeys() ? await accountOwner(request) : undefined;
    if (who !== undefined && !who.ok) return who.response;

    const url = new URL(request.url);
    const parsed = DeleteQuery.safeParse({
      provider: url.searchParams.get('provider') ?? undefined,
    });
    if (!parsed.success) {
      return badRequest(`delete needs ?provider=<${PROVIDER_IDS.join('|')}>`);
    }
    const info = providerInfo(parsed.data.provider);

    if (who !== undefined && who.ok) {
      const outcome = await deleteAccountKey(who.owner, parsed.data.provider);
      return withAccountCookie(
        json({
          ok: true,
          removed: outcome.removed,
          /**
           * Always false on this path, and that is the honest answer rather than a
           * shortcut. `stillFromEnv` exists to tell someone that a variable *they*
           * set is overriding the entry they just deleted. On the hosted box the
           * only environment is the operator's, which the user did not set and
           * cannot unset, so reporting it would be telling them to edit a `.env`
           * they will never see.
           */
          stillFromEnv: false,
          key: outcome.status,
          note: outcome.removed
            ? `${info.label} is no longer stored for your account. ${info.without}`
            : `There was nothing saved for ${info.label}.`,
        }),
        who.owner,
      );
    }

    const { deleteKey } = await localStore();
    const outcome = await deleteKey(parsed.data.provider);
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

type Read = { ok: true; data: z.infer<typeof SetBody> } | { ok: false; response: Response };

/**
 * Read the body ourselves instead of using `parseJsonBody`.
 *
 * That helper is right for every other route, and wrong for this one: on a schema
 * failure it returns `issueLines()`, which prints the offending value's path and
 * lets a zod message quote input. Here the only safe response is a fixed sentence.
 */
async function readJson(request: Request): Promise<Read> {
  const read = await readCredentialBody(request);
  if (!read.ok) return read;
  const raw = read.data;
  const parsed = SetBody.safeParse(raw);
  if (!parsed.success) {
    // **Field names only.** A zod message quotes the offending value
    // (`received 'sk-ant-…'`), so `issue.message` must never be forwarded from
    // this route. `issue.path` is a key name we defined, so it is safe.
    return {
      ok: false,
      response: badRequest(
        `the request body must be { provider, key } with provider one of ${PROVIDER_IDS.join(', ')}`,
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

/**
 * A Blob-storage (stateless) deployment without accounts has nowhere durable for
 * the operator's vault: `@inkcast/keyvault` writes the keychain or
 * `~/.inkcast/vault.json`, and a Function's filesystem does not outlive the
 * instance, so a saved key would be accepted and then silently lost. Account keys
 * (`INKCAST_HOSTED=1` or Clerk) are different — `_lib/secrets.ts` keeps their
 * sealed records in Blob — so only this combination is refused. The operator's
 * keys then come from the project environment.
 */
function keysAreServerSide() {
  return fail(
    501,
    'This deployment does not store API keys without accounts. Set provider keys in the server environment instead.',
  );
}
