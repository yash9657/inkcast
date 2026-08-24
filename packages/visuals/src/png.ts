/**
 * Just enough of the PNG format to look at the pixels a provider sent back.
 *
 * This exists for one question — **is this raster's ground white?** — and that question
 * cannot be answered from the header. A figure is composited onto the board with
 * `mix-blend-mode: multiply`, which is the identity against white and a visible grey card
 * against anything else, so a raster on an off-white ground shows its own edges on the
 * paper. Nothing else in the repo could see that.
 *
 * **Written here rather than installed**, for the same reason `FontMetrics` grew a `glyf`
 * reader instead of taking `opentype.js`: a decoder is ~150 lines of a well-specified
 * format, and the alternative is a native or wasm dependency on the one lane that already
 * has to degrade gracefully when its optional native tracer is missing.
 *
 * What it reads: 8- and 16-bit, non-interlaced, colour types 0/2/3/4/6 — which is every
 * PNG either provider has returned. Everything else (interlaced, sub-byte palettes) comes
 * back `undefined`, and the caller's contract is that `undefined` means *this check did not
 * run*, never *this raster is bad*. A checker that guesses when it cannot see is worse than
 * one that abstains.
 */
import { inflateSync } from 'node:zlib';
import { logger } from '@inkcast/core';

const log = logger('visuals:png');

const MAGIC = '89504e470d0a1a0a';

/** A decoded raster: straight 8-bit RGBA, row-major, `4 * w * h` bytes. */
export type PngPixels = { width: number; height: number; rgba: Uint8Array };

/**
 * A PNG's intrinsic size, straight out of the IHDR chunk.
 *
 * The placement reads the real header rather than assuming the shape it asked for: a
 * provider is free to round a request to its own latent grid, and an aspect assumption that
 * is right until it is not is the kind of thing that comes back as a stretched heart nobody
 * can explain. Falls back to a square if the header is not a PNG.
 */
export function pngSize(png: Buffer): { w: number; h: number } {
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== MAGIC) {
    log.warn('a raster is not a PNG — assuming it is square');
    return { w: 1024, h: 1024 };
  }
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : { w: 1024, h: 1024 };
}

/** Channels per pixel for each colour type; `undefined` for the ones this does not read. */
const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Paeth, straight from the spec — the one filter that is not obvious on sight. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a PNG to RGBA, or `undefined` if it is a shape this does not read.
 *
 * The whole file is decoded even though every caller so far only wants the border, because
 * PNG rows are filtered against the row above: reading the last row means reconstructing
 * every row before it, and a decoder that pretended otherwise would be lying about its cost.
 */
export function readPng(png: Buffer): PngPixels | undefined {
  if (png.length < 8 || png.subarray(0, 8).toString('hex') !== MAGIC) return undefined;

  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  let paletteAlpha: Buffer | undefined;
  const idat: Buffer[] = [];

  let at = 8;
  while (at + 8 <= png.length) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    const body = png.subarray(at + 8, at + 8 + len);
    if (at + 12 + len > png.length) break;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8] as number;
      colorType = body[9] as number;
      interlace = body[12] as number;
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'tRNS') paletteAlpha = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    at += 12 + len;
  }

  const channels = CHANNELS[colorType];
  if (!channels || width <= 0 || height <= 0 || idat.length === 0) return undefined;
  // Adam7 would need seven passes reassembled; no provider has ever sent one, and guessing
  // is worse than abstaining.
  if (interlace !== 0) return undefined;
  if (depth !== 8 && depth !== 16) return undefined;
  if (colorType === 3 && !palette) return undefined;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (err) {
    log.warn('a raster’s image data would not inflate', err);
    return undefined;
  }

  const bpp = Math.ceil((channels * depth) / 8);
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < height * (stride + 1)) return undefined;

  // Unfilter in place, one row at a time against the row above (all zeroes for row 0).
  const lines = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = lines.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const x = src[i] as number;
      const a = i >= bpp ? (row[i - bpp] as number) : 0;
      const b = prev ? (prev[i] as number) : 0;
      const c = prev && i >= bpp ? (prev[i - bpp] as number) : 0;
      row[i] =
        filter === 0
          ? x
          : filter === 1
            ? (x + a) & 0xff
            : filter === 2
              ? (x + b) & 0xff
              : filter === 3
                ? (x + ((a + b) >> 1)) & 0xff
                : filter === 4
                  ? (x + paeth(a, b, c)) & 0xff
                  : x;
      if (filter > 4) return undefined;
    }
  }

  // 16-bit samples are read at their high byte: this measures paper, and the low byte is
  // three decimal places past anything the question cares about.
  const step = depth === 16 ? 2 : 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * channels * step;
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = lines[s] as number;
        const p = palette as Buffer;
        rgba[o] = (p[idx * 3] ?? 0) as number;
        rgba[o + 1] = (p[idx * 3 + 1] ?? 0) as number;
        rgba[o + 2] = (p[idx * 3 + 2] ?? 0) as number;
        rgba[o + 3] = (paletteAlpha?.[idx] ?? 255) as number;
      } else if (colorType === 0 || colorType === 4) {
        const g = lines[s] as number;
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = colorType === 4 ? ((lines[s + step] ?? 255) as number) : 255;
      } else {
        rgba[o] = lines[s] as number;
        rgba[o + 1] = lines[s + step] as number;
        rgba[o + 2] = lines[s + 2 * step] as number;
        rgba[o + 3] = colorType === 6 ? ((lines[s + 3 * step] ?? 255) as number) : 255;
      }
    }
  }
  return { width, height, rgba };
}

/**
 * How white a raster's ground is, as the **median** luminance of its border ring, 0–1.
 *
 * The median rather than the mean, because a drawing is allowed to touch its own edge: one
 * arrow running off the side moves a mean and does not move a median, and what is being
 * asked is what the *paper* is, not what the darkest thing on it is.
 *
 * Transparent pixels count as white. That is not a dodge — the board is painted behind the
 * raster, so a transparent corner is a corner where the paper shows through, which is the
 * outcome this check exists to protect. (Real alpha end to end is the audit's S5.6, deferred
 * until a dark-surface style pack makes an opaque white ground visible everywhere rather
 * than only at the card's edge.)
 *
 * `undefined` when the PNG could not be read — see this file's header on abstaining.
 */
export function groundWhiteness(png: Buffer, bandFraction = 0.04): number | undefined {
  const img = readPng(png);
  if (!img) return undefined;
  const { width: w, height: h, rgba } = img;
  const band = Math.max(1, Math.round(Math.min(w, h) * bandFraction));
  const lum: number[] = [];
  const push = (x: number, y: number): void => {
    const o = (y * w + x) * 4;
    const a = (rgba[o + 3] as number) / 255;
    // Composite over white: what a viewer sees is the raster on the board's paper.
    const r = (rgba[o] as number) * a + 255 * (1 - a);
    const g = (rgba[o + 1] as number) * a + 255 * (1 - a);
    const b = (rgba[o + 2] as number) * a + 255 * (1 - a);
    // Rounded back to the eight bits it came from before the divide: the three luminance
    // weights sum to 1 only to within a ULP, and a pure white page has to read as exactly
    // 1 rather than as 0.9999999999999999.
    lum.push(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  };
  for (let y = 0; y < h; y++) {
    const edgeRow = y < band || y >= h - band;
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < band || x >= w - band) push(x, y);
    }
  }
  if (lum.length === 0) return undefined;
  lum.sort((a, b) => a - b);
  return lum[Math.floor(lum.length / 2)] as number;
}
