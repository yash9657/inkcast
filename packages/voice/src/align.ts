/**
 * Optional word-level alignment with a local ONNX Whisper.
 *
 * **Verified practical in Node 22, offline, with no Python.** `@huggingface/
 * transformers` (already a dependency of this package for Kokoro's runtime)
 * implements Whisper's cross-attention DTW timestamping — `pipelines.js` handles
 * `return_timestamps: 'word'` and `models.js` exposes `_extract_token_timestamps`
 * — so long as the model repo ships the `alignment_heads` generation config. The
 * `onnx-community/*_timestamped` repos do. Measured on this machine:
 * `whisper-tiny.en_timestamped` at q8 is a 43 MB one-time download, 6.5 s to
 * load, and 0.45 s to align a 9.4 s clip, transcribing our Kokoro output
 * verbatim.
 *
 * Why it is a *precision upgrade* and not the mechanism: phrase measurement
 * (see `phrase.ts`) already gives clause-accurate cue placement with zero extra
 * bytes on disk, and that is the guarantee the pipeline rests on. Whisper turns
 * clause accuracy into word accuracy and fills in `scene.words`, which the
 * renderer can use to highlight text as it is spoken.
 *
 * Default mode is `auto`: use it when it can run, skip it with a log line when it
 * cannot. It never fails a render — an alignment failure returns no words and the
 * stage falls back to measured phrases.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@inkcast/core';
import { matchTokens } from './cue.js';
import { modelCacheDir } from './providers/kokoro.js';
import type { WordTiming } from './providers/types.js';
import { resampleFloat32 } from './wav.js';

const log = logger('voice:align');

/** Whisper's fixed input rate. */
export const ALIGN_SAMPLE_RATE = 16_000;

/**
 * `off` never loads a model. `whisper` insists on it and warns if it cannot.
 * `auto` (default) uses it when it is available and stays quiet when it is not.
 */
export type AlignMode = 'off' | 'auto' | 'whisper';

const MODES: readonly AlignMode[] = ['off', 'auto', 'whisper'];

export function isAlignMode(value: unknown): value is AlignMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/** Resolve the mode from options then `INKCAST_ALIGN`. Defaults to `auto`. */
export function requestedAlign(explicit?: string): AlignMode {
  const candidate = explicit ?? process.env.INKCAST_ALIGN;
  if (!candidate) return 'auto';
  if (isAlignMode(candidate)) return candidate;
  log.warn(`unknown alignment mode "${candidate}" — expected ${MODES.join(', ')}; using auto`);
  return 'auto';
}

/**
 * English-only `tiny.en` is a third the size and measurably sharper on English
 * than multilingual `base`; anything else needs the multilingual weights.
 */
export function alignerModelId(language: string): string {
  const override = process.env.INKCAST_ALIGN_MODEL;
  if (override) return override;
  return /^en\b/i.test(language)
    ? 'onnx-community/whisper-tiny.en_timestamped'
    : 'onnx-community/whisper-base_timestamped';
}

function isOffline(): boolean {
  const v = process.env.INKCAST_OFFLINE;
  return v === '1' || v === 'true';
}

/** True when a Hugging Face repo already has files in the shared model cache. */
export function alignerCached(modelId: string): boolean {
  return existsSync(path.join(modelCacheDir(), ...modelId.split('/')));
}

/* ------------------------------------------------- minimal structural types */

type AsrChunk = { text?: unknown; timestamp?: unknown };
type AsrOutput = { text?: unknown; chunks?: unknown };
type AsrPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<AsrOutput | AsrOutput[]>;

type TransformersModule = {
  env: Record<string, unknown>;
  pipeline(task: string, model: string, opts: Record<string, unknown>): Promise<unknown>;
};

/* ------------------------------------------------------------------ hypothesis */

/** A transcribed word with its measured span, before it is mapped onto our text. */
export type Hypothesis = { word: string; start: number; end: number };

/** Pull `{text, timestamp}` chunks out of whatever the pipeline returned. */
export function hypothesisFromChunks(output: unknown): Hypothesis[] {
  const record = Array.isArray(output) ? output[0] : output;
  const chunks = (record as AsrOutput | undefined)?.chunks;
  if (!Array.isArray(chunks)) return [];

  const words: Hypothesis[] = [];
  let previousEnd = 0;
  for (const raw of chunks as AsrChunk[]) {
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text || !/[A-Za-z0-9]/.test(text)) continue;
    const stamp = Array.isArray(raw.timestamp) ? raw.timestamp : [];
    const start = Number(stamp[0]);
    const end = Number(stamp[1]);
    const s = Number.isFinite(start) ? start : previousEnd;
    const e = Number.isFinite(end) && end > s ? end : s;
    previousEnd = e;
    words.push({ word: text, start: s, end: e });
  }
  return words;
}

