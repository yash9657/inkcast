import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A loading placeholder.
 *
 * A sweeping shimmer rather than a pulsing opacity: a pulse blinks the whole
 * page in unison and reads as broken, while a sweep reads as arriving. It
 * stops moving entirely under `prefers-reduced-motion` (handled globally in
 * `app/globals.css`) and degrades to a flat muted block.
 *
 * Size it to the content it stands in for — a skeleton that is the wrong shape
 * causes a visible reflow, which is worse than no skeleton at all.
 *
 *   <Skeleton className="h-4 w-32" />
 *   <Skeleton className="aspect-video w-full" />
 *
 * The example used to carry a `rounded-xl` and the block itself a `rounded-md`.
 * Both still compile and both resolve to `0px` — the radius ladder went flat in
 * the C1 token swap — but a docstring is where the next person learns the system,
 * and one that shows a rounded skeleton teaches a corner that no longer exists.
 * A skeleton stands in for content, all content in this system is square, and a
 * placeholder whose shape does not match what replaces it causes the reflow it
 * was added to prevent.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'animate-shimmer rounded-none bg-muted',
        'bg-[linear-gradient(90deg,var(--color-muted),color-mix(in_oklab,var(--color-foreground)_6%,var(--color-muted)),var(--color-muted))]',
        'bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A block of skeleton lines, with a short last line so it reads as prose.
 * `lines` defaults to 3.
 */
export function SkeletonText({
  lines = 3,
  className,
  ...props
}: React.ComponentProps<'div'> & { lines?: number }) {
  return (
    <div data-slot="skeleton-text" className={cn('flex flex-col gap-2', className)} {...props}>
      {Array.from({ length: lines }, (_unused, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/5' : 'w-full')} />
      ))}
    </div>
  );
}
