'use client';

import * as React from 'react';
import { motion } from 'motion/react';

import { defaultSpring } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * A scroll-reveal wrapper. Marketing surfaces only — docs/DESIGN.md §6 is
 * explicit that scroll-linked motion belongs here and never in the studio.
 *
 * Three deliberate choices:
 *
 * - **It animates `opacity` and `transform` only**, 8px of travel, so nothing it
 *   wraps can move a neighbour. There is no layout shift because the element
 *   occupies its final box from first paint.
 * - **`once: true`.** Content that re-animates every time it scrolls back into
 *   view is a distraction, not a reveal.
 * - **No `useReducedMotion()` gate.** `MotionConfig reducedMotion="user"` in
 *   `components/ui/providers.tsx` already drops the transform for users who ask
 *   for less motion, and DESIGN.md forbids re-implementing that per component.
 *
 * `data-reveal` is what the `<noscript>` rule in the marketing layout targets, so
 * the page is fully readable with JavaScript disabled instead of stranded at
 * `opacity: 0`.
 */
export type RevealProps = React.ComponentProps<typeof motion.div> & {
  /** Stagger position within a group. Capped so a long list never crawls in. */
  index?: number;
  /**
   * The element to render. `li` exists because a reveal wrapping a list item has
   * to *be* the list item — a `div` between `<ol>` and `<li>` is invalid markup,
   * and this surface is supposed to have real semantics.
   */
  as?: 'div' | 'li' | 'span';
};

/** 40ms per item, capped at six — beyond that a stagger reads as a delay. */
const STAGGER_STEP = 0.04;
const STAGGER_CAP = 6;

const ELEMENTS = { div: motion.div, li: motion.li, span: motion.span };

export function Reveal({ index = 0, as = 'div', className, style, ...props }: RevealProps) {
  const delay = Math.min(index, STAGGER_CAP) * STAGGER_STEP;
  // The three tags differ only in their element type, and this component sets
  // nothing element-specific, so they are interchangeable here even though their
  // prop types are nominally distinct.
  const Component = ELEMENTS[as] as unknown as typeof motion.div;

  return (
    <Component
      data-reveal=""
      className={cn(className)}
      style={style}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2, margin: '0px 0px -8% 0px' }}
      transition={{ ...defaultSpring, delay }}
      {...props}
    />
  );
}
