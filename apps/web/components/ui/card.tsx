import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A card. In light mode it is pure white on warm off-white plus a hairline
 * border — no shadow at rest, because the lightness step already reads as
 * raised. In dark mode the border does the same job in reverse.
 *
 * Anatomy:
 *   <Card>
 *     <CardHeader>
 *       <CardTitle/> <CardDescription/> <CardAction/>
 *     </CardHeader>
 *     <CardContent/>
 *     <CardFooter/>
 *   </Card>
 *
 * `CardHeader` is a grid, so `CardAction` (a button, a menu trigger, a badge)
 * lands top-right and spans both rows without absolute positioning.
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-6 rounded-xl border border-border bg-card py-6 text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** Adds a shadow and a hover lift. For cards that are themselves a link. */
export function CardInteractive({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <Card
      className={cn(
        'shadow-xs transition-[box-shadow,border-color,transform] duration-brisk ease-out',
        'hover:-translate-y-0.5 hover:border-input hover:shadow-md',
        'focus-within:border-input',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6',
        'has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-xl leading-tight font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-3 px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  );
}