/* ------------------------------------------------------------------ mapping */

/**
 * Map Whisper's transcript onto the text we asked for.
 *
 * We need one timing per *expected* token, not per transcribed token: cue
 * resolution indexes into the scene's own token stream, and the renderer wants to
 * highlight the words the storyboard contains. Whisper is accurate but not
 * identical — it punctuates differently and occasionally merges a word — so this
 * is a monotonic edit-distance alignment, with unmatched expected tokens filled
 * by interpolating across the gap they sit in.
 *
 * Monotonicity is the point: speech does not reorder, so an alignment that can
 * only advance cannot invent a timing that goes backwards.
 */
export function mapToExpected(
  expected: readonly string[],
  hypothesis: readonly Hypothesis[],
): WordTiming[] {
  if (!expected.length) return [];
  if (!hypothesis.length) return [];

  const hyp = hypothesis.map((h) => ({ ...h, key: matchTokens(h.word).join(' ') }));
  const n = expected.length;
  const m = hyp.length;

  // Edit distance with backpointers. n and m are per-scene token counts (tens),
  // so the quadratic table is trivially small.
  const cost = new Int32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number): number => i * (m + 1) + j;
  for (let i = 0; i <= n; i++) cost[idx(i, 0)] = i;
  for (let j = 0; j <= m; j++) cost[idx(0, j)] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = expected[i - 1] === hyp[j - 1]?.key;
      const sub = (cost[idx(i - 1, j - 1)] ?? 0) + (same ? 0 : 1);
      const del = (cost[idx(i - 1, j)] ?? 0) + 1;
      const ins = (cost[idx(i, j - 1)] ?? 0) + 1;
      cost[idx(i, j)] = Math.min(sub, del, ins);
    }
  }

  // Walk back, recording which hypothesis token each expected token matched.
  const pairing = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const same = expected[i - 1] === hyp[j - 1]?.key;
    const here = cost[idx(i, j)] ?? 0;
    if (here === (cost[idx(i - 1, j - 1)] ?? 0) + (same ? 0 : 1)) {
      if (same) pairing[i - 1] = j - 1;
      i--;
      j--;
    } else if (here === (cost[idx(i - 1, j)] ?? 0) + 1) {
      i--;
    } else {
      j--;
    }
  }

  // Fill the unmatched runs by spreading them across the surrounding anchors, so
  // every expected token gets a monotonically increasing span.
  const words: WordTiming[] = expected.map((word) => ({ word, start: 0, end: 0 }));
  const first = hyp[0]!;
  const last = hyp[m - 1]!;

  let cursor = 0;
  while (cursor < n) {
    const anchor = pairing[cursor];
    if (anchor !== undefined && anchor >= 0) {
      const h = hyp[anchor]!;
      words[cursor] = { word: expected[cursor]!, start: h.start, end: h.end };
      cursor++;
      continue;
    }
    // Run of unmatched tokens: [cursor, run) between two known times.
    let run = cursor;
    while (run < n && (pairing[run] ?? -1) < 0) run++;
    const beforeIdx = cursor > 0 ? (pairing[cursor - 1] ?? -1) : -1;
    const afterIdx = run < n ? (pairing[run] ?? -1) : -1;
    const from = beforeIdx >= 0 ? hyp[beforeIdx]!.end : first.start;
    const to = afterIdx >= 0 ? hyp[afterIdx]!.start : last.end;
    const span = Math.max(0, to - from);
    const step = span / (run - cursor);
    for (let k = cursor; k < run; k++) {
      const start = from + step * (k - cursor);
      words[k] = { word: expected[k]!, start: round3(start), end: round3(start + step) };
    }
    cursor = run;
  }

  // Guarantee monotonicity even if the aligner produced an odd ordering.
  for (let k = 1; k < words.length; k++) {
    const prev = words[k - 1]!;
    const cur = words[k]!;
    if (cur.start < prev.start) cur.start = prev.start;
    if (cur.end < cur.start) cur.end = cur.start;
  }
  return words.map((w) => ({ word: w.word, start: round3(w.start), end: round3(w.end) }));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/* ------------------------------------------------------------------ aligner */

export type Aligner = {
  /** True when a model is loaded or loadable. */
  usable(): Promise<boolean>;
  /**
   * Word timings for `expectedText`, measured from `samples`. Returns an empty
   * array when alignment is unavailable or failed — never throws.
   */
  align(samples: Float32Array, sampleRate: number, expectedText: string): Promise<WordTiming[]>;
  dispose(): Promise<void>;
};

export type OpenAlignerOptions = {
  mode?: AlignMode;
  language?: string;
  onDownload?: (note: string) => void;
};

