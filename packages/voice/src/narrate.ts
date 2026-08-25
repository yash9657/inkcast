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
import type { GateMode, Scene, StageOptions, Storyboard } from '@inkcast/core';
import {
  CADENCE,
  boardMetrics,
  clearFresh,
  estimateDurationFor,
  estimateInkCost,
  gate,
  hash,
  inkPaceFor,
  isFresh,
  logger,
  markFresh,
  normalizeNarration,
  noteProblem,
  readingTail,
  report,
  serializePen,
  totalDuration,
} from '@inkcast/core';
import type { InkPace } from '@inkcast/core';
import {
  appendSilence,
  measureDuration,
  readClipSamples,
  writeClipFromParts,
  writeSilenceWav,
  concatWavs,
} from './audio.js';
import type { ClipPart } from './audio.js';
import { gapAfter, sentenceSpanWarnings, splitPhrases } from './phrase.js';
import type { Phrase, PhraseSplit, PhraseTiming } from './phrase.js';
import { resolveSceneCues } from './cue.js';
import type { CueResolution } from './cue.js';
import { MIN_ALIGN_FRACTION, openAligner, requestedAlign } from './align.js';
import type { AlignMode } from './align.js';
import {
  bareVoiceId,
  openVoiceChain,
  pinnedProvider,
  requestedProvider,
} from './providers/index.js';
import type { ActiveProvider, OpenChainOptions } from './providers/index.js';
import { VOICE_PROVIDER_IDS } from './providers/types.js';
import type { VoiceProviderId, WordTiming } from './providers/types.js';
import { elevenLabsCostUsd } from './providers/elevenlabs.js';
import { SAY_NOT_FOR_PUBLISHING } from './providers/system.js';
import { voiceMood } from './moods.js';
import type { VoiceMoodId } from './moods.js';
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
  /**
   * `strict` promotes this stage's quality warnings to errors — today, an
   * unresolvable cue on a beat's *dominant* visual stops the run instead of
   * keeping an authored fallback time (a decoration's missed cue stays a
   * warning either way). Absent means `degrade`: today's behaviour, with the
   * miss recorded in `ResolvedVoice.problems`.
   */
  gates?: GateMode;
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
  /** Provider-native voice id that actually spoke. */
  voice: string;
  /**
   * The voice that was asked for, when the provider could not use it.
   *
   * Absent on every ordinary run. Present when `voice` above is a substitute — the
   * measured case is a free ElevenLabs plan refusing a pinned library voice with a
   * 402 while every voice in the account's own list works. Both halves are kept
   * because both are true and neither implies the other: the film speaks with one
   * voice and the user asked for another, and a record that carried only one of
   * those cannot be reconciled against either the audio or the settings page.
   */
  substitutedFrom?: string;
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
  /**
   * The curated mood the run was cast in, when `meta.voice` named one. See `moods.ts`.
   *
   * Carried out because it is what the user chose, and neither `voice` nor `provider`
   * can be read back into it: "Calm" is `21m00Tcm4TlvDq8ikWAM` on a paid run and
   * `af_heart` on a local one, and the result UI has to be able to say which mood the
   * film it is showing was made in.
   */
  mood?: VoiceMoodId;
  /**
   * The provider a **whole-film failover** abandoned, when one happened.
   *
   * Set only by the case described on `narrate()`: the run started on one provider,
   * that provider died part-way through, and every scene was re-synthesised from
   * scene 0 on the next one so the film speaks with a single voice. Absent means no
   * failover — which is not the same as `problems` being empty, because a chain that
   * demotes on the *first* phrase of the first scene has always produced a
   * single-voiced film and does not need a restart.
   */
  fellBackFrom?: VoiceProviderId;
  /**
   * Characters synthesised for the film that was actually delivered.
   *
   * The sum of `charsByProvider`, which is a derived number the caller kept
   * re-deriving — `cast.ts` reads one provider's entry out of the map and prices it,
   * and every other consumer that wanted a total wrote its own loop over a
   * `Partial<Record<…>>`. One number, computed where the tally lives.
   */
  chars: number;
  /**
   * What the delivered film cost at list price, in USD. Exactly 0 for a local run.
   *
   * Returned rather than inferred, which is the entire point of this type: the record
   * used to be written from the *request* — a key being present — and `projects/cardiac8`
   * was duly billed $0.4286 for audio a demotion had made free. A caller that reads
   * this number cannot make that mistake, because the only way for it to be non-zero
   * is for a paid provider to have actually spoken.
   */
  costUsd: number;
  /**
   * Characters spoken for an abandoned attempt and thrown away, and what they were
   * worth. Absent when nothing was abandoned.
   *
   * `costUsd` above deliberately excludes them: the user is shown one film, and they
   * are not shown any part of this audio, so it does not price the film. But it is
   * not hidden either — an ElevenLabs partial that died on scene 7 may well have been
   * billed by ElevenLabs, and a spend counter that never hears about it (D6 in
   * `docs/PLAN-LAUNCH.md`) will under-count real money. Two fields, both true, rather
   * than one number that has to be either a lie or a surprise.
   */
  abandonedChars?: number;
  abandonedCostUsd?: number;
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
  /**
   * The hold this stage was **given**, before it added any reading time.
   *
   * The one field here that is an *input* rather than a measurement, and it is
   * recorded because `Scene.hold` is both. The compiler writes a hold; this stage
   * lengthens it so the finished board can be read (plan item 1.3) and writes the
   * longer number back onto the scene; the storyboard is saved. On the next run the
   * scene arrives carrying this stage's own output, and a clip cache key computed
   * from it would miss — re-synthesising, and re-charging for, a film whose
   * narration never moved.
   *
   * So the key is computed from this instead, and the test for "is `scene.hold`
   * mine or the compiler's" is whether it equals the `holdSec` above: our own
   * output, coming back. A recompiled storyboard brings a different number and is
   * correctly treated as new input.
   *
   * Absent on sidecars written before this existed, where `holdSec` is the answer.
   */
  authoredHold?: number;
  phrases: PhraseTiming[];
  words?: WordTiming[];
  /**
   * The local aligner's paired-token fraction, when it ran. Present with an
   * empty/absent `words` exactly when the alignment was discarded for matching
   * too little (`MIN_ALIGN_FRACTION`) — the sidecar says why the scene is
   * phrase-tier rather than leaving it indistinguishable from "never aligned".
   */
  alignFraction?: number;
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

