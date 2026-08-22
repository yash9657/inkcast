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
        {/* A bordered rail, not a soft lozenge: 8px tall, square, ink edge, and
            still inset because a track is a hole in the paper rather than a
            plane above it (docs/DESIGN.md §5). The fill is square too — a
            rounded cap on a square rail is the concentric-corner problem the
            flat radius ladder abolished. */}
        <SliderPrimitive.Track className="inset-shadow-well relative h-2 w-full rounded-none border border-border bg-muted">
          <SliderPrimitive.Indicator className="absolute h-full rounded-none bg-primary" />
          {Array.from({ length: thumbCount }, (_unused, i) => (
            <SliderPrimitive.Thumb
              key={i}
              index={i}
              className={cn(
                // The thumb keeps the pill (§4: slider thumbs are geometrically
                // round) and loses its shadow: `shadow-xs`/`shadow-md` are
                // aliases for 6px offset planes now, and a 16px dot casting a
                // 6px hard shadow across its own rail reads as a rendering bug.
                // Dragging turns the thumb accent instead — a state you can see
                // under your own finger, which a shadow on the far side is not.
                'size-4 rounded-pill border border-input bg-card',
                'transition-[background-color,scale] duration-fast ease-out',
                'focus-ring outline-none focus-visible:ring-2 focus-visible:ring-background',
                'hover:scale-110 data-dragging:scale-110 data-dragging:bg-primary',
              )}
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
