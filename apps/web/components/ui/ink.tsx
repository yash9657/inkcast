import * as React from 'react';

import { cn, randomFromSeed, seedFrom } from '@/lib/utils';

/**
 * Hand-drawn flourishes — the one place the chrome is allowed to quote the
 * artefact. Underline a word in the hero, ring the thing you want read first,
 * point at the board.
 *
 * These are generated, not vendored: every path is built here from a seeded PRNG
 * (`randomFromSeed`), so the same seed always produces the same wobble. That
 * matters for three reasons — the server and the client render identical markup
 * (no hydration mismatch), a re-render does not re-roll the shape, and there is
 * no runtime drawing library to ship. rough.js would do the same job with 40 KB
 * and a `useEffect`; 60 lines of trigonometry does it with neither.
 *
 * Restraint is the whole point. One flourish per view, on the single most
 * important phrase. A page where four things are hand-circled has circled
 * nothing.
 */

/* --------------------------------------------------------------- geometry */

type Pt = { x: number; y: number };

/**
 * A wobbly line from `a` to `b`, as an SVG path. Control points are offset
 * perpendicular to the line by a jittered amount, so the wobble follows the
 * stroke direction instead of always being vertical.
 */
export function inkStrokePath(
  rand: () => number,
  a: Pt,
  b: Pt,
  { segments = 5, amplitude = 1.4 }: { segments?: number; amplitude?: number } = {},
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal to the stroke.
  const nx = -dy / len;
  const ny = dx / len;

  // Ends are pinned (a pen touches down where you aim it) with a slight
  // overshoot at the finish, which is what makes a stroke look hand-made.
  const overshoot = (rand() - 0.3) * amplitude * 1.6;
  let d = `M ${round(a.x)} ${round(a.y)}`;

  for (let i = 1; i <= segments; i += 1) {
    const t = i / segments;
    const tPrev = (i - 1) / segments;
    const tMid = (t + tPrev) / 2;

    // Taper the jitter toward the ends: sin(pi*t) is 0 at both ends, 1 mid.
    const jitter = (rand() - 0.5) * 2 * amplitude * Math.sin(Math.PI * tMid);

    const cx = a.x + dx * tMid + nx * jitter;
    const cy = a.y + dy * tMid + ny * jitter;
    const ex = a.x + dx * t + (i === segments ? nx * overshoot : 0);
    const ey = a.y + dy * t + (i === segments ? ny * overshoot : 0);

    d += ` Q ${round(cx)} ${round(cy)} ${round(ex)} ${round(ey)}`;
  }

  return d;
}

/**
 * A wobbly, deliberately not-quite-closed ellipse — the shape you get when you
 * ring something on a whiteboard and your hand overshoots the start.
 */
export function inkCirclePath(
  rand: () => number,
  { cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number },
  { segments = 14, amplitude = 2 }: { segments?: number; amplitude?: number } = {},
): string {
  // Start somewhere on the upper left and travel a little past a full turn.
  const start = -0.55 * Math.PI + (rand() - 0.5) * 0.4;
  const sweep = 2 * Math.PI + 0.28 + rand() * 0.3;

  let d = '';
  let prev: Pt | null = null;

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const angle = start + sweep * t;
    // Radius breathes as the hand goes round.
    const wobble = 1 + ((rand() - 0.5) * amplitude) / Math.max(rx, ry);
    const p: Pt = { x: cx + Math.cos(angle) * rx * wobble, y: cy + Math.sin(angle) * ry * wobble };

    if (prev === null) {
      d = `M ${round(p.x)} ${round(p.y)}`;
    } else {
      // Control point pushed outward from the centre so the arc bows correctly.
      const mAngle = angle - sweep / segments / 2;
      const bulge = 1.06 + (rand() - 0.5) * 0.05;
      const cxx = cx + Math.cos(mAngle) * rx * bulge;
      const cyy = cy + Math.sin(mAngle) * ry * bulge;
      d += ` Q ${round(cxx)} ${round(cyy)} ${round(p.x)} ${round(p.y)}`;
    }
    prev = p;
  }

  return d;
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/* ------------------------------------------------------------- components */

