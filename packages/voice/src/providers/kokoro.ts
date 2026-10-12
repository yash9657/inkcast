/**
 * Kokoro-82M ONNX via `kokoro-js` — the local, free, offline default.
 *
 * Two things matter here beyond "call generate":
 *
 * 1. **The model is loaded once per process.** Kokoro's q8 weights are ~92 MB;
 *    reloading them per scene would dominate the runtime of the whole pipeline.
 *    The promise is memoised at module scope and keyed by model + dtype.
 * 2. **Weights are cached outside `projects/`.** They are shared across every
 *    project, so they live in a repo-level `.models/` directory (already
 *    gitignored) rather than inside a per-project working directory.
 *
 * The one-time download is the single place the "zero network" goal cannot be
 * met. It is handled explicitly: progress is reported, and a failure is a warning
 * that hands over to the next provider in the chain, never a crash.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@inkcast/core';
import { clipWavFromFloat32 } from '../wav.js';
import { voiceMood } from '../moods.js';
import { splitSentences } from '@inkcast/core';
import { TEACHING_VOICE, voiceProfile } from '../voices.js';
import type { SynthesisRequest, SynthesisResult, VoiceProvider } from './types.js';

const log = logger('voice:kokoro');

/** Confirmed model id — hard-coded in kokoro-js itself. */
export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** `fp32 | fp16 | q8 | q4 | q4f16`. q8 is the best size/quality tradeoff. */
export type KokoroDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
const DTYPES: readonly KokoroDtype[] = ['fp32', 'fp16', 'q8', 'q4', 'q4f16'];

/**
 * The 28 voice ids kokoro-js actually validates. The package ships 54 `.bin`
 * files, but `_validate_voice()` only accepts the `a` (American) and `b`
 * (British) language prefixes — offering the rest would hand users a hard error.
 */
export const KOKORO_VOICES = [
  'af_heart',
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_emma',
  'bf_isabella',
  'bf_alice',
  'bf_lily',
  'bm_george',
  'bm_lewis',
  'bm_daniel',
  'bm_fable',
] as const;

/**
 * The teaching default, chosen by measuring every voice graded C or better
 * rather than by taking the package default — see `voices.ts` for the experiment
 * and the numbers. It resolves to `af_heart`: Kokoro's grade-A flagship, warm,
 * with the steadiest level of the top tier.
 */
export const KOKORO_DEFAULT_VOICE = TEACHING_VOICE;

/** Kokoro's ONNX decoder degrades on very long inputs; chunk on sentences. */
const MAX_CHUNK_CHARS = 320;

/* ------------------------------------------------------------- model cache */

function repoRoot(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/**
 * Where transformers.js caches weights. Its own default is `./.cache`, relative
 * to the *current working directory*, which would scatter 92 MB downloads
 * wherever the CLI happened to be invoked from.
 */
export function modelCacheDir(): string {
  const override = process.env.INKCAST_MODEL_CACHE;
  if (override) return path.resolve(override);
  const root = repoRoot();
  if (root) return path.join(root, '.models');
  return path.join(os.homedir(), '.cache', 'inkcast', 'models');
}

function isOffline(): boolean {
  const v = process.env.INKCAST_OFFLINE;
  return v === '1' || v === 'true';
}

/* -------------------------------------------------- minimal structural types */

type RawAudioLike = { audio: Float32Array; sampling_rate: number };

type KokoroTTSLike = {
  voices?: Record<string, unknown>;
  generate(text: string, opts: { voice: string; speed?: number }): Promise<RawAudioLike>;
};

type KokoroModule = {
  KokoroTTS: {
    from_pretrained(
      id: string,
      opts: {
        dtype: KokoroDtype;
        device: 'cpu';
        progress_callback?: (p: unknown) => void;
      },
    ): Promise<KokoroTTSLike>;
  };
};

type TransformersEnvModule = { env: Record<string, unknown> };

/* -------------------------------------------------------------- model loader */

let loaded: { key: string; model: Promise<KokoroTTSLike> } | undefined;

function dtype(): KokoroDtype {
  const requested = process.env.INKCAST_KOKORO_DTYPE as KokoroDtype | undefined;
  if (requested && DTYPES.includes(requested)) return requested;
  return 'q8';
}

function progressNote(p: unknown): string | undefined {
  if (typeof p !== 'object' || p === null) return undefined;
  const rec = p as { status?: unknown; file?: unknown; progress?: unknown };
  const parts: string[] = [];
  if (typeof rec.status === 'string') parts.push(rec.status);
  if (typeof rec.file === 'string') parts.push(rec.file);
  if (typeof rec.progress === 'number') parts.push(`${rec.progress.toFixed(0)}%`);
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * Load (and memoise) the Kokoro model.
 *
 * `onDownload` is fired with human-readable notes so the CLI/web UI can show the
 * first-run download instead of appearing to hang for a minute.
 */
export async function loadKokoro(onDownload?: (note: string) => void): Promise<KokoroTTSLike> {
  const key = `${KOKORO_MODEL_ID}:${dtype()}`;
  if (loaded?.key === key) return loaded.model;

  const model = (async () => {
    const cacheDir = modelCacheDir();
    await mkdir(cacheDir, { recursive: true });

    const transformers =
      (await import('@huggingface/transformers')) as unknown as TransformersEnvModule;
    transformers.env.cacheDir = cacheDir;
    transformers.env.useFSCache = true;
    transformers.env.allowLocalModels = true;
    if (isOffline()) {
      transformers.env.allowRemoteModels = false;
      log.info('INKCAST_OFFLINE set — Kokoro will use cached weights only');
    }

    const { KokoroTTS } = (await import('kokoro-js')) as unknown as KokoroModule;
    log.info(`loading Kokoro (${dtype()}) from ${cacheDir}`);

    let lastNote = '';
    const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: dtype(),
      device: 'cpu',
      progress_callback: (p) => {
        const note = progressNote(p);
        if (!note || note === lastNote) return;
        lastNote = note;
        log.debug(`kokoro weights: ${note}`);
        onDownload?.(note);
      },
    });
    log.info('Kokoro ready');
    return tts;
  })();

  loaded = { key, model };
  // A failed load must not be memoised, or the chain can never retry.
  model.catch(() => {
    if (loaded?.key === key) loaded = undefined;
  });
  return model;
}

