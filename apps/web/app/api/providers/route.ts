/**
 * `GET /api/providers` — what this machine can currently do, and what it cannot.
 *
 * The whole project's promise is that it runs with zero API keys, so the studio
 * should be able to *show* that rather than assert it. The provider table is read
 * straight from the pipeline's own decision function, so this endpoint and
 * `inkcast providers` can never disagree.
 *
 * It carries three things beyond that table, each of which exists because the
 * studio has to make a decision the browser cannot make for itself:
 *
 *  - `keys` — masked key status, so the create form can warn *before* a render
 *    that the output will be a summary rather than a lesson.
 *  - `warnings` — the degradations in plain language, ordered by how much they
 *    cost the finished video.
 *  - `accepts` — the exact `meta` field names `POST /api/generate` will validate,
 *    read from its schema. The create form sends only fields that appear here, so
 *    a client that has learned about a new option cannot 400 against a server
 *    that has not. See `lib/api.ts`.
 *  - `styles` — the ink packs in `styles/`, read from the loader rather than
 *    mirrored (plan 9.4, audit X-f). A style stopped being an enum in 7.3 and
 *    became a JSON file, but the studio's picker kept a four-name literal because
 *    the loader reads the filesystem and cannot be bundled for a browser — so a
 *    pack a user dropped into `styles/` worked through the CLI and the API and
 *    was invisible in the one surface most people use. This is the same shape as
 *    the three fields above and for the same reason: the browser cannot answer a
 *    question about the box, so the box answers it.
 *
 * Hydrating the vault here is load-bearing, not incidental: this is the endpoint
 * the create form calls before any render, so it is the point at which a key
 * saved on the settings page — or by `inkcast keys set`, since both now use the
 * same vault — becomes visible to the stages. See `app/api/keys/_store.ts`.
 *
 * ## Whose keys this reports, and why that had to change
 *
 * This route is unauthenticated and has to stay that way: the create form calls
 * it before a session has made anything, and its own `accepts` list is what stops
 * a newer studio 400ing against an older server. Everything it returns is
 * therefore public on a shared deployment.
 *
 * Until this paragraph existed it returned `keyStatuses()` — the *operator's*
 * vault, masked. Two things were wrong with that and neither is theoretical.
 * First, a mask is not nothing: `maskSecret` in `components/settings/catalog.ts`
 * keeps the provider prefix and some characters of the key, so an anonymous `curl
 * /api/providers` against inkcast.video was reading fragments of live credentials
 * belonging to whoever runs the box. Second, it became a lie the moment per-user
 * BYOK landed (`app/api/_lib/secrets.ts`): a signed-in visitor with no key of
 * their own saw four configured providers and concluded they were theirs.
 *
 * So on the hosted path `keys` is now the *caller's own* account status — theirs
 * to see, and empty when they are signed out — and the operator's vault is not
 * read at all. `providers`/`local`/`warnings` still describe what a render on this
 * box would actually do, because that is a fact about the film the visitor is
 * about to get rather than a fact about somebody's credentials, and the create
 * form needs it to warn honestly before spending two minutes.
 *
 * The import of `_store.ts` is lazy and inside the local branch for the same
 * reason `app/api/keys/route.ts` made its own lazy: on a hosted box the module
 * that can read the operator's keychain is then absent from the module graph
 * entirely, so "an anonymous request cannot reach the operator's vault" is a
 * property of what is loaded rather than of an `if` somebody may later move. That
 * guard was already in place on `/api/keys` while this route still imported the
 * module at the top level, which made the guarantee true of one door and not the
 * other — the exact `/settings`-vs-`/api/keys` shape recorded in `_lib/http.ts`.
 */

