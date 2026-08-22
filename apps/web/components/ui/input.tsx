'use client';

import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A text input. Base UI's `Input` participates in `Field`, so wrapping it in a
 * `<Field.Root>` gives it `data-invalid`, `data-touched` and `data-filled` for
 * free — which is why the invalid styling below is a data-attribute variant
 * rather than a prop.
 *
 * `--input` and `--border` are the same ink now (docs/DESIGN.md §11) — the role
 * is kept named so control edges can diverge from structural ones again without
 * a rename, but the old comment here ("a deliberately stronger line") no longer
 * describes anything and is gone.
 *
 * An input is a bordered well with a hard offset plane: ink edge, square
 * corners, `shadow-card`. There is deliberately no `focus-visible:border-ring`
 * any more — recolouring the ink frame violet while a violet outline sits 2px
 * outside it says the same thing twice and costs the field its edge. The
 * outline is the focus indicator; the border stays ink and keeps the box.
 */
export type InputProps = WithClass<InputPrimitive.Props>;

export function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-none border border-input bg-card px-3 py-1 text-base text-foreground',
        'shadow-card transition-[border-color,box-shadow] duration-fast ease-out',
        'placeholder:text-muted-foreground',
        'focus-ring outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-invalid:border-destructive data-invalid:focus-visible:outline-destructive',
        // File inputs: kill the UA button, keep the label legible. The button is
        // a small block in its own right, so it gets the same ink edge as
        // everything else rather than `border-0`.
        'file:mr-3 file:h-7 file:rounded-none file:border file:border-input file:bg-secondary file:px-2.5 file:text-sm file:font-medium file:text-secondary-foreground',
        className,
      )}
      {...props}
    />
  );
}