/**
 * How many times the whole film may be re-narrated before the stage stops restarting.
 *
 * A bound, not a policy. Every abandonment consumes one link of the chain permanently
 * — `openVoiceChain` never walks backwards — and the last link is `silence`, which
 * cannot fail, so a run can abandon at most `VOICE_PROVIDER_IDS.length - 1` attempts
 * on its own. Sizing the bound to the chain therefore makes it unreachable in practice
 * while keeping the loop a total function: the alternative is a `while (true)` that a
 * future provider with a stateful failure mode could spin in forever, and the failure
 * mode of *that* is a render that never finishes and never says why.
 *
 * If the bound is ever hit, the final attempt is allowed to run to completion with
 * whatever the chain is on — a film that mixes two voices is bad, and a film missing
 * its last four scenes is worse.
 */
const MAX_VOICE_ATTEMPTS = VOICE_PROVIDER_IDS.length;

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
  /** The compiler's hold, not `scene.hold` — see `SceneTiming.authoredHold`. */
  holdSec: number,
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
    holdSec,
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
  let alignFraction: number | undefined;
  if (!words) {
    const spoken = phrases.map((p) => p.text).join(' ');
    const narrationFrames = Math.round(assembled.narrationSec * CLIP_SAMPLE_RATE);
    const clip = (await readClipSamples(abs)).slice(0, narrationFrames);
    const aligned = await ctx.aligner.align(clip, CLIP_SAMPLE_RATE, spoken);
    // The fraction is kept even when the words are discarded (below the
    // honesty floor) — the sidecar then says *why* the scene is phrase-tier.
    if (aligned.fraction > 0) alignFraction = aligned.fraction;
    if (aligned.words.length) {
      words = aligned.words;
      log.debug(
        `scene ${index + 1}: ${aligned.words.length} word timings from the local aligner ` +
          `(${Math.round(aligned.fraction * 100)}% matched)`,
      );
    }
  }

  return {
    version: 1,
    narrationSec: assembled.narrationSec,
    holdSec: assembled.holdSec,
    authoredHold: holdSec,
    phrases: timings,
    ...(words ? { words } : {}),
    ...(alignFraction !== undefined ? { alignFraction } : {}),
  };
}

/* ------------------------------------------------------------- reading time */

/**
 * Most silence this stage will add to one beat, in seconds.
 *
 * A ceiling because the arithmetic below is an *estimate* of the ink, and an
 * estimate with no bound can turn one over-full beat into a ten-second stare. A
 * beat that wants more than this is a beat with too much in it, which is the
 * element ceiling's problem (plan 1.5) — the renderer will compress the drawing
 * rather than the film growing without limit, and the dwell gate will say so.
 */
const MAX_READING_EXTRA = 5;