/**
 * Ink colour, named so callers pick from the palette rather than a hex.
 *
 * `highlighter` is the newest and the most restricted: it is the system's second
 * accent (`--highlighter`, marker yellow at hue 95) and docs/DESIGN.md §7 says it
 * belongs on a hand flourish and nowhere else — a hero underline and the
 * wordmark's stroke under the `k`. It is deliberately NOT in the five `--ink-*`
 * hues, because those five are the whiteboard's marker set and the renderer has
 * to be able to draw them; the highlighter is chrome.
 */
export type InkTone =
  'primary' | 'ink' | 'blue' | 'red' | 'green' | 'amber' | 'violet' | 'highlighter';

const toneStroke: Record<InkTone, string> = {
  primary: 'stroke-primary',
  ink: 'stroke-ink',
  blue: 'stroke-ink-blue',
  red: 'stroke-ink-red',
  green: 'stroke-ink-green',
  amber: 'stroke-ink-amber',
  violet: 'stroke-ink-violet',
  highlighter: 'stroke-highlighter',
};

const toneFill: Record<InkTone, string> = {
  primary: 'fill-primary',
  ink: 'fill-ink',
  blue: 'fill-ink-blue',
  red: 'fill-ink-red',
  green: 'fill-ink-green',
  amber: 'fill-ink-amber',
  violet: 'fill-ink-violet',
  highlighter: 'fill-highlighter',
};

type InkCommon = {
  /** Same seed, same wobble. Defaults to the wrapped text when it is a string. */
  seed?: string | number;
  tone?: InkTone;
  /** Animate the stroke on. Disabled automatically by `prefers-reduced-motion`. */
  draw?: boolean;
  className?: string;
};

function resolveSeed(seed: string | number | undefined, children: React.ReactNode): number {
  if (typeof seed === 'number') return seed >>> 0;
  if (typeof seed === 'string') return seedFrom(seed);
  if (typeof children === 'string') return seedFrom(children);
  return seedFrom('inkcast');
}

/**
 * Underlines its children by hand.
 *
 *   <InkUnderline>one growing canvas</InkUnderline>
 *
 * Two overlapping passes, because a marker underline is never one stroke. The
 * SVG stretches with the text (`preserveAspectRatio="none"`) while
 * `vector-effect="non-scaling-stroke"` keeps the line weight honest.
 *
 * The default tone is `highlighter`, not `primary`, and this is the one place in
 * the app where marker yellow is the right answer rather than a decoration.
 * docs/DESIGN.md §7 reserves `--highlighter` for exactly this: "an
 * `InkUnderline` or `InkHighlight` drawn in marker yellow under a hero phrase".
 * There is also a colour-blindness argument for it — the accent violet is
 * already carrying every interactive state in the chrome, so underlining a word
 * in the same violet says "this is a link" to anyone who has learned the rest of
 * the page. Yellow says "somebody drew on this", which is what is meant.
 *
 * It is safe here in a way it is NOT safe as a fill: the strokes sit at
 * `-bottom-[0.18em]` in a `0.34em` box, i.e. BELOW the baseline and outside the
 * glyphs, so they never come between the text and the eye and cannot move the
 * text's contrast ratio in either theme. `--highlighter` is 1.33:1 against paper
 * — decorative by design, documented as such in `globals.css`, and legitimate
 * only because nothing is being read off it.
 */
export function InkUnderline({
  children,
  seed,
  tone = 'highlighter',
  draw = true,
  weight = 2.4,
  className,
}: InkCommon & { children: React.ReactNode; weight?: number }) {
  const rand = randomFromSeed(resolveSeed(seed, children));
  const first = inkStrokePath(rand, { x: 1, y: 6 }, { x: 99, y: 5.4 }, { amplitude: 1.5 });
  const second = inkStrokePath(rand, { x: 2.5, y: 7.6 }, { x: 97, y: 7.1 }, { amplitude: 1.9 });

  return (
    <span data-slot="ink-underline" className={cn('relative inline-block', className)}>
      <span className="relative z-10">{children}</span>
      <svg
        aria-hidden
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        className={cn(
          'pointer-events-none absolute -bottom-[0.18em] left-0 h-[0.34em] w-full overflow-visible',
          toneStroke[tone],
        )}
      >
        {/* `vector-effect` is not an inherited CSS property, so it goes on each
            path rather than on the group. */}
        <g fill="none" strokeWidth={weight} strokeLinecap="round">
          <path
            d={first}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            className={draw ? 'animate-ink-draw' : undefined}
          />
          <path
            d={second}
            pathLength={1}
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
            className={draw ? 'animate-ink-draw [animation-delay:120ms]' : undefined}
          />
        </g>
      </svg>
    </span>
  );
}

