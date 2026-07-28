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
 * `--input` is a deliberately stronger line than `--border`: a control edge has
 * to read as interactive, and a card edge must not.
 */
export type InputProps = WithClass<InputPrimitive.Props>;

export function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-base text-foreground',
        'shadow-xs transition-[border-color,box-shadow] duration-fast ease-out',
        'placeholder:text-muted-foreground',
        'focus-ring outline-none focus-visible:border-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-invalid:border-destructive data-invalid:focus-visible:outline-destructive',
        // File inputs: kill the UA button, keep the label legible.
        'file:mr-3 file:h-7 file:rounded-sm file:border-0 file:bg-secondary file:px-2.5 file:text-sm file:font-medium file:text-secondary-foreground',
        className,
      )}
      {...props}
    />
  );
}
