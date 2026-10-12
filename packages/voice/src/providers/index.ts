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
import type { PhraseSplit } from '../phrase.js';
import { logger, textProvider } from '@inkcast/core';
import { createElevenLabsProvider } from './elevenlabs.js';
import { createKokoroProvider } from './kokoro.js';
import { createSilenceProvider } from './silence.js';
import { createSystemProvider } from './system.js';
import type {
  SynthesisRequest,
  SynthesisResult,
  VoiceFailureReason,
  VoiceProvider,
  VoiceProviderId,
} from './types.js';
import { failureReason, isVoiceProviderId, VOICE_PROVIDER_IDS } from './types.js';

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
export {
  alignmentToWords,
  elevenLabsCostUsd,
  elevenLabsCreditsPerChar,
  elevenLabsDelivery,
  elevenLabsModel,
  ELEVENLABS_FLASH_MODEL,
  ELEVENLABS_MULTILINGUAL_MODEL,
  ELEVENLABS_QUALITY_MODEL,
  ELEVENLABS_USD_PER_CREDIT,
} from './elevenlabs.js';

/**
 * Order with no cloud key: Kokoro first (local, free, best of the free options),
 * `system` as the offline safety net, ElevenLabs — which will refuse for want of a key —
 * and timed silence as the never-crash floor.
 */
export const DEFAULT_CHAIN: readonly VoiceProviderId[] = [
  'kokoro',
  'system',
  'elevenlabs',
  'silence',
];

/** Order when a key exists. Same links, ElevenLabs first; local still catches a failure. */
const KEYED_CHAIN: readonly VoiceProviderId[] = ['elevenlabs', 'kokoro', 'system', 'silence'];

/**
 * The chain for this environment, and the one place "which voice do you get" is decided.
 *
 * Fireworks selects the local speech chain. Otherwise a present
 * `ELEVENLABS_API_KEY` wins. Previously the reason it did not
 * was invisible: the chain was ordered local-first and Kokoro is always available, so a
 * user who pasted an ElevenLabs key got the 82M-parameter local model and a `pipeline.json`
 * that said `kokoro/af_heart`. Nothing was broken and nothing was reported; the key was
 * simply never reached. Someone who supplies a paid key has said what they want.
 *
 * Kokoro stays directly behind it, so a rate limit, an expired key or an outage demotes to
 * a real voice rather than to silence — which is the property the chain exists for.
 *
 * Pin the local one with a `kokoro:` or `local:` prefix on the voice id when you want free
 * delivery *despite* a key. See `pinnedProvider`.
 */
export function defaultChain(env: NodeJS.ProcessEnv = process.env): VoiceProviderId[] {
  if (textProvider(env) === 'fireworks') return ['kokoro', 'system', 'silence'];
  return env.ELEVENLABS_API_KEY ? [...KEYED_CHAIN] : [...DEFAULT_CHAIN];
}

/** Provider prefixes on a voice id, which pin the choice whatever the environment says. */
const PINS: Record<string, VoiceProviderId> = {
  elevenlabs: 'elevenlabs',
  kokoro: 'kokoro',
  local: 'kokoro',
  say: 'system',
  system: 'system',
};

/**
 * The provider a voice id pins, if it names one: `kokoro:af_heart`, `elevenlabs:Rachel`.
 *
 * The escape hatch that makes the keyed default safe. Without it, storing a key would mean
 * paying for every render with no way to say "this one is free" short of unsetting an
 * environment variable.
 */
export function pinnedProvider(voiceId: string | undefined): VoiceProviderId | undefined {
  if (!voiceId) return undefined;
  const at = voiceId.indexOf(':');
  // A bare provider name pins too: `--voice say` has always meant the system voice, and
  // before this it merely *reported* as one while the chain quietly used Kokoro.
  const head = (at > 0 ? voiceId.slice(0, at) : voiceId).toLowerCase();
  return PINS[head];
}

/** A voice id with any provider prefix removed, as the provider itself wants it. */
export function bareVoiceId(voiceId: string): string {
  const at = voiceId.indexOf(':');
  return at > 0 && PINS[voiceId.slice(0, at).toLowerCase()] ? voiceId.slice(at + 1) : voiceId;
}

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

/** Preferred provider first, then everything else in this environment's order. */
export function chainFor(
  preferred?: VoiceProviderId,
  env: NodeJS.ProcessEnv = process.env,
): VoiceProviderId[] {
  const order = defaultChain(env);
  if (!preferred) return order;
  return [preferred, ...order.filter((id) => id !== preferred)];
}

