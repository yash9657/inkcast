import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A keyboard key.
 *
 *   <Kbd>⌘</Kbd><Kbd>K</Kbd>
 *
 * One key per element, so a chord is a row of keys rather than a string with
 * plus signs in it — which is both how keyboards look and how screen readers
 * read it best.
 *
 * Mono, not sans, and this is a correction rather than a preference: `<kbd>` is
 * the element for literal keyboard input, and plan item C2 assigns the mono face
 * to exactly that class of content ("timecodes, figures, kbd"). It also does a
 * job here that the body face cannot — a key cap is a fixed-width box, and a
 * proportional `I` in a 20px square sits in a puddle of its own side bearings
 * while a proportional `W` fights the padding. `min-w-5` was compensating for a
 * font choice.
 *
 * No shadow. A 6px offset plane under a 20px cap would be an object the size of
 * its own shadow; the ink border and the recessed `bg-muted` fill carry it, which
 * is also how a key actually looks — pressed into the board, not floating above
 * it.
 */
export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1.5',
        'border border-border bg-muted font-mono text-2xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
