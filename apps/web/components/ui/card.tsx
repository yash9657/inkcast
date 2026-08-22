import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A card: white paper, a 1px ink border, square corners, and a hard 6px offset
 * shadow. The old description of this component ("no shadow at rest, because
 * the lightness step already reads as raised") described the previous system
 * and is now wrong in both halves — the 1.4% lightness step is no longer the
 * elevation story, the border and the offset plane are, and docs/DESIGN.md §5
 * lists cards first among the resting surfaces that carry `shadow-card`.
 *
 * A hard shadow costs nothing in layout: `box-shadow` does not contribute to
 * scrollable overflow, so a full-width card cannot push the page sideways.
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
        'flex flex-col gap-6 rounded-none border border-border bg-card py-6 text-card-foreground',
        'shadow-card',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A card that is itself a link or a button. Rests where `Card` rests and, on
 * hover, lifts 2px up-left while its shadow deepens into the accent — the same
 * physical vocabulary as the button's press, run backwards.
 *
 * Both of the old state classes were dead on arrival after the token swap and
 * docs/DESIGN.md §11 names them: `hover:border-input` and
 * `focus-within:border-input` cannot change anything, because `--border` and
 * `--input` are now the same ink; and `hover:shadow-md` resolved to the same
 * `6px 6px 0` the card already had at rest, so the hover lift had lost its
 * shadow change entirely. The replacements are `border-accent-strong` (an
 * accent edge, the one line that reads as "this responds") and `shadow-pop`.
 *
 * `focus-within` gets the accent border but NOT `shadow-pop`, so a focus ring
 * inside the card is never laid over an accent-coloured shadow.
 */
export function CardInteractive({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <Card
      className={cn(
        'transition-[box-shadow,border-color,translate] duration-brisk ease-out',
        'hover:border-accent-strong hover:shadow-pop',
        'motion-safe:hover:-translate-x-0.5 motion-safe:hover:-translate-y-0.5',
        'focus-within:border-accent-strong',
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
