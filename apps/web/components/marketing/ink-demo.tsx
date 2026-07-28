'use client';

import * as React from 'react';
import { RotateCcwIcon } from 'lucide-react';

import { Button, inkCirclePath, inkStrokePath } from '@/components/ui';
import { cn, randomFromSeed } from '@/lib/utils';

/**
 * The hero visual: a whiteboard that actually draws itself.
 *
 * This is not a screenshot and not a video file. It is one SVG board, 1280×640
 * canvas units wide, with a camera that tours three framings across it while
 * strokes appear by animating `stroke-dashoffset` from 1 to 0 on paths with
 * `pathLength="1"` — the same technique `components/ui/ink.tsx` uses for the
 * flourishes, and the same technique the renderer uses for real.
 *
 * It is built this way because the product's whole claim is visible in the
 * mechanics rather than in the copy:
 *
 * - **Nothing ever wipes.** Every stroke that arrives stays. The last beat
 *   underlines the title drawn in the first beat, which is only possible because
 *   the title is still on the board — `persist: true` in
 *   `packages/core/src/storyboard.ts` expressed as a picture.
 * - **The camera moves, the board does not.** `FRAMINGS` below is the same shape
 *   as the IR's `Scene.camera` (`{x, y, zoom}` on one canvas), so the demo is a
 *   faithful reduction of what the renderer does rather than an impression of it.
 * - **Geometry is seeded, not random.** Every wobble comes from
 *   `randomFromSeed`, so the server and the client emit byte-identical paths and
 *   nothing re-rolls on re-render.
 *
 * Timings are expressed in *beats*, and one beat is `--transition-duration-slower`
 * (480ms), so the tempo is derived from the motion tokens rather than invented.
 * The board draws once and then stays finished — it does not loop, because a loop
 * on a whiteboard demo would have to clear the board to start again, and clearing
 * the board is the exact failure this product exists to avoid. "Draw it again"
 * replays it on demand instead.
 *
 * Reduced motion is almost free: the global `prefers-reduced-motion` rule in
 * `globals.css` collapses every animation to 1ms, and because each keyframe's
 * *end* state is "drawn" and the camera's end framing is the whole board, the
 * result is the completed board, instantly. The one thing that global rule cannot
 * cover is this component's delay ladder — see the note beside the media query in
 * `STYLESHEET` for why zeroing it is completing that rule rather than repeating
 * it.
 */

/* ------------------------------------------------------------------ geometry */

type Pt = { x: number; y: number };

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The frame the camera looks through, in canvas units. 16:9, like the output. */
const VIEW = { w: 720, h: 405 } as const;

/**
 * A camera framing: the point on the canvas to centre, and how far to zoom in.
 * `zoom: 1` means one canvas unit per output unit; the board is wider than the
 * frame on purpose, so the tour has somewhere to go.
 */
type Framing = { x: number; y: number; zoom: number };

const FRAMINGS = {
  /** Beat 1: the title, written large in the top-left of the board. */
  title: { x: 300, y: 128, zoom: 1.25 },
  /** Beat 2: pan right and down to the empty half, and build the plot there. */
  plot: { x: 900, y: 395, zoom: 0.98 },
  /** Beat 3: pull back. Everything drawn so far is still there. */
  board: { x: 639, y: 344, zoom: 0.6 },
} as const satisfies Record<string, Framing>;

function framingTransform({ x, y, zoom }: Framing): string {
  return `translate(${r2(VIEW.w / 2 - x * zoom)}px, ${r2(VIEW.h / 2 - y * zoom)}px) scale(${zoom})`;
}

/**
 * A Catmull-Rom spline through the given points, emitted as cubic béziers. Used
 * for the loss curve: a hand draws a smooth valley in one continuous motion, so
 * a chain of straight segments would read wrong however much you jitter it.
 */
