/**
 * The voice stage.
 *
 * Each scene is synthesised as its **own clip**, then measured. That is a
 * deliberate design choice, not an implementation detail: because the clip
 * boundary *is* the scene boundary, `scene.durationSec` is an exact measurement
 * of real audio, and the renderer can map every element's fractional `enter.at`
 * onto wall-clock time with no forced aligner and no drift. Re-voicing in another
 * language or another engine simply remeasures and the animation reflows.
 *
 * Everything is cached per scene on `hash(normalised text + voice + provider)`,
 * so editing scene 7 re-synthesises scene 7 and nothing else.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { StageOptions, Storyboard } from '@inkcast/core';
import { hash, isFresh, logger, markFresh, report, totalDuration } from '@inkcast/core';
import { concatWavs, measureDuration, padWav, writeSilenceWav } from './audio.js';
import { normalizeNarration } from './text.js';
import { openVoiceChain, requestedProvider } from './providers/index.js';
import type { VoiceProviderId } from './providers/types.js';
import { CLIP_SIGNATURE } from './wav.js';

const log = logger('voice');

/** Where the assembled track lands. The renderer muxes exactly this file. */
export const NARRATION_FILE = 'audio/narration.wav';

/** Clip path for a scene index, relative to the project directory. */
export function sceneAudioPath(index: number): string {
  return `audio/scene-${String(index).padStart(3, '0')}.wav`;
}

export type NarrateOptions = StageOptions & {
  /** Force a provider. Defaults to `INKCAST_VOICE`, then the fallback chain. */
  provider?: VoiceProviderId;
  /** Override `storyboard.meta.voice`. */
  voice?: string;
  /** Speaking rate multiplier. 1 = natural. */
  speed?: number;
  /**
   * Trailing silence appended inside every scene clip, in seconds.
   *
   * Added *before* measurement, so the padded length is what `durationSec`
   * reports and sync is preserved. Without it, beats run into each other.
   */
  padSec?: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Synthesise every scene's narration, measure it, and assemble one track.
 *
 * Enriches and returns a copy of the storyboard: `scene.durationSec`,
 * `scene.audioPath`, and `scene.words` where the provider supplies timings.
 */
export async function narrate(
  sb: Storyboard,
  dir: string,
  opts: NarrateOptions = {},
): Promise<Storyboard> {
  const out = structuredClone(sb);
  const audioDir = path.resolve(dir, 'audio');
  await mkdir(audioDir, { recursive: true });

  const requestedVoice = opts.voice ?? out.meta.voice;
  const speed = clamp(opts.speed ?? envNumber('INKCAST_VOICE_SPEED', 1), 0.5, 2);
  const padSec = clamp(opts.padSec ?? envNumber('INKCAST_VOICE_PAD', 0.25), 0, 5);
  const total = out.scenes.length;

  const chain = openVoiceChain({
    preferred: requestedProvider(opts.provider),
    requestedVoice,
    log,
    onDownload: (note) => report(opts, { stage: 'voice', pct: 1, note: `downloading model · ${note}` }),
  });

  report(opts, { stage: 'voice', pct: 0, note: `${total} scene${total === 1 ? '' : 's'}` });

  /** Per-scene input hashes, folded into the narration-track cache key. */
  const sceneHashes: string[] = [];

  try {
    for (let i = 0; i < total; i++) {
      const scene = out.scenes[i]!;
      const text = normalizeNarration(scene.narration);
      const rel = sceneAudioPath(i);
      const abs = path.resolve(dir, rel);
      const cacheKey = `voice:scene:${i}:${scene.id}`;

      const active = await chain.active();
      const inputHash = hash(text, active.id, active.voice, speed, padSec, CLIP_SIGNATURE);
      sceneHashes.push(inputHash);

      // Progress is emitted before the work so the UI shows the scene being spoken.
      report(opts, {
        stage: 'voice',
        pct: (i / total) * 95,
        note: `scene ${i + 1}/${total} · ${active.id}`,
      });

      if (!opts.force && (await isFresh(dir, cacheKey, inputHash, [rel]))) {
        // Remeasure rather than trusting a stored number: the file on disk is
        // the source of truth for timing.
        scene.durationSec = await measureDuration(abs);
        scene.audioPath = rel;
        log.debug(`scene ${i + 1}: cached (${scene.durationSec.toFixed(2)}s)`);
        continue;
      }

      let words: NonNullable<Storyboard['scenes'][number]['words']> | undefined;

      if (!text) {
        // A scene with nothing to say still needs a positive duration and a clip,
        // or the storyboard fails validation and the camera move has no time.
        log.warn(`scene ${i + 1} (${scene.id}) has no speakable narration — writing a short pause`);
        await writeSilenceWav(abs, Math.max(padSec, 0.6));
      } else {
        const result = await chain.synthesize({
          text,
          speed,
          language: out.meta.language,
          outPath: abs,
        });
        if (result.words?.length) words = result.words;
        if (padSec > 0) await padWav(abs, padSec);
      }

      const measured = await measureDuration(abs);
      if (!(measured > 0)) throw new Error(`scene ${i + 1}: synthesised clip has no duration`);

      scene.durationSec = measured;
      scene.audioPath = rel;
      if (words) scene.words = words;
      else delete scene.words;

      // Re-hash against the provider that actually produced the clip: the chain
      // may have demoted mid-scene, and the cache must reflect reality.
      const finalActive = await chain.active();
      const finalHash = hash(text, finalActive.id, finalActive.voice, speed, padSec, CLIP_SIGNATURE);
      sceneHashes[i] = finalHash;
      await markFresh(dir, cacheKey, finalHash);

      log.info(`scene ${i + 1}/${total}: ${measured.toFixed(2)}s → ${rel}`);
    }
  } finally {
    await chain.dispose();
  }

  /* --------------------------------------------- assemble the single track */

  report(opts, { stage: 'voice', pct: 96, note: 'assembling narration track' });

  const clips = out.scenes.map((scene, i) => path.resolve(dir, scene.audioPath ?? sceneAudioPath(i)));
  const narrationHash = hash(sceneHashes, out.meta.outroSec, CLIP_SIGNATURE);

  if (opts.force || !(await isFresh(dir, 'voice:narration', narrationHash, [NARRATION_FILE]))) {
    const duration = await concatWavs(clips, path.resolve(dir, NARRATION_FILE), out.meta.outroSec);
    await markFresh(dir, 'voice:narration', narrationHash);
    log.info(`narration track: ${duration.toFixed(2)}s → ${NARRATION_FILE}`);
  } else {
    log.debug('narration track: cached');
  }

  const skipped = chain.skipped();
  if (skipped.length) log.debug(`providers skipped: ${skipped.join(', ')}`);

  report(opts, {
    stage: 'voice',
    pct: 100,
    note: `${totalDuration(out).toFixed(1)}s of narration`,
  });

  return out;
}