/** True when weights for the configured dtype are already on disk. */
export function weightsCached(): boolean {
  const dir = path.join(modelCacheDir(), ...KOKORO_MODEL_ID.split('/'));
  return existsSync(dir);
}

/** Test/CLI hook: drop the memoised model so the next call reloads. */
export function unloadKokoro(): void {
  loaded = undefined;
}

/* ------------------------------------------------------------------ chunking */

/** Group normalised sentences into synthesis chunks under the length limit. */
export function chunkForKokoro(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    // A single over-long sentence still has to go through in one piece.
    if (!current) {
      current = sentence;
    } else if (`${current} ${sentence}`.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

/* ------------------------------------------------------------------ provider */

export function createKokoroProvider(onDownload?: (note: string) => void): VoiceProvider {
  let availability: Promise<boolean> | undefined;
  /** Set by `available()` on the way to `false`; read by `unavailableReason()`. */
  let refusal: string | undefined;

  return {
    id: 'kokoro',
    label: 'Kokoro-82M (local ONNX)',

    available() {
      availability ??= (async () => {
        try {
          // Resolve without instantiating: loading weights is the expensive part.
          await import('kokoro-js');
        } catch (err) {
          log.warn('kokoro-js is not installed — skipping the local TTS provider', err);
          refusal = 'kokoro-js is not installed — run `pnpm install` at the repo root';
          return false;
        }
        if (isOffline() && !weightsCached()) {
          log.warn(
            `INKCAST_OFFLINE is set and no Kokoro weights are cached in ${modelCacheDir()} — skipping`,
          );
          refusal = `INKCAST_OFFLINE is set and no Kokoro weights are cached in ${modelCacheDir()}`;
          return false;
        }
        return true;
      })();
      return availability;
    },

    unavailableReason() {
      return refusal;
    },

    async voices() {
      return [...KOKORO_VOICES];
    },

    async resolveVoice(requested: string) {
      if ((KOKORO_VOICES as readonly string[]).includes(requested)) return requested;
      // A mood names its own local twin, and that twin is the whole point of the
      // catalogue: a run that asked for "Warm" and fell back to here gets the voice
      // chosen to stand in for Warm, not the global teaching default. Without this the
      // warning below fired on every mood id and every film sounded the same.
      const mood = voiceMood(requested);
      if (mood) {
        log.info(`mood "${mood.label}" → Kokoro ${mood.kokoro}`);
        return mood.kokoro;
      }
      log.warn(
        `voice "${requested}" is not a Kokoro voice — falling back to ${KOKORO_DEFAULT_VOICE}`,
      );
      return KOKORO_DEFAULT_VOICE;
    },

    naturalWpm(voice: string) {
      return voiceProfile(voice)?.baselineWpm;
    },

    /**
     * The free provider names its engine too, so the record can distinguish
     * "kokoro spoke" from "kokoro was configured". A run that fell back to here has
     * an engine that produced the audio, and a bill of exactly nothing.
     */
    modelId() {
      return KOKORO_MODEL_ID;
    },

    /** Continuous scene paragraphs preserve prosody; timestamps align individual words. */
    preferredSplit() {
      return 'paragraph' as const;
    },

    async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
      const tts = await loadKokoro(onDownload);

      // Validate against the live map when the model exposes one; the static
      // list is verified, but the model is the authority.
      let voice = req.voice;
      if (tts.voices && !(voice in tts.voices)) {
        log.warn(`model rejected voice "${voice}" — using ${KOKORO_DEFAULT_VOICE}`);
        voice = KOKORO_DEFAULT_VOICE;
      }

      const chunks = chunkForKokoro(req.text);
      const pieces: Float32Array[] = [];
      let sampleRate = 0;

      for (const chunk of chunks) {
        const audio = await tts.generate(chunk, { voice, speed: req.speed });
        if (!audio?.audio?.length) throw new Error('Kokoro returned no samples');
        sampleRate = audio.sampling_rate || 24_000;
        pieces.push(audio.audio);
      }

      const total = pieces.reduce((acc, p) => acc + p.length, 0);
      const merged = new Float32Array(total);
      let at = 0;
      for (const p of pieces) {
        merged.set(p, at);
        at += p.length;
      }

      await mkdir(path.dirname(req.outPath), { recursive: true });
      await writeFile(req.outPath, clipWavFromFloat32(merged, sampleRate));
      return {};
    },

    async dispose() {
      // The model stays loaded on purpose: it is shared across calls and
      // reloading it is the single most expensive thing this stage can do.
    },
  };
}
