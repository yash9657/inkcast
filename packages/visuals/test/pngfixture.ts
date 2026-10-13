/**
 * A PNG encoder, for tests only.
 *
 * `png.ts` reads pixels; nothing in the repo writes them, so a fixture has to be built
 * rather than checked in. Building it here also means the reader is tested against bytes
 * this repo produced from a known image, instead of against a blob nobody can inspect.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

export type Rgba = [number, number, number, number];

/**
 * Encode `w`×`h` pixels as a PNG, one IDAT.
 *
 * `at(x, y)` returns the pixel, so a fixture reads as the picture it is: a white page with
 * a black bar down the middle is one line here and unambiguous at the assertion.
 *
 * `filter` writes every scanline under one filter type by inverting the reconstruction the
 * reader does. Filters are the one part of the format where a wrong line is silently a
 * different picture rather than an error, so the reader is checked against all five.
 */
export function makePng(
  w: number,
  h: number,
  at: (x: number, y: number) => Rgba,
  opts: { colorType?: 0 | 2 | 6; filter?: 0 | 1 | 2 | 3 | 4 } = {},
): Buffer {
  const colorType = opts.colorType ?? 6;
  const filter = opts.filter ?? 0;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * channels;

  // The unfiltered scanlines first — the picture as the reader must end up seeing it.
  const lines: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = at(x, y);
      if (colorType === 0) row.push(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
      else if (colorType === 2) row.push(r, g, b);
      else row.push(r, g, b, a);
    }
    lines.push(row);
  }

  const raw = Buffer.alloc(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    const out = y * (1 + stride);
    raw[out] = filter;
    const row = lines[y] as number[];
    const prev = y > 0 ? (lines[y - 1] as number[]) : undefined;
    for (let i = 0; i < stride; i++) {
      const cur = row[i] as number;
      const a = i >= channels ? (row[i - channels] as number) : 0;
      const b = prev ? (prev[i] as number) : 0;
      const c = prev && i >= channels ? (prev[i - channels] as number) : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const sub =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? (a + b) >> 1
              : filter === 4
                ? pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
                : 0;
      raw[out + 1 + i] = (cur - sub) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A page of one colour. */
export function flatPng(w: number, h: number, colour: Rgba, colorType?: 0 | 2 | 6): Buffer {
  return makePng(w, h, () => colour, colorType ? { colorType } : {});
}
