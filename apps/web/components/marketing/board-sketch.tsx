import { inkCirclePath, inkStrokePath } from '@/components/ui';
import { cn, randomFromSeed } from '@/lib/utils';

import type { ShowcaseAspect } from './site-config';

/**
 * A board, sketched. Not a screenshot, not a mockup of one — geometry.
 *
 * This is what a format card shows when no showcase film is attached to the
 * deployment (`showcaseProjects` in `site-config.ts`). The honest options for
 * that state were: a grey box, a stock image, or a drawing of the shape of the
 * thing. A grey box says the page is broken, a stock image would be the exact
 * invented-asset lie `site-config.ts` forbids, and this says "a title, some
 * lines, a circled idea, in this frame shape" — which is true of every film the
 * renderer makes, and claims nothing about a specific one. It is marked
 * `aria-hidden` for the same reason: there is no content in it to describe, and
 * the card's own text carries the format.
 *
 * Every stroke comes from `inkStrokePath`/`inkCirclePath` and one seeded PRNG,
 * the same generators the hero's `InkUnderline` uses — so the server and the
 * client emit identical path data (no hydration mismatch), a re-render does not
 * re-roll the wobble, and the whole thing costs zero bytes of image.
 *
 * Coordinates are written as fractions of the frame and multiplied out, so the
 * same composition reads correctly at 16:9, 9:16 and 1:1 instead of needing
 * three hand-tuned layouts that would drift apart.
 */

const VIEWBOX: Record<ShowcaseAspect, { w: number; h: number }> = {
  '16:9': { w: 320, h: 180 },
  '9:16': { w: 180, h: 320 },
  '1:1': { w: 240, h: 240 },
};

/** Line lengths as fractions of the width, in the order a hand writes them. */
const BODY_LINES = [
  { y: 0.42, from: 0.12, to: 0.78 },
  { y: 0.5, from: 0.12, to: 0.66 },
  { y: 0.58, from: 0.12, to: 0.5 },
];

export function BoardSketch({
  aspect,
  seed,
  className,
}: {
  aspect: ShowcaseAspect;
  /** Different per card, so three sketches on one row are not triplets. */
  seed: number;
  className?: string;
}) {
  const { w, h } = VIEWBOX[aspect];
  const rand = randomFromSeed(seed);
  const x = (f: number) => w * f;
  const y = (f: number) => h * f;

  const title = inkStrokePath(
    rand,
    { x: x(0.12), y: y(0.2) },
    { x: x(0.62), y: y(0.2) },
    {
      amplitude: 2.6,
    },
  );
  const titleUnderline = inkStrokePath(
    rand,
    { x: x(0.12), y: y(0.26) },
    { x: x(0.55), y: y(0.26) },
    {
      amplitude: 2,
    },
  );
  const body = BODY_LINES.map((line) =>
    inkStrokePath(
      rand,
      { x: x(line.from), y: y(line.y) },
      { x: x(line.to), y: y(line.y) },
      {
        amplitude: 1.6,
      },
    ),
  );
  const ring = inkCirclePath(
    rand,
    { cx: x(0.7), cy: y(0.76), rx: w * 0.16, ry: h * 0.11 },
    { amplitude: 2.4 },
  );
  // An arrow is a shaft and two barbs, drawn as three strokes rather than as a
  // marker: a `<marker>` element would not wobble with the line it ends.
  const shaft = inkStrokePath(
    rand,
    { x: x(0.2), y: y(0.74) },
    { x: x(0.5), y: y(0.76) },
    {
      amplitude: 1.4,
    },
  );
  const barbA = inkStrokePath(
    rand,
    { x: x(0.5), y: y(0.76) },
    { x: x(0.43), y: y(0.71) },
    {
      segments: 2,
      amplitude: 0.8,
    },
  );
  const barbB = inkStrokePath(
    rand,
    { x: x(0.5), y: y(0.76) },
    { x: x(0.43), y: y(0.81) },
    {
      segments: 2,
      amplitude: 0.8,
    },
  );

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
      className={cn('block bg-paper', className)}
      fill="none"
      strokeLinecap="round"
    >
      <g className="stroke-ink" strokeWidth={w * 0.018}>
        <path d={title} />
      </g>
      <g className="stroke-primary" strokeWidth={w * 0.012}>
        <path d={titleUnderline} opacity={0.9} />
        <path d={ring} />
      </g>
      <g className="stroke-ink" strokeWidth={w * 0.008} opacity={0.55}>
        {body.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g className="stroke-ink" strokeWidth={w * 0.009}>
        <path d={shaft} />
        <path d={barbA} />
        <path d={barbB} />
      </g>
    </svg>
  );
}
