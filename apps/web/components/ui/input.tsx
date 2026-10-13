'use client';

import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn, type WithClass } from '@/lib/utils';

export type InputProps = WithClass<InputPrimitive.Props>;

export function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-base text-foreground',
        'shadow-none transition-[border-color,box-shadow] duration-fast ease-out',
        'placeholder:text-muted-foreground',
        'focus-ring outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-invalid:border-destructive data-invalid:focus-visible:outline-destructive',
        // File inputs: kill the UA button, keep the label legible. The button is
        // a small block in its own right, so it gets the same ink edge as
        // everything else rather than `border-0`.
        'file:mr-3 file:h-7 file:rounded-md file:border file:border-input file:bg-secondary file:px-2.5 file:text-sm file:font-medium file:text-secondary-foreground',
        className,
      )}
      {...props}
    />
  );
}
