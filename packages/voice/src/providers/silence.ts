/**
 * Timed silence — the last link in the fallback chain.
 *
 * This is not a mock: it writes a real WAV of a real, measurable length derived
 * from the word count of the narration, so `scene.durationSec` stays meaningful
 * and the video still renders with roughly correct pacing when nothing on the
 * machine can actually speak (no Kokoro weights, not macOS, no API key).
 *
 * It is also genuinely useful on purpose: `INKCAST_VOICE=silence` gives CI and
 * layout iteration a fast, deterministic, offline voice stage.
 */
import { logger } from '@inkcast/core';
import { estimateSpokenSeconds } from '../text.js';
import { writeSilenceWav } from '../audio.js';
import type { SynthesisRequest, SynthesisResult, VoiceProvider } from './types.js';

const log = logger('voice:silence');

/** Words per minute used to estimate a scene's length. */
const WPM = 155;
const MIN_SEC = 1.2;
const MAX_SEC = 60;

export function estimateClipSeconds(text: string): number {
  const estimate = estimateSpokenSeconds(text, WPM);
  return Math.max(MIN_SEC, Math.min(MAX_SEC, estimate));
}

export function createSilenceProvider(): VoiceProvider {
  return {
    id: 'silence',
    label: 'timed silence (no speech)',

    async available() {
      return true;
    },

    async voices() {
      return ['silence'];
    },

    async resolveVoice() {
      return 'silence';
    },

    async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
      const seconds = estimateClipSeconds(req.text) / Math.max(0.5, req.speed);
      log.debug(`writing ${seconds.toFixed(2)}s of silence for ${req.text.length} chars`);
      await writeSilenceWav(req.outPath, seconds);
      return {};
    },

    async dispose() {
      // Nothing to release.
    },
  };
}
