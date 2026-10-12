/**
 * `@inkcast/voice` — the voice stage.
 *
 * `narrate(sb, dir, opts)` synthesises one audio clip per scene, measures each
 * one, and writes `audio/narration.wav` for the renderer to mux. The measured
 * per-scene durations are what make the whole video time-aligned.
 *
 * Beyond measurement it does three things that decide whether the video teaches:
 *
 * - **Cue resolution.** Narration is synthesised in phrases and measured, so an
 *   element's `enter.cue` ("a verbatim phrase from this narration") resolves to a
 *   real offset and overwrites `enter.at`. See `cue.ts`.
 * - **Pacing.** The target rate is 140–160 wpm and `speed` is derived from each
 *   voice's *measured* baseline rather than assumed. See `voices.ts`.
 * - **Silence.** `Scene.hold` becomes real trailing silence, and clauses get a
 *   gap so ideas breathe. See `phrase.ts`.
 */
export { narrate, sceneAudioPath, sceneTimingPath, NARRATION_FILE } from './narrate.js';
export type { NarrateOptions, NarrateResult, ResolvedVoice } from './narrate.js';

/* --------------------------------------------------------- cues and phrases */

export {
  cueTokens,
  findCueSpan,
  matchTokens,
  resolveSceneCues,
  sceneTokenStream,
  tokenOffsetSec,
  MIN_CUE_SCORE,
} from './cue.js';
export type {
  CueResolution,
  ResolveCuesOptions,
  ResolveCuesResult,
  SceneToken,
  TokenSpan,
} from './cue.js';

export {
  gapAfter,
  sentenceSpanWarnings,
  splitClauses,
  splitPhrases,
  MIN_CLAUSE_WORDS,
  PHRASE_GAP_SEC,
  SENTENCE_GAP_SEC,
} from './phrase.js';
export type { Phrase, PhraseSplit, PhraseTiming, SplitOptions } from './phrase.js';

/* -------------------------------------------------- voice choice and pacing */

export {
  analyseSpeech,
  auditKokoroVoices,
  measuredWpm,
  pickTeachingVoice,
  rankTeachingVoices,
  speedForWpm,
  teachingScore,
  voiceProfile,
  AUDIT_PARAGRAPH,
  KOKORO_VOICE_PROFILES,
  TEACHING_VOICE,
  TEACHING_WPM_MAX,
  TEACHING_WPM_MIN,
  TEACHING_WPM_TARGET,
} from './voices.js';
export type {
  SpeechAnalysis,
  VoiceGrade,
  VoiceMeasurement,
  VoicePreference,
  VoiceProfile,
} from './voices.js';

/* --------------------------------------------------------- the curated moods */

/**
 * Four moods, not twenty-eight voice ids — the typed catalogue the CLI and the studio
 * both read so neither has to mirror a list by hand. `apps/web/components/studio/
 * options.ts` mirrors ids today because `@inkcast/voice` cannot be imported into a
 * browser bundle; `VOICE_MOODS` is small, string-only and dependency-free, so a
 * server component can hand it straight to the client and the mirror can go.
 */
export {
  isVoiceMoodId,
  moodCatalogueProblems,
  moodVoiceId,
  unverifiedMoods,
  voiceMood,
  DEFAULT_MOOD,
  MOODS_UNVERIFIED_NOTE,
  VOICE_MOODS,
  VOICE_MOOD_IDS,
} from './moods.js';
export type { VoiceMood, VoiceMoodId } from './moods.js';

/* ------------------------------------------------------- optional alignment */

export {
  alignerCached,
  alignerModelId,
  hypothesisFromChunks,
  isAlignMode,
  mapToExpected,
  nullAligner,
  openAligner,
  requestedAlign,
  ALIGN_SAMPLE_RATE,
  MIN_ALIGN_FRACTION,
} from './align.js';
export type { Alignment, AlignMode, Aligner, Hypothesis, OpenAlignerOptions } from './align.js';

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
  elevenLabsCostUsd,
  elevenLabsCreditsPerChar,
  elevenLabsDelivery,
  elevenLabsModel,
  failureReason,
  VoiceProviderError,
  ELEVENLABS_FLASH_MODEL,
  ELEVENLABS_MULTILINGUAL_MODEL,
  ELEVENLABS_QUALITY_MODEL,
  ELEVENLABS_USD_PER_CREDIT,
} from './providers/index.js';
export { SAY_NOT_FOR_PUBLISHING, sayRateForWpm } from './providers/system.js';
export { estimateClipSeconds } from './providers/silence.js';

export type {
  ActiveProvider,
  OpenChainOptions,
  ProviderHooks,
  SynthesisRequest,
  SynthesisResult,
  VoiceChain,
  VoiceFailureReason,
  VoiceFallback,
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

/**
 * Re-exported, not owned: the normaliser lives in `@inkcast/core`'s `speech.ts`
 * since plan item 4.1, because the planner has to tokenise narration with the
 * same function to write `Enter.cueWord`. The names stay here so a caller that
 * asked the voice package how narration is spoken still gets an answer.
 */
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
} from '@inkcast/core';
export type { NormalizeResult } from '@inkcast/core';

/* ----------------------------------------------------- audio utilities */

export {
  appendSilence,
  concatWavs,
  ffprobeDuration,
  measureDuration,
  padWav,
  readClipSamples,
  writeClipFromParts,
  writeSilenceWav,
  hasBinary,
} from './audio.js';
export type { AssembledClip, AssembleOptions, ClipPart } from './audio.js';

export {
  CLIP_BITS,
  CLIP_CHANNELS,
  CLIP_FORMAT,
  CLIP_SAMPLE_RATE,
  CLIP_SIGNATURE,
  encodeWav,
  findSpeechBounds,
  readWavInfo,
  silenceWav,
  trimEdgeSilence,
  wavDurationFromBuffer,
} from './wav.js';
export type { BoundsOptions, SpeechBounds, WavFormat, WavInfo } from './wav.js';
