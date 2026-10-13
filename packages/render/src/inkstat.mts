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
import { basename } from 'node:path';
import { ensureFfmpeg, probeMedia } from './ffmpeg.js';
// What counts as ink lives in `./ink.ts` — one definition, shared with the Tier-2 gate
// that measures a frame it just captured (plan 3.3). Two implementations of "is this
// pixel ink" would make the bake-off's instrument and the gate's disagree, and the whole
// point of scoring both films with the same tool is that they cannot.
import { HUE_FLOOR, rawFrames, statFrame, type FrameStat } from './ink.js';

const [file, perMinuteArg, paperArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: inkstat.mts <video.mp4> [samplesPerMinute] [paper #rrggbb]');
  process.exit(2);
}
// The board's own ground. Without it a dark pack is scored against the light default and
// reports its *paper* as ink — `projects/qc92-chalk` reads 99.2% that way. See `statFrame`.
// A project directory's `storyboard.json` names the pack; `stylePacks()` has its palette.
if (paperArg !== undefined && !/^#?[0-9a-f]{6}$/i.test(paperArg)) {
  console.error(`paper must be #rrggbb, got "${paperArg}"`);
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
for await (const frame of rawFrames(file, w, h, fps)) stats.push(statFrame(frame, w, h, paperArg));
if (stats.length === 0) throw new Error(`no frames decoded from ${file}`);

const px = w * h;
const shares = stats.map((s) => s.ink / px);
const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

console.log(
  `${basename(file)}  ${w}x${h}  ${stats.length} frames sampled` +
    (paperArg ? `  against paper ${paperArg}` : ''),
);
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