/**
 * Lengthen a beat's hold so its finished board can be read before it is wiped.
 *
 * ## Why the voice stage owns this
 *
 * Because it owns clip length. `Scene.hold` is rendered as real silence *inside*
 * the scene's clip, and the narration track is those clips concatenated — so the
 * only stage that can make a beat longer is the one that writes the audio. The
 * renderer, which knows exactly how long the drawing takes, cannot add a second to
 * a beat; it can only decide where inside the beat the marks go.
 *
 * So the two stages split the job. This one buys the time; `serializeScene` in the
 * renderer spends it, reserving the same `readingTail` at the end of every beat.
 * When this estimate is good the reserve comes out of silence and nothing is
 * compressed. When it is low the renderer compresses the drawing a little, which is
 * a graceful degradation rather than a failed gate — the dwell is still there.
 *
 * ## Why it is an estimate
 *
 * The voice stage runs fourth and visuals runs fifth, so there are no prims here to
 * measure; the ink is estimated from the authored boxes (`estimateInkCost`). That
 * ordering is deliberate and cannot be swapped — the renderer needs measured scene
 * durations, which only exist after this stage. See `pipeline/src/progress.ts`.
 *
 * ## Idempotence
 *
 * The extension is appended to a clip that may already carry one. A second run
 * recomputes the same `need`, finds the beat already that long, and appends
 * nothing — which is what makes this safe to do after the freshness marker has been
 * written. `authoredHold` keeps the *cache key* stable across the same two runs.
 */
async function allowReadingTime(
  scene: Scene,
  index: number,
  timing: SceneTiming,
  ctx: {
    dir: string;
    abs: string;
    timingAbs: string;
    pace: InkPace;
    authoredHold: number;
  },
): Promise<SceneTiming> {
  const slots = scene.elements
    .map((el) => ({
      id: el.id,
      at: (el.enter.at ?? 0) * timing.narrationSec,
      dur: estimateDurationFor(el, ctx.pace),
      ink: estimateInkCost(el, ctx.pace),
    }))
    .filter((slot) => slot.ink > 0);
  if (slots.length === 0) return timing;

  const length = timing.narrationSec + timing.holdSec;
  // The last two marks by cue are the last two to finish — the schedule only ever
  // delays, never reorders — so the reader's floor can be computed before it exists.
  const last = [...slots].sort((a, b) => a.at - b.at).slice(-2);
  const words = last.reduce((n, slot) => n + wordsOfElement(scene, slot.id), 0);
  const tail = readingTail(words, length);

  // `wanted`, not `lastFinish`: the beat is already bounded by its own length, so
  // the schedule inside it always *looks* comfortable. What this needs is the time
  // the marks would take if nothing were compressed. See `PenSchedule.wanted`.
  const need = serializePen(slots, { length, speech: timing.narrationSec }).wanted + tail;
  const extra = Math.min(MAX_READING_EXTRA, need - length);
  if (!(extra > 0.02)) return timing;

  await appendSilence(ctx.abs, extra);
  const next: SceneTiming = {
    ...timing,
    holdSec: round3(timing.holdSec + extra),
    authoredHold: ctx.authoredHold,
  };
  await writeFile(ctx.timingAbs, JSON.stringify(next, null, 2));
  log.debug(
    `scene ${index + 1} (${scene.id}): +${extra.toFixed(2)}s so the finished board has ` +
      `${tail.toFixed(2)}s to be read`,
  );
  return next;
}

/** Words a reader has to take in from one element of this scene. */
function wordsOfElement(scene: Scene, id: string): number {
  const el = scene.elements.find((e) => e.id === id);
  return el?.type === 'text' ? el.text.split(/\s+/).filter(Boolean).length : 0;
}

