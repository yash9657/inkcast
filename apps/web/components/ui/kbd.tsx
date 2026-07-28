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
 */
export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5',
        'border border-border bg-muted font-sans text-2xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
