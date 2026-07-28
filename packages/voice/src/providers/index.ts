/**
 * Provider selection and the fallback chain.
 *
 * Selection is automatic and always logged. The chain is walked lazily: a
 * provider is only instantiated when it is reached, so choosing `system` never
 * pays for `kokoro-js`, and a mid-run failure (a corrupt weight file, an expired
 * API key, a rate limit) demotes to the next provider and carries on rather than
 * killing the pipeline.
 */
import type { Logger } from '@inkcast/core';
import { logger } from '@inkcast/core';
import { createElevenLabsProvider } from './elevenlabs.js';
import { createKokoroProvider } from './kokoro.js';
import { createSilenceProvider } from './silence.js';
import { createSystemProvider } from './system.js';
import type {
  SynthesisRequest,
  SynthesisResult,
  VoiceProvider,
  VoiceProviderId,
} from './types.js';
import { isVoiceProviderId, VOICE_PROVIDER_IDS } from './types.js';

export * from './types.js';
export {
  KOKORO_VOICES,
  KOKORO_DEFAULT_VOICE,
  KOKORO_MODEL_ID,
  modelCacheDir,
  loadKokoro,
  unloadKokoro,
  weightsCached,
} from './kokoro.js';
export { parseSayVoices, pickSayVoice } from './system.js';
export { alignmentToWords } from './elevenlabs.js';

/**
 * Default order. Kokoro first (local, free, best quality of the free options),
 * `system` as the offline safety net, ElevenLabs only if a key exists, and timed
 * silence as the never-crash floor.
 */
export const DEFAULT_CHAIN: readonly VoiceProviderId[] = ['kokoro', 'system', 'elevenlabs', 'silence'];

export type ProviderHooks = {
  /** Fired while model weights download, so a long first run shows progress. */
  onDownload?: (note: string) => void;
};

export function createProvider(id: VoiceProviderId, hooks: ProviderHooks = {}): VoiceProvider {
  switch (id) {
    case 'kokoro':
      return createKokoroProvider(hooks.onDownload);
    case 'system':
      return createSystemProvider();
    case 'elevenlabs':
      return createElevenLabsProvider();
    case 'silence':
      return createSilenceProvider();
  }
}

/** Resolve the requested provider from options then `INKCAST_VOICE`. */
export function requestedProvider(explicit?: string): VoiceProviderId | undefined {
  const candidate = explicit ?? process.env.INKCAST_VOICE;
  if (!candidate) return undefined;
  if (isVoiceProviderId(candidate)) return candidate;
  logger('voice').warn(
    `unknown voice provider "${candidate}" — expected one of ${VOICE_PROVIDER_IDS.join(', ')}`,
  );
  return undefined;
}

/** Preferred provider first, then everything else in the default order. */
export function chainFor(preferred?: VoiceProviderId): VoiceProviderId[] {
  if (!preferred) return [...DEFAULT_CHAIN];
  return [preferred, ...DEFAULT_CHAIN.filter((id) => id !== preferred)];
}

export type ActiveProvider = {
  id: VoiceProviderId;
  label: string;
  /** Provider-native voice id for this run. */
  voice: string;
};

export type VoiceChain = {
  /** Currently selected provider, resolving the chain on first use. */
  active(): Promise<ActiveProvider>;
  /** Synthesise, demoting down the chain if the active provider fails. */
  synthesize(
    req: Omit<SynthesisRequest, 'voice'>,
  ): Promise<SynthesisResult & { provider: ActiveProvider }>;
  /** Providers that were tried and rejected, for reporting. */
  skipped(): VoiceProviderId[];
  dispose(): Promise<void>;
};

export type OpenChainOptions = ProviderHooks & {
  /** Explicit provider request; falls back to `INKCAST_VOICE`. */
  preferred?: VoiceProviderId;
  /** The storyboard's `meta.voice`, mapped per provider. */
  requestedVoice: string;
  log?: Logger;
};

/**
 * Build the lazily-resolved provider chain.
 *
 * `silence` is always last and always available, so `active()` cannot fail —
 * that is what makes "never crash because a provider is unavailable" true rather
 * than aspirational.
 */
export function openVoiceChain(opts: OpenChainOptions): VoiceChain {
  const log = opts.log ?? logger('voice');
  const order = chainFor(opts.preferred);
  const rejected: VoiceProviderId[] = [];

  let cursor = 0;
  let current: { provider: VoiceProvider; active: ActiveProvider } | undefined;
  let resolving: Promise<ActiveProvider> | undefined;

  async function advance(): Promise<ActiveProvider> {
    while (cursor < order.length) {
      const id = order[cursor]!;
      cursor++;
      const provider = createProvider(id, { onDownload: opts.onDownload });
      try {
        if (!(await provider.available())) {
          rejected.push(id);
          await provider.dispose();
          continue;
        }
        const voice = await provider.resolveVoice(opts.requestedVoice);
        current = { provider, active: { id, label: provider.label, voice } };
        log.info(`provider: ${provider.label} · voice ${voice}`);
        return current.active;
      } catch (err) {
        rejected.push(id);
        log.warn(`provider ${id} could not be initialised — trying the next one`, err);
        await provider.dispose().catch(() => undefined);
      }
    }
    // Unreachable in practice: `silence` is always available.
    throw new Error('no voice provider is available');
  }

  function active(): Promise<ActiveProvider> {
    if (current) return Promise.resolve(current.active);
    resolving ??= advance().finally(() => {
      resolving = undefined;
    });
    return resolving;
  }

  async function demote(err: unknown): Promise<void> {
    const failed = current;
    current = undefined;
    if (failed) {
      rejected.push(failed.active.id);
      log.warn(`provider ${failed.active.id} failed mid-run — falling back`, err);
      await failed.provider.dispose().catch(() => undefined);
    }
    await active();
  }

  return {
    active,
    skipped: () => [...rejected],

    async synthesize(req) {
      // Bounded by the chain length: each failure consumes one link.
      for (let attempt = 0; attempt <= order.length; attempt++) {
        const chosen = await active();
        const provider = current?.provider;
        if (!provider) throw new Error('no voice provider is available');
        try {
          const result = await provider.synthesize({ ...req, voice: chosen.voice });
          return { ...result, provider: chosen };
        } catch (err) {
          if (cursor >= order.length) throw err;
          await demote(err);
        }
      }
      throw new Error('every voice provider failed');
    },

    async dispose() {
      if (current) await current.provider.dispose().catch(() => undefined);
      current = undefined;
    },
  };
}
