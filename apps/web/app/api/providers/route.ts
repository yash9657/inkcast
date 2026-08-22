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
 *
 * Hydrating the vault here is load-bearing, not incidental: this is the endpoint
 * the create form calls before any render, so it is the point at which a key
 * saved on the settings page — or by `inkcast keys set`, since both now use the
 * same vault — becomes visible to the stages. See `app/api/keys/_store.ts`.
 */

import { isHosted, json, unexpected } from '../_lib/http';
import { META_KEYS } from '../_lib/schemas';
import { loadPipeline } from '@/lib/store';
import { PROVIDERS, STAGE_LABEL, type ProviderStage } from '@/components/settings/catalog';
import { hydrateEnv, keyStatuses, type KeyStatus } from '../keys/_store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Saved keys become environment variables before the pipeline reads them.
    await hydrateEnv();

    const { providers, fullyLocal } = await loadPipeline();
    const chosen = providers();
    const keys = await keyStatuses();
    const hosted = isHosted();

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
      warnings: warningsFor(keys, hosted),
      /** `meta` fields this build's generate endpoint validates. */
      accepts: META_KEYS,
    });
  } catch (err) {
    return unexpected('providers', err);
  }
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
 */
function warningsFor(keys: readonly KeyStatus[], hosted: boolean): string[] {
  const configured = new Set(keys.filter((k) => k.configured).map((k) => k.id));
  const out: string[] = [];

  if (!configured.has('anthropic')) {
    out.push(
      'No Anthropic key: the local planner splits the document into beats instead of building a lesson, so the video will summarise rather than teach.',
    );
  }
  if (!configured.has('elevenlabs')) {
    out.push(
      'No ElevenLabs key: narration is synthesised locally in English only, and there are no word-level timings to land visuals on.',
    );
  }
  if (!configured.has('replicate') && !configured.has('fal')) {
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
        `${key.envVar} is set in the environment, so the ${STAGE_LABEL[stageOf(key.id)].toLowerCase()} key saved in the vault is being ignored.`,
      );
    }
  }

  return out;
}

function stageOf(id: KeyStatus['id']): ProviderStage {
  return PROVIDERS.find((p) => p.id === id)?.stage ?? 'plan';
}
