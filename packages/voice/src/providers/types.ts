/** The one interface every TTS backend implements. */
import type { Scene } from '@inkcast/core';

/** Word timing as the Storyboard IR wants it. */
export type WordTiming = NonNullable<Scene['words']>[number];

/**
 * Selection order is also the fallback order. Kokoro is the documented local
 * default; `system` is the safety net that needs no download at all;
 * `elevenlabs` is an opt-in cloud upgrade; `silence` is the last resort that
 * keeps a render alive (timed, silent clips) when nothing else can speak.
 */
export const VOICE_PROVIDER_IDS = ['kokoro', 'system', 'elevenlabs', 'silence'] as const;
export type VoiceProviderId = (typeof VOICE_PROVIDER_IDS)[number];

export function isVoiceProviderId(value: unknown): value is VoiceProviderId {
  return typeof value === 'string' && (VOICE_PROVIDER_IDS as readonly string[]).includes(value);
}

export type SynthesisRequest = {
  /** Already normalised by `normalizeNarration`. */
  text: string;
  /** Provider-native voice id, produced by `resolveVoice`. */
  voice: string;
  /** 1 = natural rate. */
  speed: number;
  /** BCP-47-ish language tag from `storyboard.meta.language`. */
  language: string;
  /**
   * Absolute destination. The provider MUST write a WAV in `CLIP_FORMAT`
   * (24 kHz mono 16-bit) so per-scene clips concatenate losslessly.
   */
  outPath: string;
};

export type SynthesisResult = {
  /** Only when the provider genuinely supplies timings. */
  words?: WordTiming[];
};

export type VoiceProvider = {
  readonly id: VoiceProviderId;
  /** Human-readable, used in log lines. */
  readonly label: string;
  /** Cheap check with no side effects and no model download. */
  available(): Promise<boolean>;
  /** Voice ids this provider accepts. */
  voices(): Promise<string[]>;
  /** Best provider-native match for a requested storyboard voice. */
  resolveVoice(requested: string): Promise<string>;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
  /** Release any cached handles. Must be safe to call twice. */
  dispose(): Promise<void>;
};