/**
 * Rings its children by hand — the "read this one" annotation.
 *
 *   <InkCircle tone="red" seed="cost">$0.00</InkCircle>
 */
export function InkCircle({
  children,
  seed,
  tone = 'red',
  draw = true,
  weight = 2,
  className,
}: InkCommon & { children: React.ReactNode; weight?: number }) {
  const rand = randomFromSeed(resolveSeed(seed, children));
  const path = inkCirclePath(rand, { cx: 50, cy: 25, rx: 46, ry: 20 }, { amplitude: 2.4 });

  return (
    <span data-slot="ink-circle" className={cn('relative inline-block', className)}>
      <span className="relative z-10">{children}</span>
      <svg
        aria-hidden
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
        className={cn(
          'pointer-events-none absolute top-[-0.3em] left-[-0.5em] overflow-visible',
          'h-[calc(100%+0.6em)] w-[calc(100%+1em)]',
          toneStroke[tone],
        )}
      >
        <path
          d={path}
          fill="none"
          strokeWidth={weight}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          className={draw ? 'animate-ink-draw' : undefined}
        />
      </svg>
    </span>
  );
}

/**
 * A marker highlight behind its children. Quieter than a circle; use it for a
 * phrase you want warm rather than urgent.
 *
 * This one draws a wide stroke BEHIND the glyphs, which makes it the one
 * flourish that can damage the text it decorates — so the two jobs are separated
 * and the tone decides which one you get.
 *
 * A **tint** (every tone except `highlighter`) stays at 22% and leaves the text
 * colour alone: at that alpha the wash moves the background's luminance by a few
 * percent, so whatever contrast the surrounding text had it still has, in both
 * themes. That is the whole reason the alpha is so low.
 *
 * A **marker** (`tone="highlighter"`) is the real thing: 88% coverage, and the
 * text is repainted `--highlighter-foreground`, which exists precisely as the
 * measured-safe twin of `--highlighter` (11.53:1 light / 11.31:1 dark on the
 * solid colour). The pairing is not optional decoration — it is what keeps the
 * band legible, and the arithmetic says why the middle ground is not available:
 * marker yellow is L≈0.9 in both themes, so on ink paper a 22% wash under
 * near-white text lands at about 4.3:1 and fails the floor, while at 88% under
 * its own dark foreground it lands at about 7.6:1 and clears it. A yellow
 * highlight either commits or it is a bug.
 *
 * Keep it to a short phrase. The stroke has round caps and tapers over the outer
 * ~2% of its length, the way a real marker does, so a long sentence ends with a
 * word sitting on thinning ink.
 */
export function InkHighlight({
  children,
  seed,
  tone = 'amber',
  className,
}: Omit<InkCommon, 'draw'> & { children: React.ReactNode }) {
  const rand = randomFromSeed(resolveSeed(seed, children));
  const path = inkStrokePath(rand, { x: 2, y: 5.5 }, { x: 98, y: 5 }, { amplitude: 1.1 });
  const marker = tone === 'highlighter';

  return (
    <span data-slot="ink-highlight" className={cn('relative inline-block', className)}>
      <span className={cn('relative z-10', marker && 'text-highlighter-foreground')}>
        {children}
      </span>
      <svg
        aria-hidden
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-[0.12em] h-[0.9em] w-full',
          toneStroke[tone],
        )}
      >
        <path
          d={path}
          fill="none"
          strokeWidth={9}
          strokeLinecap="round"
          opacity={marker ? 0.88 : 0.22}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