import { isHosted, json, unexpected } from '../_lib/http';
import { META_KEYS } from '../_lib/schemas';
import { STUDIO_PRESETS } from '@/lib/jobs';
import { loadCore, loadPipeline } from '@/lib/store';
import { PROVIDERS, STAGE_LABEL, type ProviderStage } from '@/components/settings/catalog';
import type { KeyStatus } from '../keys/_store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const hosted = isHosted();
    const keys = hosted ? await callersKeys(request) : await operatorKeys();

    const { providers, fullyLocal } = await loadPipeline();
    const chosen = providers();

    return json({
      providers: chosen,
      /** True when nothing in a run leaves this machine and nothing can be billed. */
      local: fullyLocal(chosen),
      /**
       * Where films are written — locally, and `null` on the shared deployment.
       *
       * This route is unauthenticated (it has to be: the create form calls it
       * before a session has made anything), so on the hosted box every field
       * here is public. An absolute filesystem path is a free map of the
       * container for anyone probing the other end of `/api/media/<id>/<path…>`,
       * and nothing in the studio reads this field — `lib/api.ts` parses the
       * response and does not so much as name it, and the contract comment at the
       * top of that file lists the five keys it does use. So hosted pays nothing
       * for the redaction, while locally the value stays visible because the one
       * person who can see it is the person who set `INKCAST_PROJECTS` and needs
       * to confirm which directory the dev server actually picked up.
       */
      projectsDir: hosted ? null : (process.env.INKCAST_PROJECTS ?? null),
      keys,
      /** Which key each stage would need to reach its better path. */
      needs: {
        plan: 'anthropic',
        voice: 'elevenlabs',
        images: keys.find((k) => k.id === 'replicate')?.configured ? 'replicate' : 'fal',
      } satisfies Record<ProviderStage, string>,
      /**
       * Derived from the *provider selection*, not from `keys`, and on the hosted
       * box those are two different facts.
       *
       * `keys` is now whose credentials the caller has stored, which on hosted is
       * usually none. `chosen` is what the render will actually do, because
       * `providers()` reads the same `process.env` every stage adapter reads. Wire
       * the first into the warnings and a visitor on a box with fully funded
       * server keys is told their video will "summarise rather than teach" —
       * false, and false in the direction that talks somebody out of a render
       * that would have worked.
       *
       * This is the mirror of the bug above it. Reporting the operator's masked
       * keys was a disclosure; reporting the caller's keys as though they drove
       * the pipeline was a lie. The fix for both is the same: say which fact you
       * are answering. `keys` answers "what have I saved", `warnings` answers
       * "what will this film be like".
       */
      warnings: warningsFor(chosen, keys, hosted),
      /** `meta` fields this build's generate endpoint validates. */
      accepts: META_KEYS,
      /**
       * The film shapes this build's generate endpoint will accept as `preset`.
       *
       * A separate list from `accepts` because `preset` is not a `meta` field: it
       * is the *format* — how long the film runs and what the board does between
       * beats — and it sits beside `meta` in `GenerateFields` rather than inside
       * it. Advertised for the same reason `accepts` is: the schema is `.strict()`,
       * so a studio that knows about an option must be able to tell whether the
       * server does before it sends one, or a newer picker turns into a 400 that
       * takes the user's aspect, ink and voice down with it.
       */
      formats: [...STUDIO_PRESETS],
      /**
       * The ink packs this tree can actually draw with, each with the name and
       * description the pack itself carries.
       *
       * Read from the loader, so it cannot drift from what `parseStoryboard` will
       * accept: the picker's old literal was a fifth copy of a list that stopped
       * being a list in 7.3. Nothing sensitive — a pack is a JSON file of stroke
       * numbers, and its id is already in every `storyboard.json` this box serves.
       */
      styles: await inkStyles(),
    });
  } catch (err) {
    return unexpected('providers', err);
  }
}

/**
 * The packs in `styles/`, sorted by id the way `styleIds()` sorts them.
 *
 * `stylePacks()` memoises and reads the filesystem once, so this costs nothing after
 * the first call — and `loadCore()` is the same lazy import the rest of this app uses
 * to keep workspace modules out of the module graph until the environment is set.
 *
 * A failure here must not take the route down: everything else it returns is about
 * whether a render will work, and a picker falling back to its built-in four is a much
 * smaller problem than a create form that cannot load at all.
 */
