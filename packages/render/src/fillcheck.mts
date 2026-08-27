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
 *
 * ## The per-scene table, and why it is the useful half
 *
 * The mean is one number for a film made of several lanes, and on a `wipe` board those lanes
 * differ by a factor of four: measured across the shipped lessons at `explainer`
 * (2026-08-26), a plot beat carries 42–69% of the frame, a card built from a generated
 * picture 28–44%, a card of hand-placed marks 13–50% depending entirely on how much the beat
 * has to draw. So a film's mean says almost nothing without knowing what its beats are made
 * of, which is why each scene is listed with its role, the two factors behind its fill, and
 * the element kinds it holds:
 *
 * - **held** — how much of the frame the camera was asked to hold. Bounded by the safe area
 *   (76.5% on 16:9) and cut further whenever the ink's shape is unlike the frame's.
 * - **cover** — how much of *that* the ink covers. A property of the drawing, not the shot;
 *   no camera can fix it. `packages/planner/src/draw-geom.ts` predicts it from the marks
 *   before anything is drawn.
 */
import { readFileSync } from 'node:fs';
import { parseStoryboard } from '@inkcast/core';
import { contentFill, resolveFraming, viewRect } from '@inkcast/core';

const file = process.argv[2];
if (!file) throw new Error('usage: fillcheck.mts <project>/storyboard.json');

const sb = parseStoryboard(JSON.parse(readFileSync(file, 'utf8')));
const vertical = sb.meta.aspect === '9:16';
const frame = { w: vertical ? 1080 : 1920, h: vertical ? 1920 : 1080 };
const framing = resolveFraming(sb, frame);
const fills = contentFill(framing, sb.canvas, frame);
const pct = (v: number): string => `${(v * 100).toFixed(0)}%`.padStart(4);
const mean = fills.reduce((a, b) => a + b, 0) / fills.length;

sb.scenes.forEach((scene, i) => {
  const f = framing[i];
  const fill = fills[i] as number;
  if (!f) return;
  const view = viewRect(f.camera, sb.canvas, frame);
  const area = view.w * view.h;
  const held = f.target && area > 0 ? Math.min(1, (f.target.w * f.target.h) / area) : undefined;
  const kinds = new Map<string, number>();
  for (const el of scene.elements) kinds.set(el.type, (kinds.get(el.type) ?? 0) + 1);
  console.log(
    `${String(i).padStart(2)} ${scene.id.padEnd(6)} ${(scene.role ?? '-').padEnd(13)}` +
      ` fill ${pct(fill)}  held ${held === undefined ? '   -' : pct(held)}` +
      `  cover ${held ? pct(fill / held) : '   -'}  ` +
      [...kinds].map(([k, n]) => `${k}:${n}`).join(' '),
  );
});

console.log(
  `${sb.meta.aspect}  ${frame.w}x${frame.h}  mean content fill ${(mean * 100).toFixed(1)}% ` +
    `(min ${pct(Math.min(...fills))}, max ${pct(Math.max(...fills))}) across ${fills.length} scenes`,
);
