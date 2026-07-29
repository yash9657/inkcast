/**
 * A tiny, dependency-free RIFF/WAVE reader and writer.
 *
 * Every voice provider is required to land on ONE clip format (see `CLIP_*`
 * below) so that per-scene clips can be concatenated with `ffmpeg -c copy`, and
 * so the stage still works when no ffmpeg binary exists at all. Owning the
 * container ourselves is what buys that: Kokoro hands us Float32 samples,
 * ElevenLabs hands us headerless PCM, and `say` writes a WAV directly — this
 * module is the single place all three become the same bytes.
 */

/** Output clip format. Matches Kokoro's native 24 kHz so nothing is resampled. */
export const CLIP_SAMPLE_RATE = 24_000;
export const CLIP_CHANNELS = 1;
export const CLIP_BITS = 16;

/** Folded into cache keys: changing the clip format must invalidate clips. */
export const CLIP_SIGNATURE = `wav:${CLIP_SAMPLE_RATE}:${CLIP_CHANNELS}:${CLIP_BITS}`;

export type WavFormat = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** 1 = integer PCM, 3 = IEEE float. */
  audioFormat: number;
};

export type WavInfo = WavFormat & {
  /** Byte offset of the `data` chunk payload within the buffer. */
  dataOffset: number;
  dataLength: number;
  durationSec: number;
};

export const CLIP_FORMAT: WavFormat = {
  sampleRate: CLIP_SAMPLE_RATE,
  channels: CLIP_CHANNELS,
  bitsPerSample: CLIP_BITS,
  audioFormat: 1,
};

/* ------------------------------------------------------------------ reading */

/**
 * Walk the RIFF chunk list and pull out `fmt ` + `data`.
 *
 * Chunk sizes are trusted only up to the real buffer length: some writers (and
 * anything streamed) leave a stale or 0xFFFFFFFF size in the header.
 */
export function readWavInfo(buf: Buffer): WavInfo {
  if (buf.length < 12) throw new Error('not a WAV file: too short');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file: missing RIFF/WAVE header');
  }

  let fmt: WavFormat | undefined;
  let dataOffset = -1;
  let dataLength = 0;

  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const declared = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    const size = Math.min(declared, Math.max(0, buf.length - body));

    if (id === 'fmt ' && size >= 16) {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
      // WAVE_FORMAT_EXTENSIBLE stores the real format tag in the sub-format GUID;
      // the only bit we care about is integer-vs-float, and byte 24 carries it.
      if (fmt.audioFormat === 0xfffe && size >= 26) fmt.audioFormat = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = size;
    }

    pos = body + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt) throw new Error('malformed WAV: no fmt chunk');
  if (dataOffset < 0) throw new Error('malformed WAV: no data chunk');
  if (!fmt.channels || !fmt.sampleRate || !fmt.bitsPerSample) {
    throw new Error('malformed WAV: zero channels, rate or bit depth');
  }

  const bytesPerFrame = fmt.channels * (fmt.bitsPerSample / 8);
  return {
    ...fmt,
    dataOffset,
    dataLength,
    durationSec: dataLength / (bytesPerFrame * fmt.sampleRate),
  };
}

/** Duration of a WAV on disk, straight from its header. No ffprobe needed. */
export function wavDurationFromBuffer(buf: Buffer): number {
  return readWavInfo(buf).durationSec;
}

/* ------------------------------------------------------------------ writing */