export type ActiveProvider = {
  id: VoiceProviderId;
  label: string;
  /**
   * Provider-native voice id for this run, as `resolveVoice` decided it.
   *
   * This is a **cache-key input** — the voice stage hashes it into every clip key —
   * so it is deliberately the *requested* resolution and never moves once the chain
   * has resolved it. A substitution forced mid-run lands on `spokenVoice` instead;
   * writing it here would re-key every scene after the one that learned it and
   * re-synthesise a film that had not changed. See `spokenVoice`.
   */
  voice: string;
  /**
   * The voice that actually came out of the speaker, when it is not `voice`.
   *
   * Absent on every ordinary run. Present when the provider was refused the voice it
   * asked for and used another — see `SynthesisResult.substitution`. The *record* has
   * to name this one: a `pipeline.json` that says Rachel for a film spoken by Sarah
   * is a file that cannot be checked against the audio it describes.
   */
  spokenVoice?: string;
  /**
   * Measured natural rate of `voice` in words per minute, when the provider
   * characterises it. The voice stage turns this into the `speed` that lands the
   * narration in the 140–160 wpm teaching band.
   */
  naturalWpm?: number;
  /**
   * How much text this engine needs at a time to sound like a person, when it says.
   * Surfaced here because the voice stage splits a scene *before* it synthesises, and the
   * split is the single biggest lever on whether the delivery flows or lands hard on every
   * fragment. See `VoiceProvider.preferredSplit`.
   */
  preferredSplit?: PhraseSplit;
  /** The engine that will speak, when the provider names one. See `VoiceProvider.modelId`. */
  model?: string;
  /** The adapter's delivery decisions, for the clip key. See `VoiceProvider.deliverySignature`. */
  delivery?: string;
};

/** One demotion: who stopped speaking, who took over, and why. */
export type VoiceFallback = {
  from: VoiceProviderId;
  to: VoiceProviderId;
  reason: VoiceFailureReason;
};

/**
 * One link that never got to speak at all — refused or broken *before* the first
 * character.
 *
 * A different event from `VoiceFallback`, and the difference is the whole reason
 * this type exists. A fallback is a provider that started and stopped: it is loud,
 * it lands in `problems`, and the user is told. A rejection is a provider that was
 * never reached, and until now the only trace of one was a `log.debug` line —
 * which is exactly how "ElevenLabs was never getting caught" happened. A key in
 * the vault that had not been hydrated into `process.env`, or a provider that
 * threw while resolving a voice, produced an ordinary-looking local film with
 * nothing anywhere saying a paid provider had been skipped.
 *
 * `preferred` is what makes it reportable without becoming noise. The unkeyed
 * chain rejects ElevenLabs on *every* local run by design, and saying so every
 * time would train everyone to ignore the line. The head of the chain is
 * different: it is the provider this environment — or an explicit
 * `INKCAST_VOICE` — actually asked for, so its rejection is a request that was
 * refused, and that is always worth a sentence.
 */
/**
 * A voice the provider was refused, and the one it used instead.
 *
 * Distinct from a `VoiceFallback` in the way that matters to the person watching:
 * the *provider* did not change, so the film is still the paid one they asked and
 * paid for — it simply is not the voice named in the record. Reported so the
 * record can name the right one and say what happened to the other.
 */
export type VoiceSubstitution = {
  provider: VoiceProviderId;
  /** The voice the chain resolved. Still what every cache key is computed from. */
  from: string;
  /** The voice that actually spoke. */
  to: string;
  /** Its display name, when the provider knows one. */
  toName?: string;
  /** One clause naming why the requested voice was refused. */
  why: string;
};

export type VoiceRejection = {
  id: VoiceProviderId;
  /** `unavailable`: `available()` said no. `init-failed`: it threw while resolving. */
  cause: 'unavailable' | 'init-failed';
  /** One clause naming the fixable thing, from the provider itself where it can. */
  reason: string;
  /** True when this was the head of the chain — see the note above. */
  preferred: boolean;
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
  /**
   * Demotions that happened mid-run, in order.
   *
   * Separate from `skipped()`, which also holds providers that were never available in
   * the first place. A fallback is the case the user is owed a sentence about: they
   * asked for a paid voice, some of the film is in a free one, and until this existed
   * the only trace was a `log.warn` nobody reads after the fact.
   */
  fallbacks(): VoiceFallback[];
  /**
   * Links that were refused before they spoke, in order. See `VoiceRejection`.
   *
   * A strict superset of `skipped()` in information — same providers, with the
   * cause, the reason and whether the chain had preferred it. `skipped()` stays
   * for the callers that only want the ids.
   */
  rejections(): VoiceRejection[];
  /** Voices a provider was refused and spoke around, in order. See `VoiceSubstitution`. */
  substitutions(): VoiceSubstitution[];
  dispose(): Promise<void>;
};