/** A no-op aligner, so callers never branch on whether alignment is enabled. */
export function nullAligner(): Aligner {
  return {
    async usable() {
      return false;
    },
    async align() {
      return [];
    },
    async dispose() {
      /* nothing loaded */
    },
  };
}

/**
 * Open the local Whisper aligner.
 *
 * The model is loaded lazily and memoised for the process, exactly like Kokoro's:
 * loading is by far the expensive part and it is shared across every scene.
 */
/**
 * Memoised per model id at module scope, exactly like Kokoro's loader: the
 * pipeline is ~43 MB of weights shared by every scene of every project in the
 * process, and reloading it per `narrate()` call would cost more than all the
 * alignment work put together.
 */
let loaded: { key: string; pipe: Promise<AsrPipeline | undefined> } | undefined;

/** Test/CLI hook: drop the memoised pipeline so the next call reloads. */
export function unloadAligner(): void {
  loaded = undefined;
}

export function openAligner(opts: OpenAlignerOptions = {}): Aligner {
  const mode = opts.mode ?? requestedAlign();
  if (mode === 'off') return nullAligner();

  const modelId = alignerModelId(opts.language ?? 'en');
  let announced = false;

  const load = (): Promise<AsrPipeline | undefined> => {
    if (loaded?.key === modelId) return loaded.pipe;
    const pipe = (async () => {
      if (isOffline() && !alignerCached(modelId)) {
        const note = `INKCAST_OFFLINE is set and ${modelId} is not cached — word alignment disabled`;
        if (mode === 'whisper') log.warn(note);
        else log.debug(note);
        return undefined;
      }
      if (mode === 'auto' && !alignerCached(modelId)) {
        log.info(
          `downloading the word aligner (${modelId}, ~43 MB, one time) for exact cue placement`,
        );
      }
      try {
        const cacheDir = modelCacheDir();
        await mkdir(cacheDir, { recursive: true });
        const transformers =
          (await import('@huggingface/transformers')) as unknown as TransformersModule;
        transformers.env.cacheDir = cacheDir;
        transformers.env.useFSCache = true;
        transformers.env.allowLocalModels = true;
        if (isOffline()) transformers.env.allowRemoteModels = false;

        let lastNote = '';
        const built = (await transformers.pipeline('automatic-speech-recognition', modelId, {
          dtype: 'q8',
          device: 'cpu',
          progress_callback: (p: unknown) => {
            const rec = p as { status?: unknown; file?: unknown; progress?: unknown };
            const note = [
              rec.status,
              rec.file,
              typeof rec.progress === 'number' ? `${rec.progress.toFixed(0)}%` : '',
            ]
              .filter((x) => typeof x === 'string' && x)
              .join(' ');
            if (!note || note === lastNote) return;
            lastNote = note;
            opts.onDownload?.(note);
          },
        })) as AsrPipeline;
        log.info(`word aligner ready (${modelId})`);
        return built;
      } catch (err) {
        const note = `could not load the word aligner (${modelId}) — falling back to measured phrase boundaries`;
        if (mode === 'whisper') log.warn(note, err);
        else log.debug(`${note}: ${String(err)}`);
        return undefined;
      }
    })();
    loaded = { key: modelId, pipe };
    // A rejected load must not be remembered, or alignment can never recover.
    pipe.catch(() => {
      if (loaded?.key === modelId) loaded = undefined;
    });
    return pipe;
  };

  return {
    async usable() {
      return (await load()) !== undefined;
    },

    async align(samples, sampleRate, expectedText) {
      const expected = matchTokens(expectedText);
      if (!expected.length || samples.length === 0) return [];

      const asr = await load();
      if (!asr) return [];

      try {
        const input =
          sampleRate === ALIGN_SAMPLE_RATE
            ? samples
            : resampleFloat32(samples, sampleRate, ALIGN_SAMPLE_RATE);
        const output = await asr(input, {
          return_timestamps: 'word',
          chunk_length_s: 30,
          // Greedy decoding keeps alignment deterministic across runs, which
          // matters because `enter.at` is derived from it and cached.
          do_sample: false,
        });
        const hypothesis = hypothesisFromChunks(output);
        if (!hypothesis.length) return [];

        const words = mapToExpected(expected, hypothesis);
        if (!announced) {
          announced = true;
          log.debug(
            `aligned ${words.length} words from a ${(samples.length / sampleRate).toFixed(2)}s clip`,
          );
        }
        return words;
      } catch (err) {
        log.warn('word alignment failed for one clip — using measured phrase boundaries', err);
        return [];
      }
    },

    async dispose() {
      // The pipeline is intentionally kept for the life of the process: it is
      // shared by every scene and reloading it dwarfs the alignment cost.
    },
  };
}
