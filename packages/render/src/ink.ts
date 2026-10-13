/**
 * What counts as ink, in pixels — one definition, for the tool that scores a film and
 * the gate that checks one.
 *
 * This was `inkstat.mts`'s private arithmetic, and it moved here when the Tier-2 gate
 * (plan item 3.3) needed the same measurement on a frame it had just captured rather
 * than on a finished mp4. Two implementations of "is this pixel ink" would be the A-4
 * defect again in its cheapest form: the bake-off scores Golpo's films and ours with
 * the same instrument (plan item 8.2), and an instrument that disagrees with the gate
 * about what ink is cannot settle anything.
 *
 * ## Why pixels rather than boxes
 *
 * `contentFill` — the fill gate's measure (plan 2.6) — is the union of element
 * *bounding boxes* over the view, so an outlined heart scores its whole box and a
 * single diagonal line scores a rectangle. Measured on `projects/cardiac5`:
 * `fillcheck` says 21.6% and the real figure is **4.7% of pixels**. That gap is the
 * whole reason both measures exist. Boxes are a fine regression check on layout and a
 * bad density target, and a box measure is gameable by exactly the fix a failing fill
 * gate invites — inflate the box. Pixels are not: a shape that is mostly hole, an
 * empty box and a generously framed camera all score what they really are.
 */
import { spawn } from 'node:child_process';

/**
 * Paper is `#fcfbf9` and the grid dots are a few percent of ink over it. A pixel counts
 * as ink when it is meaningfully darker than paper **or** meaningfully coloured — the
 * second clause matters, because a saturated accent stroke can be lighter than the
 * threshold and is unquestionably ink.
 */
export const DARK_ENOUGH = 225;
export const SATURATED_ENOUGH = 30;

/**
 * Luminance of the default light paper, and the gap from it that makes a pixel ink.
 *
 * **This used to be the whole rule, as `lum < DARK_ENOUGH`, and on a dark board it made
 * the instrument meaningless.** `statFrame` is what `inkstat.mts` scores a film with, what
 * `MIN_INK_SHARE` (`ink-floor`) gates on, and what `blank-run` counts — and all three were
 * asking "is this pixel dark", which on slate or navy is true of the *paper*. Measured
 * 2026-08-27: `projects/qc92-chalk`, a reviewed chalk film, reads **99.2% ink**, and its
 * light-board sibling `cardiac9` reads 4.4%. So `ink-floor` passed vacuously on every dark
 * board ever rendered, and `blank-run` could not have fired on one however empty it was.
 *
 * The rule is now a *distance* from the board’s own paper — in luminance and in chroma both —
 * on a dark board the ink is lighter than the ground rather than darker. `INK_LUMA_GAP` is
 * exactly `PAPER_LUMA - DARK_ENOUGH`, so on the default paper the comparison reduces to
 * `lum < 225` term for term and no light-board number in this repo moves — including the
 * corpus derivation behind `MIN_INK_SHARE`, which was taken with the old rule.
 */
export const PAPER_LUMA = 0.299 * 0xfc + 0.587 * 0xfb + 0.114 * 0xf9;
export const INK_LUMA_GAP = PAPER_LUMA - DARK_ENOUGH;
/** Chroma of the default light paper — `#fcfbf9` is very nearly neutral. */
export const PAPER_CHROMA = 0xfc - 0xf9;

