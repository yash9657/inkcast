import * as React from 'react';

import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-muted',
        'bg-[linear-gradient(90deg,var(--color-muted),color-mix(in_oklab,var(--color-foreground)_6%,var(--color-muted)),var(--color-muted))]',
        'bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

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
