/**
 * Mean content fill for a rendered storyboard, without re-rendering it.
 *
 *     npx tsx packages/render/src/fillcheck.mts <project>/storyboard.json
 *
 * `STATUS.md` quotes this number every time it is written, and until now the only way to
 * get it was `reportFill`'s **debug**-level log line during a four-minute render — so it
 * tended to be copied forward from the previous report rather than measured. This reads
 * the finished storyboard and computes it in about a second.
 *
 * Read it as a regression check and not as a target. `contentFill` is the union of element
 * *bounding boxes* over the view area, so one hand-drawn diagonal line counts as a full
 * box of content: the metric rewards big sparse shapes, and a board can improve while the
 * number falls. Look at frames as well.
 */
import { readFileSync } from 'node:fs';
import { parseStoryboard } from '@inkcast/core';
import { contentFill, resolveFraming } from './camera.js';

const file = process.argv[2];
if (!file) throw new Error('usage: fillcheck.mts <project>/storyboard.json');

const sb = parseStoryboard(JSON.parse(readFileSync(file, 'utf8')));
const vertical = sb.meta.aspect === '9:16';
const frame = { w: vertical ? 1080 : 1920, h: vertical ? 1920 : 1080 };
const fills = contentFill(resolveFraming(sb, frame), sb.canvas, frame);
const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
const mean = fills.reduce((a, b) => a + b, 0) / fills.length;

console.log(
  `${sb.meta.aspect}  ${frame.w}x${frame.h}  mean content fill ${(mean * 100).toFixed(1)}% ` +
    `(min ${pct(Math.min(...fills))}, max ${pct(Math.max(...fills))}) across ${fills.length} scenes`,
);