export type OpenChainOptions = ProviderHooks & {
  /** Explicit provider request; falls back to `INKCAST_VOICE`. */
  preferred?: VoiceProviderId;
  /** The storyboard's `meta.voice`, mapped per provider. */
  requestedVoice: string;
  log?: Logger;
  /**
   * How a link of the chain is built. Defaults to `createProvider`.
   *
   * The one seam a test needs: failover is the behaviour that decides what the record
   * says and what the run costs, and the only way to exercise it without a key and a
   * real quota failure is to hand the chain a provider that fails on demand.
   */
  create?: (id: VoiceProviderId, hooks: ProviderHooks) => VoiceProvider;
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
  const refusals: VoiceRejection[] = [];
  const swaps: VoiceSubstitution[] = [];
  const demotions: VoiceFallback[] = [];
  const make = opts.create ?? createProvider;

  /**
   * Record a link that never spoke, and say so at a level someone will see.
   *
   * `warn` for the head of the chain, `debug` for the rest — the reasoning is on
   * `VoiceRejection.preferred`: rejecting ElevenLabs is the normal state of every
   * unkeyed run and warning about it would bury the one case that matters.
   */
  function reject(id: VoiceProviderId, entry: Omit<VoiceRejection, 'id'>): void {
    rejected.push(id);
    refusals.push({ id, ...entry });
    const line = `voice provider ${id} was skipped at startup: ${entry.reason}`;
    if (entry.preferred) log.warn(line);
    else log.debug(line);
  }

  let cursor = 0;
  let current: { provider: VoiceProvider; active: ActiveProvider } | undefined;
  let resolving: Promise<ActiveProvider> | undefined;

  async function advance(): Promise<ActiveProvider> {
    while (cursor < order.length) {
      const id = order[cursor]!;
      // Read before the increment: the head of the chain is the provider this
      // environment asked for, and that is the only rejection worth a warning.
      const preferred = cursor === 0;
      cursor++;
      const provider = make(id, { onDownload: opts.onDownload });
      try {
        if (!(await provider.available())) {
          reject(id, {
            cause: 'unavailable',
            reason: provider.unavailableReason?.() ?? 'the provider reported it is unavailable',
            preferred,
          });
          await provider.dispose();
          continue;
        }
        const voice = await provider.resolveVoice(opts.requestedVoice);
        const naturalWpm = provider.naturalWpm?.(voice);
        const preferredSplit = provider.preferredSplit?.();
        const model = provider.modelId?.();
        const delivery = provider.deliverySignature?.();
        current = {
          provider,
          active: { id, label: provider.label, voice, naturalWpm, preferredSplit, model, delivery },
        };
        log.info(`provider: ${provider.label} · voice ${voice}`);
        return current.active;
      } catch (err) {
        reject(id, {
          cause: 'init-failed',
          reason: err instanceof Error ? err.message : String(err),
          preferred,
        });
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
    // Recorded after the next provider has actually resolved, so `to` is the one that
    // will speak rather than the next id in the order — which may itself be skipped.
    const next = await active();
    if (failed) demotions.push({ from: failed.active.id, to: next.id, reason: failureReason(err) });
  }

  return {
    active,
    skipped: () => [...rejected],
    fallbacks: () => [...demotions],
    rejections: () => [...refusals],
    substitutions: () => [...swaps],

    async synthesize(req) {
      // Bounded by the chain length: each failure consumes one link.
      for (let attempt = 0; attempt <= order.length; attempt++) {
        const chosen = await active();
        const provider = current?.provider;
        if (!provider) throw new Error('no voice provider is available');
        try {
          const result = await provider.synthesize({ ...req, voice: chosen.voice });
          // Recorded on the *active* provider, in place, so every later reader —
          // the record, the log line, the result UI — sees the voice that spoke
          // without anybody having to thread it through. `chosen` is that same
          // object, so the mutation is visible to this call's own return value too.
          if (result.substitution && chosen.spokenVoice !== result.substitution.voice) {
            const { voice, name, from, why } = result.substitution;
            chosen.spokenVoice = voice;
            swaps.push({
              provider: chosen.id,
              from,
              to: voice,
              ...(name ? { toName: name } : {}),
              why,
            });
          }
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
