/**
 * `@inkcast/voice` — the voice stage.
 *
 * `narrate(sb, dir, opts)` synthesises one audio clip per scene, measures each
 * one, and writes `audio/narration.wav` for the renderer to mux. The measured
 * per-scene durations are what make the whole video time-aligned.
 */
export { narrate, sceneAudioPath, NARRATION_FILE } from './narrate.js';
export type { NarrateOptions } from './narrate.js';

/* ------------------------------------------------------------------ voices */

export {
  createProvider,
  openVoiceChain,
  chainFor,
  requestedProvider,
  DEFAULT_CHAIN,
  VOICE_PROVIDER_IDS,
  isVoiceProviderId,
  KOKORO_VOICES,
  KOKORO_DEFAULT_VOICE,
  KOKORO_MODEL_ID,
  modelCacheDir,
  weightsCached,
  loadKokoro,
  unloadKokoro,
  parseSayVoices,
  pickSayVoice,
  alignmentToWords,
} from './providers/index.js';

export type {
  ActiveProvider,
  OpenChainOptions,
  ProviderHooks,
  SynthesisRequest,
  SynthesisResult,
  VoiceChain,
  VoiceProvider,
  VoiceProviderId,
  WordTiming,
} from './providers/index.js';

import { createProvider } from './providers/index.js';
import type { VoiceProviderId } from './providers/index.js';

/** Voice ids a provider will accept — for the studio's voice picker. */
export async function listVoices(provider: VoiceProviderId = 'kokoro'): Promise<string[]> {
  const p = createProvider(provider);
  try {
    if (!(await p.available())) return [];
    return await p.voices();
  } finally {
    await p.dispose();
  }
}

/* ------------------------------------------------- text normalisation (pure) */

export {
  normalizeNarration,
  normalizeNarrationDetailed,
  stripMarkdown,
  expandAbbreviations,
  splitSentences,
  speakNumbers,
  speakSymbols,
  tidy,
  numberToWords,
  decimalToWords,
  ordinalToWords,
  yearToWords,
  digitsToWords,
  estimateSpokenSeconds,
  ABBREVIATIONS,
  SYMBOLS,
} from './text.js';
export type { NormalizeResult } from './text.js';

/* ----------------------------------------------------- audio utilities */

export {
  concatWavs,
  ffprobeDuration,
  measureDuration,
  padWav,
  writeSilenceWav,
  hasBinary,
} from './audio.js';

export {
  CLIP_BITS,
  CLIP_CHANNELS,
  CLIP_FORMAT,
  CLIP_SAMPLE_RATE,
  CLIP_SIGNATURE,
  encodeWav,
  readWavInfo,
  silenceWav,
  wavDurationFromBuffer,
} from './wav.js';
export type { WavFormat, WavInfo } from './wav.js';
