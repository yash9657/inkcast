/**
 * Audio measurement and assembly.
 *
 * Duration is measured from the file that was actually written, never predicted:
 * that measurement is what `scene.durationSec` carries into the renderer, and it
 * is why Inkcast needs no forced aligner to stay in sync.
 *
 * ffprobe/ffmpeg are the primary tools (they are the contract's stated
 * dependency), but both have a pure-JS fallback so a missing binary degrades to
 * a warning rather than a failed render.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@inkcast/core';
import {
  CLIP_FORMAT,
  clipWavFromFloat32,
  decodeWavToMonoFloat32,
  encodeWav,
  readWavInfo,
  resampleFloat32,
  silencePcm,
  silenceWav,
} from './wav.js';

const log = logger('voice:audio');

/* ---------------------------------------------------------------- processes */

export type RunResult = { stdout: string; stderr: string };

/** Spawn a binary and resolve its output, or reject with its stderr. */
export function run(bin: string, args: string[], timeoutMs = 300_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

const probes = new Map<string, Promise<boolean>>();

/** Cached `<bin> -version` presence check. */
export function hasBinary(bin: string, versionFlag = '-version'): Promise<boolean> {
  const cached = probes.get(bin);
  if (cached) return cached;
  const probe = run(bin, [versionFlag], 15_000).then(
    () => true,
    () => false,
  );
  probes.set(bin, probe);
  return probe;
}

/* -------------------------------------------------------------- measurement */

/** `ffprobe format=duration`, or null when ffprobe is unavailable/unhelpful. */
export async function ffprobeDuration(file: string): Promise<number | null> {
  if (!(await hasBinary('ffprobe'))) return null;
  try {
    const { stdout } = await run(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nokey=1:noprint_wrappers=1',
        file,
      ],
      30_000,
    );
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (err) {
    log.debug(`ffprobe failed for ${path.basename(file)}`, err);
    return null;
  }
}

/**
 * True duration of an audio file in seconds.
 *
 * ffprobe first (authoritative, works for any container); the WAV header is the
 * fallback so the voice stage still measures correctly with no ffmpeg present.
 */
export async function measureDuration(file: string): Promise<number> {
  const probed = await ffprobeDuration(file);
  if (probed !== null) return probed;
  const info = readWavInfo(await readFile(file));
  return info.durationSec;
}

/* ------------------------------------------------------------------ writing */

/** Write a clip-format WAV containing `seconds` of silence. */
export async function writeSilenceWav(file: string, seconds: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, silenceWav(Math.max(seconds, 0.01)));
}

/**
 * Append trailing silence to an existing clip, in place.
 *
 * A small pad after every scene is what stops beats running into each other.
 * It is added *before* measurement, so `scene.durationSec` still describes the
 * file byte-for-byte and animation stays aligned.
 */
export async function padWav(file: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const buf = await readFile(file);
  const info = readWavInfo(buf);
  const body = buf.subarray(info.dataOffset, info.dataOffset + info.dataLength);
  const pad = silencePcm(seconds, info);
  await writeFile(file, encodeWav(Buffer.concat([body, pad]), info));
}

/* ------------------------------------------------------- clip assembly */

/** Decode any WAV on disk to mono Float32 at the clip sample rate. */
export async function readClipSamples(file: string): Promise<Float32Array> {
  const buf = await readFile(file);
  const info = readWavInfo(buf);
  const mono = decodeWavToMonoFloat32(buf, info);
  return resampleFloat32(mono, info.sampleRate, CLIP_FORMAT.sampleRate);
}

/** One measured phrase, ready to be placed in a scene clip. */
export type ClipPart = {
  samples: Float32Array;
  /** Deliberate silence to insert after this part, in seconds. */
  gapSec: number;
};

/** Where each part landed, plus how the clip splits into narration and hold. */
export type AssembledClip = {
  /** Speech span of each part, in seconds from the start of the clip. */
  spans: Array<{ start: number; end: number }>;
  /**
   * Length of the narration portion — parts, inter-phrase gaps and the trailing
   * breath. This is what `scene.durationSec` must report, because the IR defines
   * `hold` as silence *after* the measured narration.
   */
  narrationSec: number;
  /** Real silence appended after the narration, honouring `Scene.hold`. */
  holdSec: number;
  /** Total clip length on disk: `narrationSec + holdSec`, exactly. */
  totalSec: number;
};

export type AssembleOptions = {
  /**
   * Trailing breath inside the narration, so consecutive beats never collide
   * even when the planner set no `hold`.
   */
  padSec?: number;
  /** `Scene.hold`, rendered as real silence rather than left as dead air. */
  holdSec?: number;
  sampleRate?: number;
};

/**
 * Join measured phrase parts into one scene clip.
 *
 * All arithmetic is in samples and only converted to seconds at the end, so the
 * returned spans and durations describe the bytes on disk exactly — which is the
 * property cue resolution depends on. Nothing here can clip speech: parts are
 * copied whole and only silence is inserted between them.
 */