/**
 * A standalone hand-drawn arrow, for pointing at something adjacent.
 *
 *   <InkArrow direction="down-right" className="size-16 text-ink-blue" />
 *
 * `direction` rotates the whole glyph, so one generated shape serves all eight
 * headings and the wobble stays consistent between them.
 */
export function InkArrow({
  seed = 'arrow',
  tone = 'ink',
  draw = true,
  direction = 'right',
  weight = 2,
  className,
}: InkCommon & {
  direction?:
    'right' | 'down' | 'left' | 'up' | 'down-right' | 'down-left' | 'up-right' | 'up-left';
  weight?: number;
}) {
  const rand = randomFromSeed(resolveSeed(seed, null));
  const shaft = inkStrokePath(rand, { x: 6, y: 30 }, { x: 52, y: 30 }, { amplitude: 2.2 });
  const headTop = inkStrokePath(
    rand,
    { x: 38, y: 18 },
    { x: 54, y: 30 },
    { segments: 3, amplitude: 1 },
  );
  const headBottom = inkStrokePath(
    rand,
    { x: 38, y: 42 },
    { x: 54, y: 30 },
    { segments: 3, amplitude: 1 },
  );

  const rotation: Record<NonNullable<typeof direction>, number> = {
    right: 0,
    'down-right': 45,
    down: 90,
    'down-left': 135,
    left: 180,
    'up-left': 225,
    up: 270,
    'up-right': 315,
  };

  return (
    <svg
      data-slot="ink-arrow"
      aria-hidden
      viewBox="0 0 60 60"
      className={cn('pointer-events-none size-12 overflow-visible', toneStroke[tone], className)}
    >
      {/* The viewBox is square and the element is square, so the stroke scales
          uniformly — no `vector-effect` needed here. */}
      <g
        fill="none"
        strokeWidth={weight}
        strokeLinecap="round"
        transform={`rotate(${rotation[direction]} 30 30)`}
      >
        <path d={shaft} pathLength={1} className={draw ? 'animate-ink-draw' : undefined} />
        <path
          d={headTop}
          pathLength={1}
          className={draw ? 'animate-ink-draw [animation-delay:200ms]' : undefined}
        />
        <path
          d={headBottom}
          pathLength={1}
          className={draw ? 'animate-ink-draw [animation-delay:260ms]' : undefined}
        />
      </g>
    </svg>
  );
}

/**
 * A dot-grid "board" texture, for surfaces that stand in for the canvas (an
 * empty project card, a drop target). Marketing and empty states only — never
 * behind the real canvas.
 *
 * Both of its numbers changed in the C1 token swap and neither could be left
 * alone, because this is the silent-degradation case docs/DESIGN.md §11 warns
 * about: the classes still resolved, so nothing broke loudly.
 *
 *   - The dot was `--color-border`, which used to be a 91.6% grey hairline and is
 *     now full ink. A 16px lattice of solid black dots is not a texture, it is a
 *     screen door. `--grid-dot` is the token that means "a dot of the paper's
 *     grid" and is the only honest source for it.
 *   - The pitch was a hardcoded 16px while the body's grid is `--grid-size`
 *     (24px). Two dot grids at different pitches in the same viewport read as a
 *     moiré rather than as one sheet, and every call site here (`library-view`'s
 *     empty state, `file-drop`, the closing CTA) is a panel sitting directly on
 *     the body's paper. Reading `--grid-size` means this surface cannot drift out
 *     of phase with the page as long as its box starts on a multiple of 24px —
 *     the same contract the `dot-grid` utility documents.
 *
 * `dot-grid` in `globals.css` does exactly this and is preferable in new code;
 * this component survives because it is a real element with `aria-hidden`, an
 * `opacity` and children at three of its call sites, which a utility class on
 * someone else's box cannot be.
 */
export function InkBoard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="ink-board"
      className={cn(
        'bg-[radial-gradient(circle_at_center,var(--color-grid-dot)_1px,transparent_1px)]',
        'bg-[length:var(--grid-size)_var(--grid-size)]',
        className,
      )}
      {...props}
    />
  );
}

export { toneFill as inkToneFill, toneStroke as inkToneStroke };
