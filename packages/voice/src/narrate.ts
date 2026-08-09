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
import { CADENCE, hash, isFresh, logger, markFresh, report, totalDuration } from '@inkcast/core';
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
import {
  bareVoiceId,
  openVoiceChain,
  pinnedProvider,
  requestedProvider,
} from './providers/index.js';
import type { ActiveProvider, OpenChainOptions } from './providers/index.js';
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
  /** How a provider is built. Test seam only — see `OpenChainOptions.create`. */
  createProvider?: OpenChainOptions['create'];
};

/**
 * Which provider actually spoke, and what it spoke.
 *
 * The record downstream is only as honest as this: `pipeline.json` used to be written
 * from the environment-derived *request* — a key being set — so a run that fell back
 * to the free local engine still reported `elevenlabs` and was billed $0.4286 for
 * audio that cost nothing. That is `projects/cardiac8`, and it really did fall back:
 * see the reconstruction in `@inkcast/pipeline`'s `resolvedVoiceChoice`. Everything
 * here is observed rather than intended.
 */
export type ResolvedVoice = {
  /** The provider that spoke last, or the one that resolved when nothing was spoken. */
  provider: VoiceProviderId;
  label: string;
  /** Provider-native voice id in force. */
  voice: string;
  /** The engine, when the provider names one. */
  model?: string;
  /**
   * Characters synthesised **per provider** this run.
   *
   * A map rather than a number because quota exhaustion is discovered at the first
   * `synthesize` and not before it: a run can genuinely be part paid and part free,
   * and both the record and the bill have to be able to say so.
   */
  charsByProvider: Partial<Record<VoiceProviderId, number>>;
  /**
   * The engine each provider spoke with, for the providers that spoke.
   *
   * `model` above names only the provider that finished, which is the wrong engine to
   * price a mixed run with: after a demotion the characters that cost money were
   * spoken by ElevenLabs and the surviving `model` is Kokoro's. Billing then had no
   * engine to look up and fell back to the full credit rate — a 2× error on the one
   * scenario the fallback path exists for. Keyed by provider so the bill can ask the
   * one that spent the money what it was running.
   */
  modelByProvider: Partial<Record<VoiceProviderId, string>>;
  /** True when at least one character was actually synthesised this run. */
  spoke: boolean;
  /** Fallbacks, in the `string[]` shape `LessonSummary.problems` already uses. */
  problems: string[];
};

export type NarrateResult = {
  storyboard: Storyboard;
  voice: ResolvedVoice;
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
  /** Verbatim phrases of this scene's narration that carry its weight. */
  emphasis: readonly string[];
  language: string;
  padSec: number;
  chain: ReturnType<typeof openVoiceChain>;
  aligner: ReturnType<typeof openAligner>;
  /**
   * Characters billed to each provider, tallied here rather than by the caller.
   *
   * The pipeline cannot compute this: it has its own scene cache, keyed on different
   * material from the stage's, so a scene can be stale to the pipeline and fresh here
   * — and counting its narration would bill for audio nobody synthesised. This is the
   * only place that knows a request was made.
   */
  spoken: Map<VoiceProviderId, number>;
  /** The engine each provider was running when it spoke. See `ResolvedVoice.modelByProvider`. */
  engines: Map<VoiceProviderId, string>;
};

/**
 * How much a phrase carrying emphasis is slowed, and how much extra room it gets
 * after it.
 *
 * Emphasis is *time*, not volume. No local voice this pipeline can run accepts SSML —
 * Kokoro takes a speed and nothing else — so getting louder is not available, and a
 * gain applied to the samples afterwards would be an artefact rather than a delivery.
 * What is available is exactly what a person actually does with a phrase that
 * matters: slow down over it and leave a moment after it.
 *
 * Both numbers are small on purpose. This lands on a *clause*, because clauses are
 * the unit the clip is already assembled from, so a heavy hand here does not stress a
 * word — it drags a whole sentence.
 */
const EMPHASIS_SLOWDOWN = 0.92;
const EMPHASIS_EXTRA_GAP = 0.18;

/** Does this phrase contain any of the scene's emphasised spans? */
function carriesEmphasis(phrase: string, emphasis: readonly string[]): boolean {
  if (!emphasis.length) return false;
  const haystack = phrase.toLowerCase();
  return emphasis.some((e) => haystack.includes(e.trim().toLowerCase()));
}

/**
 * How much narration on either side of a phrase is offered as context.
 *
 * Enough to place the clause inside its sentence and the sentence inside its beat, and
 * no more: what an engine does with this is choose an intonation contour, and a
 * paragraph of it is neither more informative than a sentence nor free — it is billed
 * as input on every clause of every scene.
 */
const CONTEXT_CHARS = 300;