/** The board's ground as the two numbers `statFrame` compares against. */
export function groundOf(hex: string | undefined): { luma: number; chroma: number } {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return { luma: PAPER_LUMA, chroma: PAPER_CHROMA };
  const v = parseInt(m[1] as string, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return {
    luma: 0.299 * r + 0.587 * g + 0.114 * b,
    chroma: Math.max(r, g, b) - Math.min(r, g, b),
  };
}
/** A hue has to be this saturated before it is a hue rather than a grey with a cast. */
export const HUE_SATURATION = 45;
/** Hues holding less than this share of the ink are noise — anti-aliasing, mostly. */
export const HUE_FLOOR = 0.01;

export type FrameStat = { ink: number; hues: Map<number, number> };

/**
 * Ink pixels and hue buckets in one rgb24 frame.
 *
 * `paper` is the board's own ground as `#rrggbb`; omitted, it is the default light paper
 * and every number this returns is what it returned before `INK_LUMA_GAP` existed. Pass
 * it wherever the board is known — a dark pack measured against the light default reports
 * its own paper as ink and reads ~99%.
 */
export function statFrame(buf: Buffer, w: number, h: number, paper?: string): FrameStat {
  const hues = new Map<number, number>();
  const ground = groundOf(paper);
  let ink = 0;
  for (let i = 0; i < w * h * 3; i += 3) {
    const r = buf[i] as number;
    const g = buf[i + 1] as number;
    const b = buf[i + 2] as number;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Both clauses measured *against the board*, not against absolutes. The second one is
    // why a navy pack still read 99.9% after the first was made relative: `#14304a` has a
    // chroma of 54, so "meaningfully coloured" was true of every pixel of the paper.
    if (Math.abs(lum - ground.luma) <= INK_LUMA_GAP && chroma <= ground.chroma + SATURATED_ENOUGH) {
      continue;
    }
    ink++;
    if (chroma <= HUE_SATURATION) continue;
    const deg =
      max === r
        ? (60 * (g - b)) / chroma + 360
        : max === g
          ? (60 * (b - r)) / chroma + 120
          : (60 * (r - g)) / chroma + 240;
    // 30° buckets: fine enough to tell blue from orange, coarse enough that one stroke's
    // anti-aliased edge does not read as its own colour.
    const bucket = (Math.round((deg % 360) / 30) * 30) % 360;
    hues.set(bucket, (hues.get(bucket) ?? 0) + 1);
  }
  return { ink, hues };
}

/**
 * Raw rgb24 frames off ffmpeg's stdout, cut into exact frame-sized buffers.
 *
 * `fps` is undefined for a still, and it has to be: an `fps` filter on a single-frame
 * input samples a zero-length timeline and yields nothing at all, which reads as a
 * decode failure rather than as the wrong filter. A still is the common case —
 * `frames.mts` writes PNGs and they are what most defects are found in.
 */
export async function* rawFrames(
  file: string,
  w: number,
  h: number,
  fps?: string,
): AsyncGenerator<Buffer> {
  const size = w * h * 3;
  const child = spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      ...(fps ? ['-vf', `fps=${fps}`] : []),
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  let held: Buffer = Buffer.alloc(0);
  for await (const chunk of child.stdout) {
    held = Buffer.concat([held, chunk as Uint8Array]);
    while (held.length >= size) {
      yield held.subarray(0, size);
      held = held.subarray(size);
    }
  }
  const code: number = await new Promise((res) => child.on('close', (c) => res(c ?? -1)));
  if (code !== 0) throw new Error(`ffmpeg exited ${code}\n${stderr.trim()}`);
}

/**
 * The ink share of one PNG, decoded through ffmpeg on a pipe.
 *
 * ffmpeg rather than an image library for the reason `inkstat.mts` gives about frames:
 * it is already a hard requirement — nothing here can encode a video without it — and
 * `-pix_fmt rgb24` hands back exactly the bytes `statFrame` wants. Nothing touches the
 * disk. Returns `undefined` when the decode fails, because a gate that cannot measure a
 * frame must report that it could not rather than that the frame was empty.
 */
export async function inkShare(
  png: Uint8Array,
  size: { w: number; h: number },
  paper?: string,
): Promise<number | undefined> {
  const child = spawn(
    'ffmpeg',
    ['-v', 'error', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const chunks: Buffer[] = [];
  child.stdout.on('data', (d: Buffer) => chunks.push(d));
  child.stderr.resume();
  child.stdin.on('error', () => undefined); // a failed decode closes the pipe early
  child.stdin.end(Buffer.from(png));
  const code: number = await new Promise((res) => child.on('close', (c) => res(c ?? -1)));
  const buf = Buffer.concat(chunks);
  if (code !== 0 || buf.length < size.w * size.h * 3) return undefined;
  return statFrame(buf, size.w, size.h, paper).ink / (size.w * size.h);
}
