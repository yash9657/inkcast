/**
 * The voice stage.
 *
 * Two guarantees, and everything here exists to serve one of them.
 *
 * **1. The clip boundary is the scene boundary.** Every scene is synthesised as
 * its own clip and measured, so `scene.durationSec` is a measurement of real
 * audio rather than a prediction. Re-voicing in another language or another
 * engine remeasures and the animation reflows. No forced aligner, no drift.
 *
 * **2. Elements land on the words that introduce them.** The MVP satisfied (1)
 * to within 25 ms across 164 seconds and still felt misaligned, because *element*
 * timing was a fraction the planner guessed. So narration is synthesised in
 * PHRASES — sentences, and clauses inside them — and each phrase is measured
 * before the pieces are rejoined. That makes phrase boundaries arithmetic, which
 * is what lets `Enter.cue` ("a verbatim phrase from this narration") resolve to a
 * real offset and overwrite `enter.at`. Where a provider or the optional local
 * Whisper aligner gives word timings, placement becomes word-exact.
 *
 * Silence is modelled, not left over: a small gap between clauses, a longer one
 * between sentences, a trailing breath, and `Scene.hold` rendered as real silence
 * so a beat can land before the next idea arrives.
 *
 * `scene.durationSec` reports the **narration portion only**, excluding `hold` —
 * that is the IR's definition (`sceneLength()` is `durationSec + hold`) and the
 * denominator `enter.at` is a fraction of. The clip on disk is
 * `durationSec + hold` long, exactly.
 *
 * Caching is per scene on `hash(normalised text + voice + provider + pacing)`, so
 * editing scene 7 re-synthesises scene 7 and nothing else. Measured phrase spans
 * and word timings are cached alongside the clip, because cue resolution needs
 * them on a cache hit too.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Scene, StageOptions, Storyboard } from '@inkcast/core';
import { hash, isFresh, logger, markFresh, report, totalDuration } from '@inkcast/core';
import {
  appendSilence,
  measureDuration,
  readClipSamples,
  writeClipFromParts,
  writeSilenceWav,
  concatWavs,
} from './audio.js';
import type { ClipPart } from './audio.js';
import { normalizeNarration } from './text.js';
import { gapAfter, sentenceSpanWarnings, splitPhrases } from './phrase.js';
import type { Phrase, PhraseSplit, PhraseTiming } from './phrase.js';
import { resolveSceneCues } from './cue.js';
import type { CueResolution } from './cue.js';
import { openAligner, requestedAlign } from './align.js';
import type { AlignMode } from './align.js';
import { openVoiceChain, requestedProvider } from './providers/index.js';
import type { VoiceProviderId, WordTiming } from './providers/types.js';
import { SAY_NOT_FOR_PUBLISHING } from './providers/system.js';
import { TEACHING_WPM_MAX, TEACHING_WPM_MIN, TEACHING_WPM_TARGET } from './voices.js';
import { CLIP_SAMPLE_RATE, CLIP_SIGNATURE, findSpeechBounds } from './wav.js';

const log = logger('voice');

/** Where the assembled track lands. The renderer muxes exactly this file. */
export const NARRATION_FILE = 'audio/narration.wav';

/** Clip path for a scene index, relative to the project directory. */
export function sceneAudioPath(index: number): string {
  return `audio/scene-${String(index).padStart(3, '0')}.wav`;
}

/**
 * Sidecar holding measured phrase spans and word timings.
 *
 * Written next to the clip because cue resolution must work on a cache hit: the
 * clip alone cannot tell you where its third clause started.
 */
export function sceneTimingPath(index: number): string {
  return `audio/scene-${String(index).padStart(3, '0')}.timing.json`;
}

