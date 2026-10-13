import { fail, json, unexpected } from '../_lib/http';
import { accountKeys } from '../_lib/deployment';
import { guardRequest } from '../_lib/request-guard';
import { resolveIdentity, setSessionCookie, ownerTagFor } from '../_lib/session';
import { META_KEYS } from '../_lib/schemas';
import { STUDIO_PRESETS, HOSTED_PRESET } from '@/lib/jobs';
import { isHosted, loadCore, loadPipeline } from '@/lib/store';
import { defaultSelection, selectedVoice } from '@/lib/provider-selection';
import { PROVIDERS } from '@/components/settings/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const refused = guardRequest(request, true);
  if (refused) return refused;
  try {
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const account = accountKeys();
    let keys;
    if (account) {
      const { accountKeyStatuses, accountOwner } = await import('../keys/_account');
      const owner = await accountOwner(request);
      if (!owner.ok) return owner.response;
      keys = await accountKeyStatuses({
        tag: ownerTagFor(who.session),
        session: who.session,
        signedIn: who.via === 'user',
      });
    } else {
      keys = await (await import('../keys/_store')).keyStatuses();
    }
    const selection = defaultSelection(keys);
    // Availability markers only: no credentials are needed to describe choices.
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV,
      INKCAST_PLANNER: selection.planner,
    };
    for (const key of keys)
      if (key.configured) {
        const name = PROVIDERS.find((provider) => provider.id === key.id)!.envVar;
        env[name] = 'configured';
      }
    const { providers, fullyLocal } = await loadPipeline();
    const chosen = providers(selectedVoice(selection), env);
    const warnings: string[] = [];
    if (!chosen.planner.cloud)
      warnings.push(
        'Local planning makes a basic document summary. Add Fireworks for authored lessons and diagrams.',
      );
    if (!chosen.voice.cloud)
      warnings.push(
        'Local narration uses Kokoro in English. Add ElevenLabs for cloud speech and native word timings.',
      );
    if (!chosen.images.cloud)
      warnings.push(
        'Illustrations use built-in assets. Generated raster artwork needs a separate fal or Replicate key.',
      );
    for (const key of keys) {
      if (key.unreadable)
        warnings.push(`Your ${key.id} key cannot be read. Replace it in Settings.`);
      if (key.validatedOk === false)
        warnings.push(
          `Your ${key.id} key failed its last check. Check its permissions or replace it.`,
        );
    }
    const { stylePacks } = await loadCore();
    return setSessionCookie(
      json({
        providers: chosen,
        selection,
        local: fullyLocal(chosen),
        keys,
        credentialScope: account ? 'account' : 'machine',
        projectsDir: account ? null : (process.env.INKCAST_PROJECTS ?? null),
        warnings,
        accepts: META_KEYS,
        formats: isHosted() ? [HOSTED_PRESET] : [...STUDIO_PRESETS],
        styles: [...stylePacks().values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((pack) => ({
            id: pack.id,
            label: pack.name,
            hint: pack.id === 'blueprint' ? 'White ink on a deep blue board' : pack.description,
          })),
      }),
      who.session,
    );
  } catch (err) {
    return unexpected('providers', err);
  }
}
