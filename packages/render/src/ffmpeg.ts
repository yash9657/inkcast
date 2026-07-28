/**
 * ffmpeg / ffprobe plumbing.
 *
 * Frames never touch the disk: each capture worker pipes PNG (or JPEG) buffers
 * straight into its own `-f image2pipe` encoder, respecting stdin backpressure —
 * ignoring it buffers hundreds of megabytes of 1080p frames in Node's heap and
 * eventually OOMs. Segments are then concatenated with `-c:v copy` and the
 * narration is muxed in, so the video is encoded exactly once.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { logger } from '@inkcast/core';

const log = logger('render:ffmpeg');

export type RunResult = { code: number; stdout: string; stderr: string };

export function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: `${stderr}${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

let ffmpegChecked: string | null | undefined;

/** Resolves to the ffmpeg version string, or throws something actionable. */
export async function ensureFfmpeg(): Promise<string> {
  if (ffmpegChecked === undefined) {
    const r = await run('ffmpeg', ['-version']);
    ffmpegChecked = r.code === 0 ? (r.stdout.split('\n')[0] ?? 'ffmpeg') : null;
  }
  if (!ffmpegChecked) {
    throw new Error(
      'ffmpeg not found on PATH. Install it and re-run:\n' +
        '  macOS:  brew install ffmpeg\n' +
        '  Debian: sudo apt install ffmpeg',
    );
  }
  return ffmpegChecked;
}

export type MediaInfo = {
  duration: number | null;
  video: { codec: string; width: number; height: number; pixFmt: string | null } | null;
  audio: { codec: string; sampleRate: number | null } | null;
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_rate?: string;
};

/** `null` when the file is missing or unreadable — never throws. */
export async function probeMedia(file: string): Promise<MediaInfo | null> {
  const r = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,pix_fmt,sample_rate',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    file,
  ]);
  if (r.code !== 0) return null;
  let parsed: { streams?: ProbeStream[]; format?: { duration?: string } };
  try {
    parsed = JSON.parse(r.stdout) as typeof parsed;
  } catch {
    return null;
  }
  const streams = parsed.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;
  return {
    duration: duration !== null && Number.isFinite(duration) ? duration : null,
    video: v
      ? {
          codec: v.codec_name ?? '',
          width: v.width ?? 0,
          height: v.height ?? 0,
          pixFmt: v.pix_fmt ?? null,
        }
      : null,
    audio: a
      ? { codec: a.codec_name ?? '', sampleRate: a.sample_rate ? Number(a.sample_rate) : null }
      : null,
  };
}

/** Duration in seconds, or `null`. */
export async function probeDuration(file: string): Promise<number | null> {
  const info = await probeMedia(file);
  return info?.duration ?? null;
}

/* ------------------------------------------------------------ frame encoder */

export type SegmentEncoder = {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
  kill(): void;
};

export type SegmentOptions = {
  out: string;
  fps: number;
  crf: number;
  preset: string;
  /**
   * x264 threads. Left to itself libx264 takes a thread per core, so N parallel
   * segment encoders oversubscribe the machine N-fold and starve the Chromium
   * renderers that are actually the bottleneck.
   */
  threads: number;
};

export function openSegmentEncoder(o: SegmentOptions): SegmentEncoder {
  const args = [
    '-y',
    '-v',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(o.fps),
    '-i',
    'pipe:0',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    o.preset,
    '-crf',
    String(o.crf),
    '-pix_fmt',
    'yuv420p',
    '-threads',
    String(Math.max(1, Math.round(o.threads))),
    '-r',
    String(o.fps),
    '-f',
    'mp4',
    o.out,
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr?.on('data', (d: Buffer) => {
    err = (err + d.toString()).slice(-4000);
  });
  let spawnError: Error | null = null;
  const done = new Promise<void>((resolve, reject) => {
    ff.on('error', (e) => {
      spawnError = e instanceof Error ? e : new Error(String(e));
      reject(spawnError);
    });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}${err ? `: ${err.trim()}` : ''}`));
    });
  });
  // The race in write() may not be the first observer, so make sure a rejection
  // is never unhandled.
  done.catch(() => undefined);
  // ffmpeg dying first turns our next write into EPIPE; `done` reports the why.
  ff.stdin.on('error', () => undefined);

  return {
    async write(frame) {
      if (spawnError) throw spawnError;
      if (!ff.stdin.writable) {
        await done;
        throw new Error(`ffmpeg closed its input early${err ? `: ${err.trim()}` : ''}`);
      }
      if (!ff.stdin.write(frame)) {
        await Promise.race([
          once(ff.stdin, 'drain'),
          done.then(() => {
            throw new Error(
              `ffmpeg exited while frames were still being written${err ? `: ${err.trim()}` : ''}`,
            );
          }),
        ]);
      }
    },
    async finish() {
      ff.stdin.end();
      await done;
    },
    kill() {
      try {
        ff.stdin.destroy();
        ff.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

/* ------------------------------------------------------------- concat + mux */

function concatLine(file: string): string {
  // The concat demuxer takes single-quoted paths; a literal quote is escaped by
  // closing, escaping, and reopening the quote.
  return `file '${file.replace(/'/g, "'\\''")}'`;
}

export async function writeConcatList(listPath: string, files: string[]): Promise<void> {
  await writeFile(listPath, `${files.map(concatLine).join('\n')}\n`, 'utf8');
}

export type MuxOptions = {
  listPath: string;
  audio: string | null;
  out: string;
  /** Exact video duration (frames / fps). Keeps audio from extending the file. */
  duration: number;
  audioBitrate?: string;
};

/**
 * Join the per-worker segments and mux the narration. Video is copied, never
 * re-encoded, so this stays fast no matter how long the film is.
 */
export async function concatAndMux(o: MuxOptions): Promise<void> {
  const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', o.listPath];
  if (o.audio) args.push('-i', o.audio);
  args.push('-map', '0:v:0');
  if (o.audio) {
    args.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', o.audioBitrate ?? '160k', '-af', 'apad');
  }
  args.push('-c:v', 'copy', '-t', o.duration.toFixed(6), '-movflags', '+faststart', o.out);
  const r = await run('ffmpeg', args);
  if (r.code !== 0) {
    throw new Error(`ffmpeg mux failed (${r.code}): ${r.stderr.trim() || 'no output'}`);
  }
}

/** Concatenate per-scene WAVs into one narration track. Lossless stream copy. */
export async function concatWavs(listPath: string, files: string[], out: string): Promise<boolean> {
  await writeConcatList(listPath, files);
  const r = await run('ffmpeg', [
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
    out,
  ]);
  if (r.code !== 0) {
    log.warn(`could not join per-scene audio: ${r.stderr.trim() || r.code}`);
    return false;
  }
  return true;
}
