/**
 * How much ink is actually on the board, counted in pixels.
 *
 *     npx tsx packages/render/src/inkstat.mts <video.mp4> [samplesPerMinute]
 *
 * `fillcheck.mts` measures the union of element *bounding boxes* over the view, so an
 * outlined heart scores its whole box and a single diagonal line scores a rectangle. That
 * makes it a fine regression check on layout and a bad density target, which its own header
 * says. Nobody had put a number on the gap: measured on `projects/cardiac5/out.mp4`,
 * `fillcheck` reports 21.6% mean content fill and **the real figure is 4.7% of pixels.**
 *
 * This reads the finished film instead of the storyboard, so it cannot be gamed by a big
 * empty box, by a shape that is mostly hole, or by a camera that frames generously. It is
 * the number the figure lane is judged on — see `docs/PLAN-FIGURE-LANE.md`.
 *
 * It also counts hue, because "colour that means something" is the other half of the same
 * plan and it is trivially measurable: a board drawn in one ink plus one accent reports two
 * hues, and a board of semantic anatomical figures should report four or five with none of
 * them a rounding error.
 *
 * No new dependency: ffmpeg is already required to encode a video at all, and
 * `-f rawvideo -pix_fmt rgb24` hands back exactly the bytes this needs. Frames never touch
 * the disk, the same way the encoder never lets them.
 */
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { ensureFfmpeg, probeMedia } from './ffmpeg.js';

/**
 * Paper is `#fcfbf9` and the grid dots are a few percent of ink over it. A pixel counts as
 * ink when it is meaningfully darker than paper **or** meaningfully coloured — the second
 * clause matters, because a saturated accent stroke can be lighter than the threshold and
 * is unquestionably ink.
 */
const DARK_ENOUGH = 225;
const SATURATED_ENOUGH = 30;
/** A hue has to be this saturated before it is a hue rather than a grey with a cast. */
const HUE_SATURATION = 45;
/** Hues holding less than this share of the ink are noise — anti-aliasing, mostly. */
const HUE_FLOOR = 0.01;

type FrameStat = { ink: number; hues: Map<number, number> };

function statFrame(buf: Buffer, w: number, h: number): FrameStat {
  const hues = new Map<number, number>();
  let ink = 0;
  for (let i = 0; i < w * h * 3; i += 3) {
    const r = buf[i] as number;
    const g = buf[i + 1] as number;
    const b = buf[i + 2] as number;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= DARK_ENOUGH && chroma <= SATURATED_ENOUGH) continue;
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
 * `fps` is undefined for a still, and it has to be: an `fps` filter on a single-frame input
 * samples a zero-length timeline and yields nothing at all, which reads as a decode failure
 * rather than as the wrong filter. A still is the common case — `frames.mts` writes PNGs and
 * they are what most defects are found in.
 */
async function* frames(
  file: string,
  w: number,
  h: number,
  fps: string | undefined,
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

const [file, perMinuteArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: inkstat.mts <video.mp4> [samplesPerMinute]');
  process.exit(2);
}

await ensureFfmpeg();
const info = await probeMedia(file);
const video = info?.video;
if (!video) throw new Error(`${file} has no video stream`);
const { width: w, height: h } = video;

// Default to roughly six samples a minute, which is one per beat on a standard film and
// cheap enough that nobody avoids running it.
const perMinute = Number(perMinuteArg ?? 6);
// A still has no duration to sample across, so it is measured whole.
const still = !(info.duration && info.duration > 0);
const fps = still ? undefined : `${perMinute}/60`;

const stats: FrameStat[] = [];
for await (const frame of frames(file, w, h, fps)) stats.push(statFrame(frame, w, h));
if (stats.length === 0) throw new Error(`no frames decoded from ${file}`);

const px = w * h;
const shares = stats.map((s) => s.ink / px);
const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

console.log(`${basename(file)}  ${w}x${h}  ${stats.length} frames sampled`);
console.log(
  `mean ink ${pct(mean)}  (min ${pct(Math.min(...shares))}, max ${pct(Math.max(...shares))})`,
);

const totalInk = stats.reduce((a, s) => a + s.ink, 0);
const hues = new Map<number, number>();
for (const s of stats) for (const [deg, n] of s.hues) hues.set(deg, (hues.get(deg) ?? 0) + n);
const named = [...hues.entries()]
  .filter(([, n]) => n / totalInk >= HUE_FLOOR)
  .sort((a, b) => b[1] - a[1]);
console.log(
  named.length === 0
    ? 'hues: none — every mark is one ink'
    : `hues: ${named.map(([deg, n]) => `${deg}° ${pct(n / totalInk)}`).join('  ')}`,
);

// Per-frame, so a mean of 5% built from one full frame and nine empty ones is visible as
// what it is. The frame index is a sample number, not a second: multiply by 60/perMinute.
if (!still) {
  for (const [i, s] of stats.entries()) {
    const at = Math.round((i * 60) / perMinute);
    console.log(`  ${String(at).padStart(4)}s  ${pct(s.ink / px).padStart(6)}`);
  }
}