function smoothPath(pts: readonly Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${r2(pts[0]!.x)} ${r2(pts[0]!.y)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${r2(c1.x)} ${r2(c1.y)} ${r2(c2.x)} ${r2(c2.y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

/** Nudge interior points off the ideal so the curve looks drawn, not plotted. */
function jittered(rand: () => number, pts: readonly Pt[], amplitude: number): Pt[] {
  return pts.map((p, i) =>
    i === 0 || i === pts.length - 1
      ? { ...p }
      : { x: p.x + (rand() - 0.5) * amplitude, y: p.y + (rand() - 0.5) * amplitude },
  );
}

/**
 * A hand-drawn arrow as three strokes: shaft, then two head wings drawn back
 * from the tip. Three separate paths rather than one, because that is the order
 * a hand does it in and each one draws on independently.
 */
function arrowStrokes(rand: () => number, from: Pt, to: Pt, head = 18): [string, string, string] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = (sign: number): Pt => ({
    x: to.x - Math.cos(angle + sign * 0.46) * head,
    y: to.y - Math.sin(angle + sign * 0.46) * head,
  });
  return [
    inkStrokePath(rand, from, to, { segments: 4, amplitude: 1.8 }),
    inkStrokePath(rand, wing(1), to, { segments: 2, amplitude: 0.6 }),
    inkStrokePath(rand, wing(-1), to, { segments: 2, amplitude: 0.6 }),
  ];
}

/* -------------------------------------------------------------- the timeline */

/**
 * One beat is `--transition-duration-slower`. Every delay and duration below is
 * a multiple of it, so the whole performance is a function of one motion token.
 *
 * The beat map, for anyone adjusting it — the last stroke must land before the
 * end, and every stroke must land inside the framing that shows it:
 *
 *   0.6 – 3.2    write the title              (framing: title)
 *   4.8 – 7.6    camera pans right and down
 *   7.6 – 12.6   axes, then the loss curve    (framing: plot)
 *  12.8 – 14.3   axis labels
 *  14.4 – 17.7   three steps and their arrows
 *  17.4 – 19.3   "one step downhill" and the arrow that points at it
 *  19.6 – 21.9   camera pulls back
 *  22.4 – 24.7   ring the minimum, label it   (framing: board)
 *  25.4 – 27.2   underline the title from beat 1
 */
const TOTAL_BEATS = 28;

/**
 * When the camera holds and when it travels, in beats — the same unit as
 * everything else, so a change to `TOTAL_BEATS` cannot silently desync the
 * camera from the strokes the way hardcoded keyframe percentages would.
 */
const CAMERA_CUES = {
  titleUntil: 4.8,
  plotFrom: 7.6,
  plotUntil: 19.6,
  boardFrom: 21.9,
} as const;

function cameraKeyframes(): string {
  const pct = (beats: number) => `${r2((beats / TOTAL_BEATS) * 100)}%`;
  const ease = 'animation-timing-function: var(--ease-in-out);';
  return [
    `  0%, ${pct(CAMERA_CUES.titleUntil)} { transform: ${framingTransform(FRAMINGS.title)}; ${ease} }`,
    `  ${pct(CAMERA_CUES.plotFrom)}, ${pct(CAMERA_CUES.plotUntil)} { transform: ${framingTransform(FRAMINGS.plot)}; ${ease} }`,
    `  ${pct(CAMERA_CUES.boardFrom)}, 100% { transform: ${framingTransform(FRAMINGS.board)}; }`,
  ].join('\n');
}

/** Inline `animation-delay` / `animation-duration`, in beats. */
function at(start: number, beats: number): React.CSSProperties {
  return {
    animationDelay: `calc(var(--beat) * ${start})`,
    animationDuration: `calc(var(--beat) * ${beats})`,
  };
}

/** As `at()`, plus the wipe distance a written line has to travel. */
function write(start: number, beats: number, wipe: number): React.CSSProperties {
  return {
    animationDelay: `calc(var(--beat) * ${start})`,
    animationDuration: `calc(var(--beat) * ${beats})`,
    '--wipe': `${-wipe}px`,
  } as React.CSSProperties;
}

/* --------------------------------------------------------------- the content */

/** The loss curve: a valley, low around x = 952. */
const CURVE: readonly Pt[] = [
  { x: 730, y: 250 },
  { x: 800, y: 352 },
  { x: 872, y: 428 },
  { x: 952, y: 458 },
  { x: 1034, y: 424 },
  { x: 1112, y: 336 },
  { x: 1168, y: 262 },
];

/** Three steps walking downhill toward the minimum. */
const STEPS: readonly Pt[] = [
  { x: 762, y: 296 },
  { x: 872, y: 428 },
  { x: 952, y: 458 },
];

type Written = {
  /** Text baseline start. */
  x: number;
  y: number;
  size: number;
  /** Clip box, deliberately wider than the glyphs so no tail can be cut off. */
  clip: { x: number; y: number; w: number; h: number };
};

const TITLE: Written = {
  x: 90,
  y: 140,
  size: 46,
  clip: { x: 78, y: 86, w: 470, h: 78 },
};

const LABELS = {
  loss: { x: 606, y: 228, size: 24, clip: { x: 596, y: 198, w: 124, h: 42 } },
  theta: { x: 1150, y: 548, size: 26, clip: { x: 1140, y: 516, w: 68, h: 46 } },
  step: { x: 990, y: 262, size: 26, clip: { x: 980, y: 230, w: 300, h: 46 } },
  minimum: { x: 1000, y: 576, size: 26, clip: { x: 990, y: 544, w: 220, h: 46 } },
} as const satisfies Record<string, Written>;

/* ------------------------------------------------------------ the stylesheet */

/**
 * Four keyframes and the rules that bind them to `data-ink`, generated here
 * rather than added to `globals.css` — that file is the design system's, and a
 * bespoke hero illustration's choreography is not a design token.
 *
 * Every value it introduces is derived: the tempo from
 * `--transition-duration-slower`, the curves from `--ease-out-quart`,
 * `--ease-in-out` and `--ease-overshoot`, and the camera transforms from
 * `FRAMINGS` above.
 */
const STYLESHEET = `
.inkcast-demo { --beat: var(--transition-duration-slower); }

.inkcast-demo [data-ink] {
  animation-duration: var(--beat);
  animation-fill-mode: both;
  animation-timing-function: var(--ease-out-quart);
  /* Running by default, so a visitor with JavaScript disabled still gets the
     performance. The hold below is progressive enhancement. */
  animation-play-state: running;
}

/* The board is in the hero, which at 360px is taller than the viewport — so on a
   phone the demo would finish before it was ever on screen. When JS is present
   and the board starts off screen it is held at its first frame until it is
   scrolled to. */
.inkcast-demo[data-hold='true'] [data-ink] { animation-play-state: paused; }

.inkcast-demo [data-ink='draw'] {
  stroke-dasharray: 1;
  animation-name: inkcast-demo-draw;
}

.inkcast-demo [data-ink='write'] { animation-name: inkcast-demo-write; }

.inkcast-demo [data-ink='pop'] {
  animation-name: inkcast-demo-pop;
  animation-timing-function: var(--ease-overshoot);
  transform-box: fill-box;
  transform-origin: center;
}

.inkcast-demo [data-ink='camera'] {
  animation-name: inkcast-demo-camera;
  animation-timing-function: linear;
  transform-box: view-box;
  transform-origin: 0 0;
}

@keyframes inkcast-demo-draw {
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
}

@keyframes inkcast-demo-write {
  from { transform: translateX(var(--wipe, -1200px)); }
  to { transform: translateX(0); }
}

@keyframes inkcast-demo-pop {
  from { opacity: 0; transform: scale(0.55); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes inkcast-demo-camera {
${cameraKeyframes()}
}

/* The global reduce rule in globals.css collapses every animation's duration and
   iteration count, which is the right thing and is not re-implemented here. What
   it cannot know about is this component's 28-beat *delay* ladder: left alone, a
   visitor who asked for less motion would still watch the board assemble itself
   over thirteen seconds, one element at a time. Zeroing the delays is what
   actually delivers "no animation" — the board is simply already drawn. */
@media (prefers-reduced-motion: reduce) {
  .inkcast-demo [data-ink] { animation-delay: 0ms !important; }
}
`;

/* --------------------------------------------------------------- components */

/**
 * A line of handwriting, revealed left to right by translating a clip rect.
 *
 * A whole word appearing at once is the failure mode `docs/research/golpo-ux.md`
 * §5.3 records in competing tools; a hand moves along the line, so the reveal
 * does too. `translateX` on the clip rect keeps it to a transform — no layout
 * property is animated anywhere in this component.
 */
function Handwritten({
  scope,
  name,
  spec,
  beat,
  beats,
  children,
  textLength,
  className,
}: {
  scope: string;
  name: string;
  spec: Written;
  beat: number;
  beats: number;
  children: string;
  /** Forces a known advance width, so an underline can be aimed at its end. */
  textLength?: number;
  className?: string;
}) {
  const clipId = `${scope}-${name}`;
  return (
    <>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            data-ink="write"
            style={write(beat, beats, spec.clip.w + 12)}
            x={spec.clip.x}
            y={spec.clip.y}
            width={spec.clip.w}
            height={spec.clip.h}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* `stroke="none"` because the enclosing group sets a stroke for the
            drawn paths, and inherited stroke on glyphs would thicken them
            unpredictably depending on which face actually loaded. */}
        <text
          x={spec.x}
          y={spec.y}
          textLength={textLength}
          fontSize={spec.size}
          stroke="none"
          className={cn('font-hand fill-ink', className)}
        >
          {children}
        </text>
      </g>
    </>
  );
}

export function InkDemo({ className }: { className?: string }) {
  // Remounting the <svg> restarts every CSS animation from its delay, which is
  // the whole implementation of "draw it again" — no timers, no animation API.
  const [run, setRun] = React.useState(0);
  const [hold, setHold] = React.useState(false);
  const root = React.useRef<HTMLDivElement | null>(null);
  // `useId` is stable across the server/client boundary; the sanitising pass is
  // because React's generated ids contain characters that are legal in an `id`
  // but awkward inside a `url(#…)` reference.
  const rawScope = React.useId();
  const scope = `inkcast-demo${rawScope.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  React.useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    // Already on screen at mount: let it play, and do not pay for an observer.
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.85 && box.bottom > 0) return;

    setHold(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHold(false);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // One PRNG for the whole board, drawn in the order a hand would draw it, so
  // adding a stroke does not change the wobble of the strokes before it.
  const rand = randomFromSeed(0x1c4a57);

  const axisY = inkStrokePath(rand, { x: 700, y: 508 }, { x: 700, y: 204 }, { amplitude: 2.2 });
  const axisX = inkStrokePath(rand, { x: 694, y: 500 }, { x: 1184, y: 500 }, { amplitude: 2.4 });
  const curve = smoothPath(jittered(rand, CURVE, 7));
  const stepArrowA = arrowStrokes(rand, { x: 782, y: 314 }, { x: 856, y: 414 }, 17);
  const stepArrowB = arrowStrokes(rand, { x: 890, y: 438 }, { x: 936, y: 455 }, 15);
  const pointer = arrowStrokes(rand, { x: 1000, y: 282 }, { x: 906, y: 392 }, 18);
  const ring = inkCirclePath(rand, { cx: 952, cy: 460, rx: 58, ry: 40 }, { amplitude: 4 });
  const connector = arrowStrokes(rand, { x: 1006, y: 554 }, { x: 972, y: 506 }, 15);
  const underlineA = inkStrokePath(rand, { x: 94, y: 162 }, { x: 514, y: 158 }, { amplitude: 2 });
  const underlineB = inkStrokePath(
    rand,
    { x: 100, y: 167 },
    { x: 506, y: 163 },
    { amplitude: 2.6 },
  );

  const titleId = `${scope}-title`;
  const descId = `${scope}-desc`;

  return (
    <div ref={root} data-hold={hold ? 'true' : undefined} className={cn('inkcast-demo', className)}>
      {/* React hoists and de-duplicates this, so it is emitted once however many
          boards are on the page. */}
      <style href="inkcast-ink-demo" precedence="medium">
        {STYLESHEET}
      </style>

      <div className="rounded-2xl border border-border bg-card p-2 shadow-lg">
        <div className="overflow-hidden rounded-lg bg-paper">
          <svg
            key={run}
            viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
            // `aspect-video` matches the 720×405 viewBox exactly, so the box is
            // the right size before a single stroke exists: no layout shift.
            className="block aspect-video w-full"
            role="img"
            aria-labelledby={titleId}
            aria-describedby={descId}
          >
            <title id={titleId}>
              A whiteboard drawing itself: the words &ldquo;Gradient descent&rdquo;, then a loss
              curve with three steps walking down to its minimum.
            </title>
            <desc id={descId}>
              One canvas. The camera starts on the title, pans to an empty area and builds a plot
              there, then pulls back to show both at once — nothing drawn is ever erased, and the
              last stroke underlines the title written first.
            </desc>

            {/* One group = the camera. Everything below it is board content in
                canvas units and never moves. */}
            <g data-ink="camera" style={at(0, TOTAL_BEATS)}>
              <defs>
                <pattern id={`${scope}-grid`} width={40} height={40} patternUnits="userSpaceOnUse">
                  <circle cx={1.5} cy={1.5} r={1.4} className="fill-ink" opacity={0.1} />
                </pattern>
              </defs>
              <rect x={-240} y={-240} width={2000} height={1360} fill={`url(#${scope}-grid)`} />

              <g fill="none" strokeLinecap="round" className="stroke-ink">
                {/* ---- beat 1: write the title ---- */}
                <Handwritten
                  scope={scope}
                  name="title"
                  spec={TITLE}
                  beat={0.6}
                  beats={2.6}
                  textLength={420}
                >
                  Gradient descent
                </Handwritten>

                {/* ---- beat 2: the camera pans right; build the plot ---- */}
                <path
                  d={axisY}
                  pathLength={1}
                  strokeWidth={3}
                  data-ink="draw"
                  style={at(7.6, 1.1)}
                />
                <path
                  d={axisX}
                  pathLength={1}
                  strokeWidth={3}
                  data-ink="draw"
                  style={at(8.3, 1.3)}
                />
                <path
                  d={curve}
                  pathLength={1}
                  strokeWidth={3.4}
                  data-ink="draw"
                  style={at(9.8, 2.8)}
                />

                <Handwritten scope={scope} name="loss" spec={LABELS.loss} beat={12.8} beats={0.9}>
                  loss
                </Handwritten>
                <Handwritten scope={scope} name="theta" spec={LABELS.theta} beat={13.5} beats={0.8}>
                  θ
                </Handwritten>

                {STEPS.map((p, i) => (
                  <circle
                    key={`step-${p.x}`}
                    cx={p.x}
                    cy={p.y}
                    r={6.5}
                    className="fill-ink"
                    stroke="none"
                    data-ink="pop"
                    style={at(14.4 + i * 1.4, 0.5)}
                  />
                ))}

                {stepArrowA.map((d, i) => (
                  <path
                    key={`arrow-a-${i}`}
                    d={d}
                    pathLength={1}
                    strokeWidth={2.6}
                    data-ink="draw"
                    style={at(14.8 + i * 0.16, 1)}
                  />
                ))}
                {stepArrowB.map((d, i) => (
                  <path
                    key={`arrow-b-${i}`}
                    d={d}
                    pathLength={1}
                    strokeWidth={2.6}
                    data-ink="draw"
                    style={at(16.1 + i * 0.16, 1)}
                  />
                ))}

                <Handwritten scope={scope} name="step" spec={LABELS.step} beat={17.4} beats={1.3}>
                  one step downhill
                </Handwritten>
                {pointer.map((d, i) => (
                  <path
                    key={`pointer-${i}`}
                    d={d}
                    pathLength={1}
                    strokeWidth={2.4}
                    data-ink="draw"
                    style={at(18 + i * 0.16, 1)}
                  />
                ))}

                {/* ---- beat 3: the camera pulls back and annotates what is
                        already on the board. A heavier stroke marks the second
                        marker, so emphasis is not carried by colour alone. ---- */}
                <path
                  d={ring}
                  pathLength={1}
                  strokeWidth={4.6}
                  data-ink="draw"
                  style={at(22.4, 1.6)}
                />
                {connector.map((d, i) => (
                  <path
                    key={`connector-${i}`}
                    d={d}
                    pathLength={1}
                    strokeWidth={2.6}
                    data-ink="draw"
                    style={at(23.4 + i * 0.16, 0.7)}
                  />
                ))}
                <Handwritten
                  scope={scope}
                  name="minimum"
                  spec={LABELS.minimum}
                  beat={23.6}
                  beats={1.1}
                >
                  minimum
                </Handwritten>

                {/* The proof that nothing wiped: this underlines the title from
                    beat 1, twenty-five beats later. */}
                <path
                  d={underlineA}
                  pathLength={1}
                  strokeWidth={4.6}
                  data-ink="draw"
                  style={at(25.4, 1.5)}
                />
                <path
                  d={underlineB}
                  pathLength={1}
                  strokeWidth={3.4}
                  opacity={0.5}
                  data-ink="draw"
                  style={at(25.7, 1.5)}
                />
              </g>
            </g>
          </svg>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3 pb-1">
          <p className="text-xs text-muted-foreground">
            One canvas, three camera framings, nothing erased.
          </p>
          <Button variant="ghost" size="xs" onClick={() => setRun((n) => n + 1)}>
            <RotateCcwIcon aria-hidden />
            Draw it again
          </Button>
        </div>
      </div>
    </div>
  );
}