/** Wrap raw PCM in a 44-byte canonical WAV header. */
export function encodeWav(pcm: Buffer, fmt: WavFormat = CLIP_FORMAT): Buffer {
  const header = Buffer.alloc(44);
  const bytesPerFrame = fmt.channels * (fmt.bitsPerSample / 8);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(fmt.audioFormat, 20);
  header.writeUInt16LE(fmt.channels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(fmt.sampleRate * bytesPerFrame, 28); // byte rate
  header.writeUInt16LE(bytesPerFrame, 32); // block align
  header.writeUInt16LE(fmt.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** Clamp + convert Float32 samples (-1..1) to little-endian 16-bit PCM. */
export function floatToPcm16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    // Asymmetric scaling so -1 maps to -32768 and +1 to 32767 without wrapping.
    out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return out;
}

/** `seconds` of digital silence in the given format. */
export function silencePcm(seconds: number, fmt: WavFormat = CLIP_FORMAT): Buffer {
  const frames = Math.max(0, Math.round(seconds * fmt.sampleRate));
  return Buffer.alloc(frames * fmt.channels * (fmt.bitsPerSample / 8));
}

/** A standalone silent WAV — used for the outro and for empty narration. */
export function silenceWav(seconds: number, fmt: WavFormat = CLIP_FORMAT): Buffer {
  return encodeWav(silencePcm(seconds, fmt), fmt);
}

/* ------------------------------------------------------- format conversion */

/**
 * Decode any WAV we can plausibly meet into mono Float32.
 *
 * Only needed on the no-ffmpeg path (or if a provider ever deviates from
 * `CLIP_FORMAT`), but it means concatenation can never fail on a format
 * mismatch, which is the one thing that would silently break audio sync.
 */
export function decodeWavToMonoFloat32(
  buf: Buffer,
  info: WavInfo = readWavInfo(buf),
): Float32Array {
  const { audioFormat, bitsPerSample, channels, dataOffset, dataLength } = info;
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  const out = new Float32Array(frames);

  const read = (at: number): number => {
    if (audioFormat === 3) {
      return bitsPerSample === 64 ? buf.readDoubleLE(at) : buf.readFloatLE(at);
    }
    switch (bitsPerSample) {
      case 8:
        return (buf.readUInt8(at) - 128) / 128; // 8-bit WAV is unsigned
      case 16:
        return buf.readInt16LE(at) / 0x8000;
      case 24:
        return (
          (buf.readUInt8(at) | (buf.readUInt8(at + 1) << 8) | (buf.readInt8(at + 2) << 16)) /
          0x800000
        );
      case 32:
        return buf.readInt32LE(at) / 0x80000000;
      default:
        throw new Error(`unsupported WAV bit depth: ${bitsPerSample}`);
    }
  };

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = dataOffset + f * bytesPerSample * channels;
    for (let c = 0; c < channels; c++) sum += read(base + c * bytesPerSample);
    out[f] = sum / channels;
  }
  return out;
}

/** Linear resample. Good enough for speech and it never introduces a dependency. */
export function resampleFloat32(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = to / from;
  const length = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    const a = input[Math.min(i0, input.length - 1)] ?? 0;
    const b = input[i1] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Coerce arbitrary WAV bytes to `CLIP_FORMAT` bytes, in pure JS. */
export function toClipWav(buf: Buffer): Buffer {
  const info = readWavInfo(buf);
  if (
    info.audioFormat === CLIP_FORMAT.audioFormat &&
    info.sampleRate === CLIP_FORMAT.sampleRate &&
    info.channels === CLIP_FORMAT.channels &&
    info.bitsPerSample === CLIP_FORMAT.bitsPerSample
  ) {
    return buf;
  }
  const mono = decodeWavToMonoFloat32(buf, info);
  return encodeWav(floatToPcm16(resampleFloat32(mono, info.sampleRate, CLIP_SAMPLE_RATE)));
}

/** Build a clip from Float32 samples at any rate. */
export function clipWavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  return encodeWav(floatToPcm16(resampleFloat32(samples, sampleRate, CLIP_SAMPLE_RATE)));
}

/* ----------------------------------------------------------- speech bounds */

/** First and last sample of actual speech in a clip. */
export type SpeechBounds = { start: number; end: number };

export type BoundsOptions = {
  /** Speech floor as a fraction of the clip's peak level. */
  floor?: number;
  /**
   * Samples of silence kept on each side. This is the whole safety mechanism:
   * fricatives and the decay of a final consonant sit below any sane floor, so
   * trimming to the exact threshold clips the tail of the word. 40 ms is
   * inaudible as a gap and comfortably longer than that decay.
   */
  guardSec?: number;
  /** Analysis window. */
  windowSec?: number;
};

/**
 * Locate the speech inside a clip.
 *
 * Needed because every TTS engine pads its output: Kokoro consistently emits
 * ~0.37 s of leading and ~0.55 s of trailing silence per `generate()` call.
 * Concatenating phrase clips without trimming would therefore insert nearly a
 * second of dead air at every clause boundary. Trimming to these bounds and then
 * adding a *chosen* gap is what turns that accident into pacing.
 *
 * Returns the full range when the clip has no detectable peak, so silence in
 * never destroyed by accident.
 */
export function findSpeechBounds(
  samples: Float32Array,
  sampleRate: number,
  opts: BoundsOptions = {},
): SpeechBounds {
  const n = samples.length;
  if (n === 0) return { start: 0, end: 0 };

  const win = Math.max(1, Math.round((opts.windowSec ?? 0.01) * sampleRate));
  const guard = Math.max(0, Math.round((opts.guardSec ?? 0.04) * sampleRate));

  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > peak) peak = v;
  }
  if (peak <= 1e-5) return { start: 0, end: n };

  const floor = peak * (opts.floor ?? 0.02);
  const loud = (from: number): boolean => {
    const to = Math.min(n, from + win);
    let acc = 0;
    for (let i = from; i < to; i++) {
      const v = samples[i] ?? 0;
      acc += v * v;
    }
    return Math.sqrt(acc / Math.max(1, to - from)) > floor;
  };

  let start = 0;
  while (start + win <= n && !loud(start)) start += win;
  if (start + win > n) return { start: 0, end: n }; // nothing above the floor

  let end = n - win;
  while (end > start && !loud(end)) end -= win;
  end = Math.min(n, end + win);

  return { start: Math.max(0, start - guard), end: Math.min(n, end + guard) };
}

/** Drop the engine's leading and trailing padding, keeping the guard margin. */
export function trimEdgeSilence(
  samples: Float32Array,
  sampleRate: number,
  opts: BoundsOptions = {},
): Float32Array {
  const { start, end } = findSpeechBounds(samples, sampleRate, opts);
  if (start === 0 && end === samples.length) return samples;
  return samples.slice(start, end);
}
