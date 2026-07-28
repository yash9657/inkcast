'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A switch — for a setting that takes effect immediately.
 *
 * If the change only applies after a Save button, use a checkbox instead: a
 * switch that has not done anything yet is a lie.
 *
 *   <div className="flex items-center gap-3">
 *     <Switch id="color" defaultChecked />
 *     <Label htmlFor="color">Colour palette</Label>
 *   </div>
 *
 * Base UI renders a hidden `<input type="checkbox">` alongside, so this works
 * inside a plain `<form>` with `name`.
 */
export function Switch({ className, ...props }: WithClass<SwitchPrimitive.Root.Props>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5',
        'inset-shadow-well border border-transparent bg-input',
        'transition-colors duration-fast ease-out',
        'focus-ring outline-none',
        'data-checked:bg-primary',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 rounded-full bg-card shadow-xs',
          'transition-transform duration-fast ease-out',
          'data-checked:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