export type NarrateOptions = StageOptions & {
  /** Force a provider. Defaults to `INKCAST_VOICE`, then the fallback chain. */
  provider?: VoiceProviderId;
  /** Override `storyboard.meta.voice`. */
  voice?: string;
  /**
   * Extra multiplier on top of the measured pacing correction. 1 = leave the
   * teaching rate alone; raise it only if you want to speak faster than 150 wpm.
   */
  speed?: number;
  /**
   * Target speaking rate in words per minute. 140–160 is the teaching band; the
   * MVP effectively ran at 193.
   */
  targetWpm?: number;
  /**
   * Trailing breath inside every scene clip, in seconds.
   *
   * Counted as part of the narration, so `durationSec` describes the file and
   * sync is preserved. Without it, beats with `hold: 0` run into each other.
   */
  padSec?: number;
  /** `clause` (default) buys sub-sentence cue precision; `sentence` is safer. */
  phraseSplit?: PhraseSplit;
  /** Word-level alignment: `auto` (default), `whisper`, or `off`. */
  align?: AlignMode;
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

/** What was measured for one scene, cached beside its clip. */
type SceneTiming = {
  version: 1;
  /** Narration portion of the clip, in seconds. */
  narrationSec: number;
  /** Silence appended for `Scene.hold`, in seconds. */
  holdSec: number;
  phrases: PhraseTiming[];
  words?: WordTiming[];
};

async function readTiming(file: string): Promise<SceneTiming | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as SceneTiming;
    if (parsed?.version === 1 && Array.isArray(parsed.phrases)) return parsed;
  } catch {
    // A missing or corrupt sidecar just means we resynthesise.
  }
  return undefined;
}

/* --------------------------------------------------------------- synthesis */

type SynthContext = {
  dir: string;
  speed: number;
  targetWpm: number;
  language: string;
  padSec: number;
  chain: ReturnType<typeof openVoiceChain>;
  aligner: ReturnType<typeof openAligner>;
};

/**
 * Synthesise one scene phrase by phrase and assemble the clip.
 *
 * Each phrase is generated into a scratch file, decoded, and trimmed to its real
 * speech bounds — every engine pads its output (Kokoro adds ~0.37 s in front and
 * ~0.55 s behind *per call*), and concatenating that padding would put nearly a
 * second of dead air at every clause boundary. Trimming keeps a 40 ms guard on
 * each side so a final consonant is never cut, and then a *chosen* gap is
 * inserted. That is the difference between pacing and an artefact.
 */