export async function writeClipFromParts(
  file: string,
  parts: readonly ClipPart[],
  opts: AssembleOptions = {},
): Promise<AssembledClip> {
  const rate = opts.sampleRate ?? CLIP_FORMAT.sampleRate;
  const padFrames = Math.max(0, Math.round((opts.padSec ?? 0) * rate));
  const holdFrames = Math.max(0, Math.round((opts.holdSec ?? 0) * rate));

  const gapFrames = parts.map((p, i) =>
    i === parts.length - 1 ? 0 : Math.max(0, Math.round(p.gapSec * rate)),
  );
  const speech = parts.reduce((acc, p) => acc + p.samples.length, 0);
  const gaps = gapFrames.reduce((acc, g) => acc + g, 0);
  const narrationFrames = speech + gaps + padFrames;

  const merged = new Float32Array(narrationFrames + holdFrames);
  const spans: Array<{ start: number; end: number }> = [];
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    merged.set(part.samples, at);
    spans.push({ start: at / rate, end: (at + part.samples.length) / rate });
    at += part.samples.length + (gapFrames[i] ?? 0);
  }
  // The remainder of `merged` is already zeroed: pad and hold are literal silence.

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, clipWavFromFloat32(merged, rate));

  return {
    spans,
    narrationSec: narrationFrames / rate,
    holdSec: holdFrames / rate,
    totalSec: (narrationFrames + holdFrames) / rate,
  };
}

/**
 * Append `seconds` of real silence to a clip and report how much was added.
 *
 * Used for scenes with no speech at all, where there are no parts to assemble
 * but `hold` must still be honoured.
 */
export async function appendSilence(file: string, seconds: number): Promise<number> {
  if (!(seconds > 0)) return 0;
  const buf = await readFile(file);
  const info = readWavInfo(buf);
  const frames = Math.round(seconds * info.sampleRate);
  const body = buf.subarray(info.dataOffset, info.dataOffset + info.dataLength);
  const pad = silencePcm(frames / info.sampleRate, info);
  await writeFile(file, encodeWav(Buffer.concat([body, pad]), info));
  return frames / info.sampleRate;
}

/* ---------------------------------------------------------- concatenation */

function quoteForConcat(file: string): string {
  return `file '${file.replace(/'/g, "'\\''")}'`;
}

async function concatWithFfmpeg(inputs: string[], outPath: string): Promise<void> {
  const listPath = `${outPath}.concat.txt`;
  await writeFile(listPath, `${inputs.map(quoteForConcat).join('\n')}\n`);
  try {
    await run('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      outPath,
    ]);
  } finally {
    await rm(listPath, { force: true });
  }
}

/**
 * Pure-JS concatenation. Decodes to mono float and re-encodes, so mismatched
 * sample rates or bit depths can never corrupt the joined track.
 */
async function concatInJs(inputs: string[], outPath: string): Promise<void> {
  const loaded: Array<{ buf: Buffer; info: ReturnType<typeof readWavInfo> }> = [];
  for (const file of inputs) {
    const buf = await readFile(file);
    loaded.push({ buf, info: readWavInfo(buf) });
  }

  const uniform = loaded.every(
    ({ info }) =>
      info.audioFormat === CLIP_FORMAT.audioFormat &&
      info.sampleRate === CLIP_FORMAT.sampleRate &&
      info.channels === CLIP_FORMAT.channels &&
      info.bitsPerSample === CLIP_FORMAT.bitsPerSample,
  );

  if (uniform) {
    const chunks = loaded.map(({ buf, info }) =>
      buf.subarray(info.dataOffset, info.dataOffset + info.dataLength),
    );
    await writeFile(outPath, encodeWav(Buffer.concat(chunks)));
    return;
  }

  // Mixed formats — rebuild from mono float samples so nothing can desync.
  log.warn('clips have mixed audio formats — re-encoding to the standard clip format');
  const parts = loaded.map(({ buf, info }) =>
    resampleFloat32(decodeWavToMonoFloat32(buf, info), info.sampleRate, CLIP_FORMAT.sampleRate),
  );
  const merged = new Float32Array(parts.reduce((acc, p) => acc + p.length, 0));
  let at = 0;
  for (const p of parts) {
    merged.set(p, at);
    at += p.length;
  }
  await writeFile(outPath, clipWavFromFloat32(merged, CLIP_FORMAT.sampleRate));
}

/**
 * Join per-scene clips into the single track the renderer muxes, appending
 * `outroSec` of trailing silence so the ending does not feel clipped.
 *
 * Returns the measured duration of the result.
 */
export async function concatWavs(clips: string[], outPath: string, outroSec = 0): Promise<number> {
  if (clips.length === 0) throw new Error('concatWavs: no clips to join');
  await mkdir(path.dirname(outPath), { recursive: true });

  const inputs = [...clips];
  let outro: string | undefined;
  if (outroSec > 0) {
    outro = `${outPath}.outro.wav`;
    await writeSilenceWav(outro, outroSec);
    inputs.push(outro);
  }

  try {
    if (await hasBinary('ffmpeg')) {
      try {
        await concatWithFfmpeg(inputs, outPath);
      } catch (err) {
        log.warn('ffmpeg concat failed — joining in JavaScript instead', err);
        await concatInJs(inputs, outPath);
      }
    } else {
      log.warn(
        'ffmpeg not found — joining narration in JavaScript (install ffmpeg for the fast path)',
      );
      await concatInJs(inputs, outPath);
    }
  } finally {
    if (outro) await rm(outro, { force: true });
  }

  return measureDuration(outPath);
}