/**
 * The words either side of `phrases[i]`, for an engine that can read them.
 *
 * Whole phrases, not a character slice: a fragment cut mid-word ("…the elect") is worse
 * context than none, because it is not language. Taken from the same already-normalised
 * text the clips are made of, so what the engine is told came before really is what the
 * listener will have just heard.
 */
function neighbours(
  phrases: readonly Phrase[],
  i: number,
): { previousText?: string; nextText?: string } {
  const take = (parts: string[], fromEnd: boolean): string | undefined => {
    const kept: string[] = [];
    let budget = CONTEXT_CHARS;
    for (const part of fromEnd ? [...parts].reverse() : parts) {
      if (part.length > budget) break;
      budget -= part.length + 1;
      if (fromEnd) kept.unshift(part);
      else kept.push(part);
    }
    return kept.length ? kept.join(' ') : undefined;
  };
  return {
    previousText: take(
      phrases.slice(0, i).map((p) => p.text),
      true,
    ),
    nextText: take(
      phrases.slice(i + 1).map((p) => p.text),
      false,
    ),
  };
}

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
      const stressed = carriesEmphasis(phrase.text, ctx.emphasis);
      const result = await ctx.chain.synthesize({
        text: phrase.text,
        ...neighbours(phrases, i),
        speed: stressed ? round3(ctx.speed * EMPHASIS_SLOWDOWN) : ctx.speed,
        targetWpm: stressed ? Math.round(ctx.targetWpm * EMPHASIS_SLOWDOWN) : ctx.targetWpm,
        language: ctx.language,
        outPath: tmp,
      });
      // Per phrase, not per scene: `demote()` can fire between two clauses of one
      // scene, which is the same reason the scene's hash is re-taken below.
      const spokeIt = result.provider.id;
      // `billedChars` when the provider spent more than one generation on this phrase
      // — see `SynthesisResult.billedChars`. `text.length` is the one-to-one case.
      ctx.spoken.set(
        spokeIt,
        (ctx.spoken.get(spokeIt) ?? 0) + (result.billedChars ?? phrase.text.length),
      );
      if (result.provider.model) ctx.engines.set(spokeIt, result.provider.model);

      const samples = await readClipSamples(tmp);
      const bounds = findSpeechBounds(samples, CLIP_SAMPLE_RATE);
      const trimmed = samples.slice(bounds.start, bounds.end);
      const trimStartSec = bounds.start / CLIP_SAMPLE_RATE;

      parts.push({
        samples: trimmed.length ? trimmed : samples,
        // The moment after the phrase that mattered. Added to the clause gap rather
        // than replacing it, so punctuation still does its own work.
        gapSec: gapAfter(phrase, phrases[i + 1]) + (stressed ? EMPHASIS_EXTRA_GAP : 0),
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
 *
 * Returns the enriched storyboard **and** what actually spoke. The second half is
 * not decoration: the chain has always reported which provider produced each phrase
 * and this stage used to drop it on the floor, so every consumer downstream had to
 * infer the provider from the environment — and was wrong whenever the chain
 * demoted.
 */
export async function narrate(
  sb: Storyboard,
  dir: string,
  opts: NarrateOptions = {},
): Promise<NarrateResult> {
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
  const alignMode = opts.align ?? requestedAlign();
  const total = out.scenes.length;

  const chain = openVoiceChain({
    // An explicit `--provider` first, then a `kokoro:`/`elevenlabs:` prefix on the voice
    // id, then whatever the environment implies (a key means the paid voice).
    preferred: requestedProvider(opts.provider) ?? pinnedProvider(requestedVoice),
    requestedVoice: bareVoiceId(requestedVoice),
    log,
    ...(opts.createProvider ? { create: opts.createProvider } : {}),
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
  let lastActive: ActiveProvider | undefined;
  /** The provider the run is reported against, captured before the chain is disposed. */
  let resolved: ActiveProvider;
  /** Characters synthesised per provider. See `SynthContext.spoken`. */
  const spoken = new Map<VoiceProviderId, number>();
  /** The engine each of them was running. See `ResolvedVoice.modelByProvider`. */
  const engines = new Map<VoiceProviderId, string>();

  try {
    for (let i = 0; i < total; i++) {
      const scene = out.scenes[i]!;
      const text = normalizeNarration(scene.narration);
      const rel = sceneAudioPath(i);
      const timingRel = sceneTimingPath(i);
      const abs = path.resolve(dir, rel);
      const timingAbs = path.resolve(dir, timingRel);
      const cacheKey = `voice:scene:${i}:${scene.id}`;

      const active = await chain.active();
      lastActive = active;
      // The engine decides how much text it needs to sound like a person, because only it
      // knows whether it can be told what surrounds a fragment. An explicit `--phrase-split`
      // still wins; absent that, a local engine with no context window gets whole sentences
      // rather than four-word clauses read cold. See `VoiceProvider.preferredSplit`.
      const mode: PhraseSplit = opts.phraseSplit ?? active.preferredSplit ?? 'clause';
      const phrases = splitPhrases(text, { mode });
      // This scene's own rate. `cadence` is the storyboard's single pacing decision —
      // it also fixed `scene.hold`, upstream — so a beat written to be delivered
      // quickly is spoken quickly *and* left quickly, rather than the two being set
      // by stages that never meet. Absent cadence is the old behaviour exactly.
      const sceneWpm = scene.cadence
        ? clamp(round3(targetWpm * CADENCE[scene.cadence].rate), 80, 260)
        : targetWpm;
      // Speed is derived, not assumed: dividing the target rate by the voice's
      // measured baseline is the only way "140-160 wpm" becomes true rather than
      // aspirational. Providers that set an absolute rate ignore it.
      const speed = active.naturalWpm
        ? clamp(round3(userSpeed * (sceneWpm / active.naturalWpm)), 0.5, 2)
        : userSpeed;

      const sceneKey = (id: string, voice: string, rate: number, delivery: string): string =>
        hash(
          text,
          id,
          voice,
          rate,
          sceneWpm,
          padSec,
          scene.hold,
          // The *effective* mode, not the requested one: a clip synthesised as clauses is
          // different audio from the same words synthesised as sentences, and keying on the
          // request would serve the choppy one forever after the provider changed its mind.
          mode,
          alignMode,
          phrases.length,
          // Emphasis changes the audio — a phrase carrying it is slowed and given a
          // longer beat after it — so it belongs in the key or a re-emphasised lesson
          // reuses the clip that ignored it.
          scene.emphasis.join('|'),
          CLIP_SIGNATURE,
          // How the clip is *delivered*, which the stage does not otherwise own: an
          // adapter decides the voice settings, the engine, and whether it is told what
          // surrounds a clause, and each changes the audio for narration that never
          // moved. Taken from the provider that is speaking rather than imported from
          // one of them — a Kokoro clip used to be keyed on an ElevenLabs constant.
          delivery,
        );

      const inputHash = sceneKey(active.id, active.voice, speed, active.delivery ?? '');
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
        targetWpm: sceneWpm,
        emphasis: scene.emphasis,
        language: out.meta.language,
        padSec,
        chain,
        aligner,
        spoken,
        engines,
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
        lastActive = finalActive;
        const finalSpeed = finalActive.naturalWpm
          ? clamp(round3(userSpeed * (sceneWpm / finalActive.naturalWpm)), 0.5, 2)
          : userSpeed;
        // The same key, re-taken against the provider that actually spoke — not a second
        // copy of it. Two copies is what this was, and the warning not to let them drift
        // was not enough: a delivery field added above and missed here marked every clip
        // stale on the next run, because the hash written to disk could no longer match
        // the one looked up. The only field that may differ between the two calls is the
        // provider, which is the entire point of re-taking it.
        const finalHash = sceneKey(
          finalActive.id,
          finalActive.voice,
          finalSpeed,
          finalActive.delivery ?? '',
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
    // Asked for here, inside the `try`: after `dispose()` the same question reloads a
    // model from scratch to answer it. `lastActive` is already set for any storyboard
    // with a scene in it, so this only resolves for one with none.
    resolved = lastActive ?? (await chain.active());
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

  if (resolved.id === 'system') log.warn(SAY_NOT_FOR_PUBLISHING);

  // Loud, and in two places, because one of them is read after the run is over: a
  // demotion is spoken to stderr *and* carried out of the stage so the record can
  // keep it. Quota exhaustion mid-run used to degrade to the free voice with nothing
  // in the summary and a bill that still said the paid one.
  const problems = chain
    .fallbacks()
    .map((f) => `voice fell back to ${f.to} (${f.from}: ${f.reason})`);
  for (const line of problems) log.warn(line);

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

  const charsByProvider = Object.fromEntries(spoken) as ResolvedVoice['charsByProvider'];
  const modelByProvider = Object.fromEntries(engines) as ResolvedVoice['modelByProvider'];
  const voice: ResolvedVoice = {
    provider: resolved.id,
    label: resolved.label,
    voice: resolved.voice,
    ...(resolved.model ? { model: resolved.model } : {}),
    charsByProvider,
    modelByProvider,
    // A provider resolves on every run, cached or not — for ElevenLabs that is a
    // network call to map the voice id — so "which provider is active" is not the
    // same question as "who spoke". Reporting the first as the second would be a
    // smaller version of the lie this whole return value exists to correct.
    spoke: spoken.size > 0,
    problems,
  };
  if (voice.spoke) {
    log.info(
      `spoken by ${[...spoken].map(([id, n]) => `${id} (${n} characters)`).join(', ')}` +
        (voice.model ? ` · ${voice.model}` : ''),
    );
  }

  return { storyboard: out, voice };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
