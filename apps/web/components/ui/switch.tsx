'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn, type WithClass } from '@/lib/utils';

export function Switch({ className, ...props }: WithClass<SwitchPrimitive.Root.Props>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // THE WORST OF THE FOUR BREAKAGES the token swap left behind, per
        // docs/DESIGN.md §11: this track was painted `bg-input`, and `--input`
        // is now full ink — so an OFF switch rendered as a solid black pill,
        // which every user on earth reads as ON. `--track` exists precisely for
        // the fill of a control track. The bed also grows a real ink border
        // (it was `border-transparent`), because in this system the thing that
        // says "empty box" is an edge with nothing in it.
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill p-0.5',
        'inset-shadow-well border border-input bg-track',
        'transition-colors duration-fast ease-out',
        'focus-ring outline-none focus-visible:ring-2 focus-visible:ring-background',
        'data-checked:bg-primary',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          // No shadow on the knob. `shadow-xs` used to be a 1px hairline and is
          // now an alias for `6px 6px 0` — a 16px knob would have cast a shadow
          // wider than itself and three times outside its own track. The ink
          // border does the separating instead.
          // `size-3.5` (14px), not 16px, and again this is arithmetic: the bed
          // is `h-5 w-9` and now spends 2px on its border, so its content box
          // is 14 x 30 — a 16px knob overflowed its own track by a pixel all
          // round. 14px fits exactly, and 30 - 14 = 16px of travel, which is
          // the `translate-x-4` below to the pixel.
          'block size-3.5 rounded-pill border border-input bg-card',
          'transition-transform duration-fast ease-out',
          'data-checked:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