async function inkStyles(): Promise<Array<{ id: string; label: string; hint: string }>> {
  try {
    const { stylePacks } = await loadCore();
    return [...stylePacks().values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((pack) => ({ id: pack.id, label: pack.name, hint: pack.description }));
  } catch {
    return [];
  }
}

/**
 * Local: the operator's own vault, hydrated first so a key saved on the settings
 * page is visible to the stages from here on. Loaded lazily so that this module
 * never reaches `@inkcast/keyvault` on a hosted box — see the header.
 *
 * The one person who can read this response locally is the person who set the
 * keys, so a mask is theirs by definition.
 */
async function operatorKeys(): Promise<KeyStatus[]> {
  const { hydrateEnv, keyStatuses } = await import('../keys/_store.js');
  await hydrateEnv();
  return keyStatuses();
}

/**
 * Hosted: the caller's own stored keys, or none.
 *
 * `accountOwner` is the same guard `/api/keys` uses, so there is one answer to
 * "whose keys are these" on the hosted path rather than two. Its refusal is
 * *swallowed* here rather than returned, which is the one place this route
 * deliberately differs from that one: a 401 would break the create form for a
 * signed-out visitor reading the landing page's capability copy, and the honest
 * answer to "what keys do you have" from somebody with no account is an empty
 * list, not an error. Nothing is disclosed by answering — an empty array is what
 * a signed-in visitor with no keys gets too.
 */
async function callersKeys(request: Request): Promise<KeyStatus[]> {
  // Lazy for a second reason, on top of the module-graph argument in the header:
  // `_account.ts` imports `_lib/secrets.ts`, which *throws at import* when
  // `INKCAST_HOSTED=1` and `INKCAST_SECRET_KEY` is unset. That check is right
  // where it lives — a box that cannot encrypt a visitor's credential must not
  // serve the endpoint that accepts one — but importing it at the top of this file
  // would extend it to here, and this is the endpoint the create form calls on
  // every visit to the studio. The result would be that a private team box running
  // `INKCAST_HOSTED=1` with server-funded keys and no BYOK at all — a supported
  // configuration, see docs/AUTH.md — could not render the studio until it
  // invented a master key it had no use for. Behind the branch, the loud failure
  // stays attached to `/api/keys`, which is the door it is guarding.
  const { accountKeyStatuses, accountOwner } = await import('../keys/_account.js');
  const who = await accountOwner(request);
  if (!who.ok) return [];
  return accountKeyStatuses(who.owner);
}

/**
 * The degradations, worst first.
 *
 * Ordered by effect on the finished video rather than by pipeline order, because
 * the list is advice: a reader who fixes only the first item should have fixed the
 * thing that mattered most. Planning is first by a wide margin — it decides
 * whether the video teaches at all, while the other two decide how it looks and
 * sounds while doing it.
 *
 * Two of these sentences are advice to the *operator* rather than to the viewer,
 * and `hosted` is what separates the two audiences. On the shared deployment the
 * reader of this list is an anonymous visitor who cannot set an environment
 * variable, cannot re-paste a key and did not configure the vault — so telling
 * them to is noise at best, and at worst it names the exact variables holding
 * live credentials on a box they do not administer. The degradation warnings
 * above stay in both modes, because those describe the film they are about to get
 * and that is their business either way.
 *
 * ## The first three read `chosen`, not `keys`
 *
 * They used to be derived from key status, which was the same fact by accident
 * for as long as there was only one set of keys on a box. Per-account BYOK ended
 * that: `keys` is now "what has the caller saved", which on the hosted box is
 * usually nothing, while the render still runs on the operator's server keys. A
 * degradation list built from `keys` therefore told a visitor their video would
 * "summarise rather than teach" immediately before handing them a full lesson.
 *
 * `chosen` cannot drift from the render, because `providers()` reads the same
 * `process.env` every stage adapter reads — and `cloud` is exactly the question
 * being asked here, so the test is `!cloud` rather than a provider name. That
 * also means these three sentences stop depending on the pipeline's spelling of
 * `anthropic`/`elevenlabs`/`fal`, which is a coupling they never needed.
 */
function warningsFor(
  chosen: { planner: { cloud: boolean }; voice: { cloud: boolean }; images: { cloud: boolean } },
  keys: readonly KeyStatus[],
  hosted: boolean,
): string[] {
  const out: string[] = [];

  if (!chosen.planner.cloud) {
    out.push(
      'No Anthropic key: the local planner splits the document into beats instead of building a lesson, so the video will summarise rather than teach.',
    );
  }
  if (!chosen.voice.cloud) {
    out.push(
      'No ElevenLabs key: narration is synthesised locally in English only, and there are no word-level timings to land visuals on.',
    );
  }
  if (!chosen.images.cloud) {
    out.push(
      'No Replicate or fal key: illustrations come from the built-in icon set, so there are no drawn objects, characters or scenes.',
    );
  }

  // Everything below is operator advice; see the header. Hosted stops here.
  if (hosted) return out;

  for (const key of keys) {
    if (key.unreadable) {
      const label = PROVIDERS.find((p) => p.id === key.id)?.label ?? key.id;
      // Two different faults with two different fixes, so they get two different
      // sentences. Telling someone to re-paste a key when the real problem is an
      // unset passphrase makes them destroy a perfectly good entry.
      out.push(
        key.locked
          ? `The stored ${label} key cannot be unsealed — no vault passphrase is available, so that stage is running locally. Set INKCAST_VAULT_PASSPHRASE and restart the studio; the key itself is intact.`
          : `The stored ${label} key can no longer be decrypted, so that stage is running locally. Paste it again in settings.`,
      );
    }
    if (key.shadowedByEnv) {
      out.push(
        `The stored ${STAGE_LABEL[stageOf(key.id)].toLowerCase()} key cannot be read right now, so ${key.envVar} from the environment is in use.`,
      );
    }
    if (key.overridesEnv) {
      out.push(
        `${key.envVar} is also set in the environment, but the ${STAGE_LABEL[stageOf(key.id)].toLowerCase()} key you saved takes priority.`,
      );
    }
  }

  return out;
}

function stageOf(id: KeyStatus['id']): ProviderStage {
  return PROVIDERS.find((p) => p.id === id)?.stage ?? 'plan';
}