/** A scene with nothing to say still needs a clip, a duration, and its hold. */
async function synthesizeEmptyScene(
  index: number,
  ctx: SynthContext,
  authoredHold: number,
): Promise<SceneTiming> {
  const abs = path.resolve(ctx.dir, sceneAudioPath(index));
  const narrationSec = Math.max(ctx.padSec, 0.6);
  await writeSilenceWav(abs, narrationSec);
  const holdSec = await appendSilence(abs, authoredHold);
  return { version: 1, narrationSec, holdSec, authoredHold, phrases: [] };
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
 *
 * ## One film, one voice
 *
 * `openVoiceChain` demotes **per phrase**, which is the right granularity for staying
 * alive and the wrong one for a finished film: a key that expires on scene 7 of 10
 * produced six scenes in the paid voice and four in the local one, and a listener does
 * not hear a graceful degradation, they hear the narrator being replaced mid-sentence.
 * That run exists on disk (`projects/cardiac8`) and it is the only keyed film this
 * pipeline has ever finished.
 *
 * So a demotion is now a **restart**. The moment the chain reports a fallback the
 * stage discards the attempt in progress — every measurement, the pace statistics, the
 * cue log and, critically, the character tally — and re-narrates from scene 0 with the
 * provider that took over. Nothing about the abandoned attempt reaches the caller
 * except the two `abandoned*` fields that say it happened: `charsByProvider` no longer
 * mentions the provider that quit, so the pipeline's cost line for it is zero without
 * the pipeline needing to know any of this. The clips of the abandoned attempt are
 * still on disk for a moment, but the restart happens *before* they are marked fresh,
 * so nothing can serve them.
 *
 * The reason this is safe rather than merely hopeful is that the provider id is part of
 * every scene's cache key: a cache hit therefore *proves* the clip on disk was made by
 * the attempt's own provider, so "one film, one voice" holds across cached scenes,
 * re-synthesised scenes and restarts alike.
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

  /*
   * How fast the hand draws, per scene — the input to the reading-time arithmetic
   * below (plan 1.3). `boardMetrics` is the same function the renderer derives its
   * own numbers from, so the estimate this stage makes and the schedule the renderer
   * builds are answers to one question rather than two.
   */
  const metrics = boardMetrics(out);
  const boardPace = inkPaceFor(out.meta.style, metrics.scale, out.canvas, metrics.frame);
  const paceFor = (index: number): InkPace => ({
    ...boardPace,
    pxPerUnit: boardPace.basePxPerUnit * (metrics.framing[index]?.camera.zoom ?? 1),
  });

  // A sentence split across two beats is a planner bug that no amount of audio
  // alignment can repair, so it is reported before a single sample is generated.
  for (const warning of sentenceSpanWarnings(out.scenes.map((s) => s.narration))) log.warn(warning);

  /** Per-scene input hashes, folded into the narration-track cache key. */
  const sceneHashes: string[] = [];
  /** The hold each clip actually carries, after reading time. See `narrationHash`. */
  const sceneHolds: number[] = [];
  const cueLog: CueResolution[] = [];
  /** Gated quality defects this run degraded through — carried into `problems`. */
  const gateProblems: string[] = [];
  /** The local aligner's paired fractions, one per scene it ran on. */
  const alignFractions: number[] = [];
  let unresolvedCues = 0;
  /** Cues placed by the legacy phrase search because they carry no index (4.1/4.2). */
  let searchedCues = 0;
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

  /* ------------------------------------------ whole-film failover bookkeeping */

  /**
   * How many demotions the chain had recorded when the current attempt began.
   *
   * The chain demotes *per phrase* — that is what keeps a render alive when a key
   * expires — but a film is not allowed to be half one voice and half another, so
   * this is the watermark the scene loop compares against to notice that the run it
   * is in the middle of is no longer the run it started.
   */
  let fallbacksBefore = chain.fallbacks().length;
  /** Attempts abandoned so far. Bounded — see `MAX_VOICE_ATTEMPTS`. */
  let abandonedAttempts = 0;
  /** The provider the *first* abandoned attempt started on. See `ResolvedVoice.fellBackFrom`. */
  let fellBackFrom: VoiceProviderId | undefined;
  /** Characters spoken for abandoned attempts, and what they were worth at list price. */
  let abandonedChars = 0;
  let abandonedCostUsd = 0;

  try {
    for (let i = 0; i < total; i++) {
      const scene = out.scenes[i]!;
      const text = normalizeNarration(scene.narration);
      const rel = sceneAudioPath(i);
      const timingRel = sceneTimingPath(i);
      const abs = path.resolve(dir, rel);
      const timingAbs = path.resolve(dir, timingRel);
      const cacheKey = `voice:scene:${i}:${scene.id}`;

      /*
       * The hold the *compiler* asked for.
       *
       * `scene.hold` is this stage's own output on any run after the first — it
       * appends reading silence to it (plan 1.3) and the storyboard is saved with
       * the longer number. Keying the clip on that would mean a cache miss on every
       * second run, which on a paid provider is a second bill for identical words.
       * See `SceneTiming.authoredHold`.
       */
      const prior = await readTiming(timingAbs);
      const authoredHold =
        prior?.authoredHold !== undefined && Math.abs(prior.holdSec - scene.hold) < 1e-3
          ? prior.authoredHold
          : scene.hold;

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
          // The compiler's hold, never this stage's extension of it — see above.
          authoredHold,
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
        timing = prior;
        if (timing) {
          log.debug(`scene ${i + 1}: cached (${timing.narrationSec.toFixed(2)}s)`);
        }
      }

      if (!timing) {
        if (!phrases.length) {
          log.warn(
            `scene ${i + 1} (${scene.id}) has no speakable narration — writing a short pause`,
          );
          timing = await synthesizeEmptyScene(i, ctx, authoredHold);
        } else {
          timing = await synthesizeScene(scene, i, phrases, ctx, authoredHold);
        }

        /* ------------------------------------------------ whole-film failover */

        // Nothing below this point has been written to the cache yet, which is what
        // makes the restart clean *for the clip this attempt just wrote* — it is not
        // marked fresh, so the next attempt re-synthesises it rather than trusting a
        // file that may be half one voice and half another.
        //
        // That was only ever half the story, and the other half is audit N-2: the clip
        // this attempt wrote **overwrote** whatever was there, and what was there may
        // have been a perfectly good cached clip under the fallback provider's own key,
        // whose freshness marker and sidecar still describe it. The restart then finds
        // that entry fresh, skips the scene, and reads a sidecar that describes a file
        // that no longer exists — which is the mismatch the rescale above then has to
        // repair, on every render, forever. See `clearFresh` below.
        if (
          abandonedAttempts + 1 < MAX_VOICE_ATTEMPTS &&
          chain.fallbacks().length > fallbacksBefore
        ) {
          const fell = chain.fallbacks()[fallbacksBefore]!;
          abandonedAttempts++;
          fallbacksBefore = chain.fallbacks().length;
          fellBackFrom ??= fell.from;

          // The bill for what is being thrown away, taken before the tally is cleared.
          // It is not charged to the film — see `ResolvedVoice.abandonedCostUsd` — but it
          // is not forgotten either, because ElevenLabs may well have charged us for it.
          const lost = spoken.get(fell.from) ?? 0;
          abandonedChars += lost;
          if (fell.from === 'elevenlabs')
            abandonedCostUsd += elevenLabsCostUsd(lost, engines.get('elevenlabs'));

          log.warn(
            `${fell.from} failed at scene ${i + 1}/${total} (${fell.reason}) — re-synthesising the ` +
              `whole film with ${fell.to} from scene 1, so it speaks with one voice. ` +
              `${lost} character${lost === 1 ? '' : 's'} of ${fell.from} audio are discarded and billed to nobody.`,
          );
          report(opts, {
            stage: 'voice',
            pct: 0,
            note: `${fell.from} failed — re-narrating all ${total} scene${total === 1 ? '' : 's'} with ${fell.to}`,
          });

          // The clip this attempt wrote is not the clip any cache entry describes, so
          // the entry goes (audit N-2). Only this scene's: every earlier scene in the
          // abandoned attempt was written *and* re-keyed together at the bottom of this
          // block, so its marker, sidecar and file already agree with each other — and
          // they will miss on the restart anyway, under a provider that is no longer
          // the one that spoke. This is the one scene whose three could disagree.
          await clearFresh(dir, cacheKey);

          // Everything measured under the old provider is void, including the pace and
          // cue statistics: they describe audio that will not be in the film.
          sceneHashes.length = 0;
          cueLog.length = 0;
          gateProblems.length = 0;
          alignFractions.length = 0;
          unresolvedCues = 0;
          searchedCues = 0;
          spokenWords = 0;
          spokenSeconds = 0;
          spoken.clear();
          engines.clear();

          // Back to scene 0. `i = -1` and `continue` rather than a nested attempt loop
          // because the alternative is re-indenting this whole body for a case that
          // fires once in the life of a run; the accumulators reset just above are the
          // entire state of an attempt, and `sceneHashes` being empty is the invariant
          // that says so.
          i = -1;
          continue;
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
        const mismatch =
          `scene ${i + 1} (${scene.id}): clip measures ${measured.toFixed(3)}s but its timing says ` +
          `${expected.toFixed(3)}s — trusting the file and rescaling the sidecar to match`;
        log.warn(mismatch);
        // Recorded, not just said (plan 9.3, audit X-d). This warning is the only
        // thing that ever announces the repair below, and for two days it was a
        // `log.warn` with no `onProblem` beside it while the repair was silently
        // getting the word stream wrong — see the note on `words` below.
        noteProblem(opts, mismatch);

        // **Every** field measured against the old duration is rescaled, `words`
        // included (plan 9.1, audit N-1). This block used to rewrite `narrationSec`
        // and `phrases` and pass `words` through untouched, which left the two on
        // different scales eleven lines before `resolveSceneCues` is handed both:
        // `enter.at` came out as unrescaled-word-start ÷ rescaled-duration, so every
        // reveal in the scene fired late by exactly the ratio between them. Measured
        // on `qc81-longitude` scene `s0` at 0.57s and 1.06s late, on a run that
        // passed all 20 QC checks — the D5 defect, produced by the repair pass that
        // exists to prevent it. Nothing caught it because `overrunViolations` checks
        // plan items derived from the very fractions this corrupts.
        //
        // The scale is taken against the *clamped* narration length rather than the
        // raw difference, so words and `narrationSec` cannot disagree even when a
        // clip is shorter than its own hold.
        const narrationSec = Math.max(0.01, measured - timing.holdSec);
        const scale = timing.narrationSec > 0 ? narrationSec / timing.narrationSec : 1;
        const rescale = <T extends { start: number; end: number }>(t: T): T => ({
          ...t,
          start: t.start * scale,
          end: t.end * scale,
        });
        timing = {
          ...timing,
          narrationSec,
          phrases: timing.phrases.map(rescale),
          ...(timing.words ? { words: timing.words.map(rescale) } : {}),
        };

        // Repaired on disk, not just in memory. The sidecar is what the next run
        // reads on a cache hit, so leaving it describing a clip that is no longer
        // there means re-deriving this repair on every render for the life of the
        // project — and it means the mismatch that produced it stays invisible to
        // anything that reads the project rather than watching the render.
        await writeFile(timingAbs, JSON.stringify(timing, null, 2));
      }

      // The check that would have caught N-1, standing between the repair and the
      // cue resolution that consumes it.
      //
      // The audit's question about its own miss was "why did nothing catch this", and the
      // answer was that nothing in the repo compared a scene's word stream to the length
      // of the clip it describes. `overrunViolations` checks plan items, which are derived
      // from the very `enter.at` fractions the defect corrupts, so the fraction is in range
      // and the item is in range; `MIN_ALIGN_FRACTION` guards the aligner's honesty about a
      // transcript, not a sidecar's honesty about a file. This is that missing comparison,
      // and it is one subtraction.
      //
      // It is not dead code behind the rescale above. A provider's own timings arrive on
      // the provider's clock (`SynthesisResult.words`), and a clip assembled from parts is
      // measured after the fact — so "the words are inside the audio" is a property worth
      // asserting whatever produced them, not only after a repair.
      // Bound to a local because `timing` is reassigned further down (the reading-time
      // extension), which stops the compiler narrowing it inside a closure.
      const narrationSec = timing.narrationSec;
      const overrunWords = (timing.words ?? []).filter((w) => w.end > narrationSec + 1e-6);
      if (overrunWords.length > 0) {
        const last = overrunWords[overrunWords.length - 1] as WordTiming;
        gateProblems.push(
          `scene ${i + 1} (${scene.id}): ${overrunWords.length} of ${timing.words?.length} word ` +
            `timings end after the narration does — "${last.word}" at ${last.end.toFixed(2)}s ` +
            `against ${timing.narrationSec.toFixed(2)}s of audio. Every reveal cued on a word ` +
            'past the end fires late, and the fractions stay in range so no board assertion ' +
            'can see it (audit N-1)',
        );
      }

      scene.durationSec = timing.narrationSec;
      scene.audioPath = rel;
      if (timing.words?.length) scene.words = timing.words;
      else delete scene.words;

      /* ------------------------------------------------- cue resolution */

      if (timing.alignFraction !== undefined) {
        alignFractions.push(timing.alignFraction);
        if (timing.alignFraction < MIN_ALIGN_FRACTION) {
          gateProblems.push(
            `scene ${i + 1} (${scene.id}): word alignment matched only ` +
              `${Math.round(timing.alignFraction * 100)}% of the narration and was discarded — ` +
              'cues in this scene are placed by measured phrase boundaries',
          );
        }
      }

      const { resolved, warnings, dominantMisses, searched, brokenIndices } = resolveSceneCues(
        scene,
        {
          phrases: timing.phrases,
          narrationSec: timing.narrationSec,
          words: timing.words,
          sceneLabel: `${i + 1}:${scene.id}`,
        },
      );
      for (const warning of warnings) log.warn(warning);
      // An authored cue index that does not name its own cue's first word (plan
      // item 4.1). Not a degradation — the compiler writes the index against the
      // narration in the same pass, so the only ways to get here are narration
      // edited without recompiling and two tokenisers disagreeing, and both are
      // bugs. Strict stops; degrade places the reveal by search and keeps the
      // reason where `pipeline.json` will show it.
      for (const broken of brokenIndices) {
        gateProblems.push(broken);
        log.warn(broken);
        gate(opts.gates, broken, () => {});
      }
      // Cues with no index at all: a storyboard compiled before 4.1. The film is
      // fine — this is the search that has always placed them — but it is recorded
      // rather than logged (plan item 4.2) so "how many reveals in this film were
      // anchored by a search" is answerable after the run, which is what decides
      // when the fallback can be deleted.
      searchedCues += searched.length;
      // A missed cue on the beat's MAIN picture is the D5 defect, not a nuance:
      // the dominant visual keeps an authored fallback time while the narration
      // names it somewhere else. Strict stops here; degrade records it where
      // `pipeline.json` will keep it. (Decorations stay warnings either way.)
      for (const miss of dominantMisses) {
        const message =
          `scene ${i + 1} (${scene.id}): cue "${miss.cue}" on the beat's dominant visual ` +
          `"${miss.elementId}" does not appear in its narration — the main picture keeps ` +
          'an authored fallback time instead of landing on its words';
        gateProblems.push(message);
        // The generic per-cue warning was already logged above; nothing to repeat.
        gate(opts.gates, message, () => {});
      }
      unresolvedCues += warnings.length;
      for (const r of resolved) {
        cueLog.push(r);
        log.debug(
          `scene ${i + 1}: "${r.cue}" → ${r.offsetSec.toFixed(2)}s (at ${r.at}) via ${r.source}`,
        );
      }

      /* ------------------------------------------------- reading time */

      timing = await allowReadingTime(scene, i, timing as SceneTiming, {
        dir,
        abs,
        timingAbs,
        pace: paceFor(i),
        authoredHold,
      });
      scene.hold = round3(timing.holdSec);
      sceneHolds.push(scene.hold);

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
  /*
   * The clips' own keys, plus the holds they ended up with.
   *
   * The holds are folded in separately because they are not in a clip's key: the
   * reading-time extension (`allowReadingTime`) is a function of the *elements* on
   * the board, and a clip is keyed on the narration. So a storyboard edit that adds
   * a mark to a beat without touching a word lengthens every clip in it and leaves
   * `sceneHashes` untouched — and the assembled track would stay fresh while every
   * file under it had grown.
   */
  const narrationHash = hash(sceneHashes, sceneHolds, out.meta.outroSec, CLIP_SIGNATURE);

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

  /*
   * The provider that was asked for and never reached — the missing signal.
   *
   * A demotion (above) is loud because it is an event: something spoke, then
   * stopped. A *rejection* is a non-event, and non-events do not report
   * themselves: the chain simply walked past its own head and the run went on
   * looking completely ordinary. That is how "ElevenLabs was never getting
   * caught" was true and invisible at the same time — the key was in the vault,
   * the vault had not been hydrated into `process.env` on this code path
   * (`apps/web/lib/keys.ts` is the other half of that fix), `available()`
   * returned false, and one `log.debug` line was the entire record.
   *
   * Only the head of the chain, and only when something else actually spoke:
   * every unkeyed run in the project's history rejects ElevenLabs on the way
   * past, and a line that appears on every local render is a line nobody reads.
   */
  for (const r of chain.rejections()) {
    if (!r.preferred || r.id === resolved.id) continue;
    problems.push(
      `${r.id} was skipped at startup: ${r.reason} — this film is narrated by ${resolved.id}`,
    );
  }

  /*
   * The voice that was asked for and refused.
   *
   * The provider did not change and nothing failed, so none of the machinery above
   * fires — which is precisely why this was invisible. The `calm` mood pins Rachel,
   * a free ElevenLabs plan 402s that library voice, the adapter substituted one the
   * account can use, the film came out fine, and `pipeline.json` went on recording
   * Rachel from a `Map` that lived and died inside the adapter's closure.
   */
  for (const s of chain.substitutions()) {
    problems.push(`${s.why} — spoke with ${s.toName ? `"${s.toName}" (${s.to})` : s.to} instead`);
  }
  // Quality defects the run degraded through — dominant-visual cue misses,
  // discarded low-match alignments. Under strict none of these are reachable
  // (the gate threw); under degrade they are exactly what makes it honest.
  problems.push(...gateProblems);
  // The one-release fallback, said out loud (plan items 4.1 and 4.2). A cue with no
  // index was placed by the phrase search: exact, then a 50% prefix, then an
  // in-order fuzzy window — tolerances that can anchor a reveal to the second
  // occurrence of a phrase and only ever said "matched loosely" about it. The film
  // is not broken; the storyboard is old, and recompiling it is the fix. Recorded
  // rather than logged because the count is what decides when the search goes.
  if (searchedCues) {
    problems.push(
      `${searchedCues} reveal${searchedCues === 1 ? ' was' : 's were'} anchored by searching for ` +
        `their cue phrase instead of by word index — this storyboard was compiled before ` +
        `enter.cueWord existed. Recompile it (cast --force, or delete storyboard.json) for ` +
        `word-exact placement`,
    );
  }
  // Said separately from the fallback lines above because it is a different fact, and
  // the one the person watching is owed: not "a provider failed" but "this film is
  // narrated locally, all of it, and you were not charged". The result UI shows this
  // string; `docs/PLAN-LAUNCH.md` A5 calls the version of this that stayed silent the
  // dominant failure mode of the whole pipeline.
  if (fellBackFrom) {
    // "Narrated locally" is the copy the plan asks for, and it is only said when it is
    // true: every fallback from the paid provider does land on a local engine, but the
    // unkeyed chain can also demote *towards* ElevenLabs (kokoro → system → elevenlabs),
    // and claiming a local render there would be the same class of lie in reverse.
    const where = resolved.id === 'elevenlabs' ? 'renarrated in the cloud' : 'narrated locally';
    problems.push(
      `${where}: ${fellBackFrom} failed part-way through, so all ${total} scene${
        total === 1 ? '' : 's'
      } were re-narrated with ${resolved.id} for one consistent voice, and the ` +
        `${abandonedChars} discarded character${abandonedChars === 1 ? '' : 's'} are billed at $0`,
    );
  }
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
    // How many landed on a word the compiler named, rather than on a word this
    // stage went looking for. The step-8 done-bar is this number being all of them.
    const indexed = cueLog.filter((c) => c.via === 'index').length;
    // The adjective is earned, not asserted: when the local aligner provided the
    // word timings, say how much of the text it actually matched. Provider-native
    // timings (no fraction recorded) are exact by construction.
    const meanFraction = alignFractions.length
      ? alignFractions.reduce((a, b) => a + b, 0) / alignFractions.length
      : undefined;
    log.info(
      `placed ${cued} element${cued === 1 ? '' : 's'} on their narration cue` +
        (exact
          ? ` (${exact} word-anchored${
              meanFraction === undefined
                ? ''
                : `, alignment matched ${Math.round(meanFraction * 100)}% of tokens`
            })`
          : ' (phrase-accurate)') +
        `, ${indexed}/${cued} by authored word index`,
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
  // The bare id, so `kokoro:calm` — a mood pinned to the free provider — is still a mood.
  const mood = voiceMood(bareVoiceId(requestedVoice));
  const voice: ResolvedVoice = {
    provider: resolved.id,
    label: resolved.label,
    // The voice that *spoke*, which is not always the one that resolved. The cache
    // keys upstream deliberately still use `resolved.voice` — see `ActiveProvider` —
    // and this is the one place the two are allowed to differ.
    voice: resolved.spokenVoice ?? resolved.voice,
    ...(resolved.spokenVoice ? { substitutedFrom: resolved.voice } : {}),
    ...(resolved.model ? { model: resolved.model } : {}),
    charsByProvider,
    modelByProvider,
    // A provider resolves on every run, cached or not — for ElevenLabs that is a
    // network call to map the voice id — so "which provider is active" is not the
    // same question as "who spoke". Reporting the first as the second would be a
    // smaller version of the lie this whole return value exists to correct.
    spoke: spoken.size > 0,
    problems,
    ...(mood ? { mood: mood.id } : {}),
    ...(fellBackFrom ? { fellBackFrom } : {}),
    chars: [...spoken.values()].reduce((a, n) => a + n, 0),
    // The one number a caller must never compute for itself, and the only provider in
    // the chain that can make it non-zero. Derived from the *delivered* tally, which a
    // whole-film failover has already emptied of the abandoned attempt — so a film
    // that fell back to the local engine costs exactly zero here, by construction
    // rather than by a special case somebody has to remember to write.
    costUsd: elevenLabsCostUsd(spoken.get('elevenlabs') ?? 0, engines.get('elevenlabs')),
    ...(abandonedChars > 0 ? { abandonedChars, abandonedCostUsd: round4(abandonedCostUsd) } : {}),
  };
  if (voice.spoke) {
    log.info(
      `spoken by ${[...spoken].map(([id, n]) => `${id} (${n} characters)`).join(', ')}` +
        (voice.model ? ` · ${voice.model}` : ''),
    );
  }
  if (voice.abandonedChars) {
    log.warn(
      `${voice.abandonedChars} characters were synthesised for an abandoned attempt and thrown ` +
        `away (list value $${(voice.abandonedCostUsd ?? 0).toFixed(4)}) — not billed to this film, ` +
        'but a provider may still have charged for them',
    );
  }

  return { storyboard: out, voice };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Money, at the precision the cost report already uses. */
function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
