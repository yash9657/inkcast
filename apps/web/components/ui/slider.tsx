'use client';

import * as React from 'react';
import { Slider as SliderPrimitive } from '@base-ui/react/slider';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A slider. Single value or a range — pass an array to `value`/`defaultValue`
 * and Base UI renders one thumb per entry.
 *
 *   <Slider defaultValue={1} min={0.5} max={2} step={0.1} label="Pace" />
 *   <Slider defaultValue={[2, 8]} min={0} max={12} label="Trim" />
 *
 * `label`/`showValue` render the readout; the value uses tabular figures so it
 * does not jitter while dragging. `format` takes `Intl.NumberFormatOptions`,
 * which is how you get "1.4×" or "68%" without formatting by hand.
 */
export type SliderProps = WithClass<SliderPrimitive.Root.Props> & {
  label?: React.ReactNode;
  showValue?: boolean;
};

export function Slider({
  className,
  label,
  showValue = true,
  value,
  defaultValue,
  ...props
}: SliderProps) {
  // One thumb per value. Base UI needs the thumbs rendered explicitly, and the
  // count has to match the value's arity or the extra thumbs sit at the min.
  const resolved = value ?? defaultValue;
  const thumbCount = Array.isArray(resolved) ? resolved.length : 1;

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      defaultValue={defaultValue}
      className={cn('flex w-full flex-col gap-2', className)}
      {...props}
    >
      {label || showValue ? (
        <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <SliderPrimitive.Label className="text-sm font-medium text-foreground">
              {label}
            </SliderPrimitive.Label>
          ) : (
            <span />
          )}
          {showValue ? (
            <SliderPrimitive.Value className="tabular text-xs text-muted-foreground" />
          ) : null}
        </div>
      ) : null}

      <SliderPrimitive.Control
        className={cn(
          'flex h-5 w-full touch-none items-center select-none',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        )}
      >
        <SliderPrimitive.Track className="inset-shadow-well relative h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-primary" />
          {Array.from({ length: thumbCount }, (_unused, i) => (
            <SliderPrimitive.Thumb
              key={i}
              index={i}
              className={cn(
                'size-4 rounded-full border border-input bg-card shadow-xs',
                'transition-[box-shadow,scale] duration-fast ease-out',
                'focus-ring outline-none',
                'hover:scale-110 data-dragging:scale-110 data-dragging:shadow-md',
              )}
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