async function synthesizeScene(
  scene: Scene,
  index: number,
  phrases: readonly Phrase[],
  ctx: SynthContext,
): Promise<SceneTiming> {
  const rel = sceneAudioPath(index);
  const abs = path.resolve(ctx.dir, rel);
  const scratch = path.resolve(ctx.dir, 'audio', '.phrases');
  await mkdir(scratch, { recursive: true });

  const parts: ClipPart[] = [];
  /** Per-phrase provider word timings, rebased onto the trimmed clip. */
  const perPhraseWords: Array<WordTiming[] | undefined> = [];

  try {
    for (let i = 0; i < phrases.length; i++) {
      const phrase = phrases[i]!;
      const tmp = path.join(scratch, `${index}-${i}.wav`);
      const result = await ctx.chain.synthesize({
        text: phrase.text,
        speed: ctx.speed,
        targetWpm: ctx.targetWpm,
        language: ctx.language,
        outPath: tmp,
      });

      const samples = await readClipSamples(tmp);
      const bounds = findSpeechBounds(samples, CLIP_SAMPLE_RATE);
      const trimmed = samples.slice(bounds.start, bounds.end);
      const trimStartSec = bounds.start / CLIP_SAMPLE_RATE;

      parts.push({
        samples: trimmed.length ? trimmed : samples,
        gapSec: gapAfter(phrase, phrases[i + 1]),
      });

      // Provider timings are relative to the untrimmed clip; rebase them so they
      // stay valid after the leading silence is removed.
      perPhraseWords.push(
        result.words?.length
          ? result.words.map((w) => ({
              word: w.word,
              start: Math.max(0, w.start - trimStartSec),
              end: Math.max(0, w.end - trimStartSec),
            }))
          : undefined,
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const assembled = await writeClipFromParts(abs, parts, {
    padSec: ctx.padSec,
    holdSec: scene.hold,
    sampleRate: CLIP_SAMPLE_RATE,
  });

  const timings: PhraseTiming[] = phrases.map((phrase, i) => ({
    ...phrase,
    start: round3(assembled.spans[i]?.start ?? 0),
    end: round3(assembled.spans[i]?.end ?? 0),
  }));

  /* ------------------------------------------------------- word timings */

  // Best source first: the provider's own timings, offset into scene time.
  let words: WordTiming[] | undefined;
  if (perPhraseWords.every((w) => w?.length)) {
    words = perPhraseWords.flatMap((phraseWords, i) => {
      const base = assembled.spans[i]?.start ?? 0;
      return (phraseWords ?? []).map((w) => ({
        word: w.word,
        start: round3(base + w.start),
        end: round3(base + w.end),
      }));
    });
    log.debug(`scene ${index + 1}: ${words.length} word timings from the provider`);
  }

  // Otherwise try the local aligner on the narration portion of the clip.
  if (!words) {
    const spoken = phrases.map((p) => p.text).join(' ');
    const narrationFrames = Math.round(assembled.narrationSec * CLIP_SAMPLE_RATE);
    const clip = (await readClipSamples(abs)).slice(0, narrationFrames);
    const aligned = await ctx.aligner.align(clip, CLIP_SAMPLE_RATE, spoken);
    if (aligned.length) {
      words = aligned;
      log.debug(`scene ${index + 1}: ${aligned.length} word timings from the local aligner`);
    }
  }

  return {
    version: 1,
    narrationSec: assembled.narrationSec,
    holdSec: assembled.holdSec,
    phrases: timings,
    ...(words ? { words } : {}),
  };
}

/** A scene with nothing to say still needs a clip, a duration, and its hold. */
async function synthesizeEmptyScene(
  scene: Scene,
  index: number,
  ctx: SynthContext,
): Promise<SceneTiming> {
  const abs = path.resolve(ctx.dir, sceneAudioPath(index));
  const narrationSec = Math.max(ctx.padSec, 0.6);
  await writeSilenceWav(abs, narrationSec);
  const holdSec = await appendSilence(abs, scene.hold);
  return { version: 1, narrationSec, holdSec, phrases: [] };
}

/* ------------------------------------------------------------------ stage */

/**
 * Synthesise every scene's narration, measure it, resolve cues, assemble a track.
 *
 * Enriches and returns a copy of the storyboard: `scene.durationSec`,
 * `scene.audioPath`, `scene.words` where timings exist, and `element.enter.at`
 * rewritten for every element that carried a `cue`.
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
  const userSpeed = clamp(opts.speed ?? envNumber('INKCAST_VOICE_SPEED', 1), 0.5, 2);
  const targetWpm = clamp(
    opts.targetWpm ?? envNumber('INKCAST_VOICE_WPM', TEACHING_WPM_TARGET),
    80,
    260,
  );
  const padSec = clamp(opts.padSec ?? envNumber('INKCAST_VOICE_PAD', 0.25), 0, 5);
  const phraseSplit: PhraseSplit = opts.phraseSplit ?? 'clause';
  const alignMode = opts.align ?? requestedAlign();
  const total = out.scenes.length;

  const chain = openVoiceChain({
    preferred: requestedProvider(opts.provider),
    requestedVoice,
    log,
    onDownload: (note) =>
      report(opts, { stage: 'voice', pct: 1, note: `downloading model · ${note}` }),
  });
  const aligner = openAligner({
    mode: alignMode,
    language: out.meta.language,
    onDownload: (note) =>
      report(opts, { stage: 'voice', pct: 1, note: `downloading aligner · ${note}` }),
  });

  report(opts, { stage: 'voice', pct: 0, note: `${total} scene${total === 1 ? '' : 's'}` });

  // A sentence split across two beats is a planner bug that no amount of audio
  // alignment can repair, so it is reported before a single sample is generated.
  for (const warning of sentenceSpanWarnings(out.scenes.map((s) => s.narration))) log.warn(warning);

  /** Per-scene input hashes, folded into the narration-track cache key. */
  const sceneHashes: string[] = [];
  const cueLog: CueResolution[] = [];
  let unresolvedCues = 0;
  let spokenWords = 0;
  let spokenSeconds = 0;
  /**
   * The provider that spoke last. Remembered rather than re-queried, because
   * asking the chain again after `dispose()` would resolve it from scratch and
   * load a model just to write a log line.
   */
  let lastProvider: VoiceProviderId | undefined;

  try {
    for (let i = 0; i < total; i++) {
      const scene = out.scenes[i]!;
      const text = normalizeNarration(scene.narration);
      const phrases = splitPhrases(text, { mode: phraseSplit });
      const rel = sceneAudioPath(i);
      const timingRel = sceneTimingPath(i);
      const abs = path.resolve(dir, rel);
      const timingAbs = path.resolve(dir, timingRel);
      const cacheKey = `voice:scene:${i}:${scene.id}`;

      const active = await chain.active();
      lastProvider = active.id;
      // Speed is derived, not assumed: dividing the target rate by the voice's
      // measured baseline is the only way "140-160 wpm" becomes true rather than
      // aspirational. Providers that set an absolute rate ignore it.
      const speed = active.naturalWpm
        ? clamp(round3(userSpeed * (targetWpm / active.naturalWpm)), 0.5, 2)
        : userSpeed;

      const inputHash = hash(
        text,
        active.id,
        active.voice,
        speed,
        targetWpm,
        padSec,
        scene.hold,
        phraseSplit,
        alignMode,
        phrases.length,
        CLIP_SIGNATURE,
      );
      sceneHashes.push(inputHash);

      // Progress is emitted before the work so the UI shows the scene being spoken.
      report(opts, {
        stage: 'voice',
        pct: (i / total) * 95,
        note: `scene ${i + 1}/${total} · ${active.id}`,
      });

      const ctx: SynthContext = {
        dir,
        speed,
        targetWpm,
        language: out.meta.language,
        padSec,
        chain,
        aligner,
      };

      let timing: SceneTiming | undefined;

      if (!opts.force && (await isFresh(dir, cacheKey, inputHash, [rel, timingRel]))) {
        timing = await readTiming(timingAbs);
        if (timing) {
          log.debug(`scene ${i + 1}: cached (${timing.narrationSec.toFixed(2)}s)`);
        }
      }

      if (!timing) {
        if (!phrases.length) {
          log.warn(
            `scene ${i + 1} (${scene.id}) has no speakable narration — writing a short pause`,
          );
          timing = await synthesizeEmptyScene(scene, i, ctx);
        } else {
          timing = await synthesizeScene(scene, i, phrases, ctx);
        }

        // Re-hash against the provider that actually produced the clip: the chain
        // may have demoted mid-scene, and the cache must reflect reality.
        const finalActive = await chain.active();
        lastProvider = finalActive.id;
        const finalSpeed = finalActive.naturalWpm
          ? clamp(round3(userSpeed * (targetWpm / finalActive.naturalWpm)), 0.5, 2)
          : userSpeed;
        const finalHash = hash(
          text,
          finalActive.id,
          finalActive.voice,
          finalSpeed,
          targetWpm,
          padSec,
          scene.hold,
          phraseSplit,
          alignMode,
          phrases.length,
          CLIP_SIGNATURE,
        );
        sceneHashes[i] = finalHash;
        await writeFile(timingAbs, JSON.stringify(timing, null, 2));
        await markFresh(dir, cacheKey, finalHash);
        log.info(
          `scene ${i + 1}/${total}: ${timing.narrationSec.toFixed(2)}s` +
            (timing.holdSec > 0 ? ` + ${timing.holdSec.toFixed(2)}s hold` : '') +
            ` · ${phrases.length} phrase${phrases.length === 1 ? '' : 's'} → ${rel}`,
        );
      }

      // The file on disk is the source of truth: verify that what we measured in
      // samples matches what a decoder sees, so a bad write cannot desync a video.
      const measured = await measureDuration(abs);
      if (!(measured > 0)) throw new Error(`scene ${i + 1}: synthesised clip has no duration`);
      const expected = timing.narrationSec + timing.holdSec;
      if (Math.abs(measured - expected) > 0.02) {
        log.warn(
          `scene ${i + 1}: clip measures ${measured.toFixed(3)}s but its timing says ${expected.toFixed(3)}s — ` +
            'trusting the file and rescaling',
        );
        const scale =
          timing.narrationSec > 0 ? (measured - timing.holdSec) / timing.narrationSec : 1;
        timing = {
          ...timing,
          narrationSec: Math.max(0.01, measured - timing.holdSec),
          phrases: timing.phrases.map((p) => ({
            ...p,
            start: p.start * scale,
            end: p.end * scale,
          })),
        };
      }

      scene.durationSec = timing.narrationSec;
      scene.audioPath = rel;
      if (timing.words?.length) scene.words = timing.words;
      else delete scene.words;

      /* ------------------------------------------------- cue resolution */

      const { resolved, warnings } = resolveSceneCues(scene, {
        phrases: timing.phrases,
        narrationSec: timing.narrationSec,
        words: timing.words,
        sceneLabel: `${i + 1}:${scene.id}`,
      });
      for (const warning of warnings) log.warn(warning);
      unresolvedCues += warnings.length;
      for (const r of resolved) {
        cueLog.push(r);
        log.debug(
          `scene ${i + 1}: "${r.cue}" → ${r.offsetSec.toFixed(2)}s (at ${r.at}) via ${r.source}`,
        );
      }

      spokenWords += text.split(/\s+/).filter(Boolean).length;
      spokenSeconds += timing.narrationSec;
    }
  } finally {
    await aligner.dispose();
    await chain.dispose();
  }

  /* --------------------------------------------- assemble the single track */

  report(opts, { stage: 'voice', pct: 96, note: 'assembling narration track' });

  const clips = out.scenes.map((scene, i) =>
    path.resolve(dir, scene.audioPath ?? sceneAudioPath(i)),
  );
  const narrationHash = hash(sceneHashes, out.meta.outroSec, CLIP_SIGNATURE);

  if (opts.force || !(await isFresh(dir, 'voice:narration', narrationHash, [NARRATION_FILE]))) {
    const duration = await concatWavs(clips, path.resolve(dir, NARRATION_FILE), out.meta.outroSec);
    await markFresh(dir, 'voice:narration', narrationHash);
    log.info(`narration track: ${duration.toFixed(2)}s → ${NARRATION_FILE}`);
  } else {
    log.debug('narration track: cached');
  }

  // The track must be exactly as long as the timeline the renderer will build
  // from `sceneLength()`. Checking it here turns a silent A/V desync into a line
  // of output.
  const trackSec = await measureDuration(path.resolve(dir, NARRATION_FILE));
  const timelineSec = totalDuration(out);
  if (Math.abs(trackSec - timelineSec) > 0.05) {
    log.warn(
      `narration track is ${trackSec.toFixed(2)}s but the storyboard timeline is ${timelineSec.toFixed(2)}s — ` +
        "the renderer must lay scenes out as durationSec + hold (core's sceneLength) or audio will drift",
    );
  }

  /* --------------------------------------------------------- report quality */

  if (lastProvider === 'system') log.warn(SAY_NOT_FOR_PUBLISHING);

  const wpm = spokenSeconds > 0 ? (spokenWords / spokenSeconds) * 60 : 0;
  if (spokenWords > 20 && wpm > 0) {
    const message = `pace: ${wpm.toFixed(0)} wpm over ${spokenSeconds.toFixed(1)}s of speech (target ${TEACHING_WPM_MIN}-${TEACHING_WPM_MAX})`;
    // The band is checked with a little slack: trailing breath and holds are
    // counted in the seconds, so a compliant run measures slightly slow.
    if (wpm > TEACHING_WPM_MAX + 12 || wpm < TEACHING_WPM_MIN - 25)
      log.warn(`${message} — outside the teaching band`);
    else log.info(message);
  }

  const cued = cueLog.length;
  if (cued) {
    const exact = cueLog.filter((c) => c.source === 'words').length;
    log.info(
      `placed ${cued} element${cued === 1 ? '' : 's'} on their narration cue` +
        (exact ? ` (${exact} word-exact)` : ' (phrase-accurate)'),
    );
  }
  if (unresolvedCues)
    log.warn(`${unresolvedCues} cue warning${unresolvedCues === 1 ? '' : 's'} — see above`);

  const skipped = chain.skipped();
  if (skipped.length) log.debug(`providers skipped: ${skipped.join(', ')}`);

  report(opts, {
    stage: 'voice',
    pct: 100,
    note: `${timelineSec.toFixed(1)}s of narration`,
  });

  return out;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
