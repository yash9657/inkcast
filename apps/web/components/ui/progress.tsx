'use client';

import * as React from 'react';
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A determinate or indeterminate progress bar.
 *
 * Pass `value={null}` for indeterminate — which is the honest state when a
 * stage has started but has not reported a percentage yet. Never fake a
 * percentage: docs/research/golpo-ux.md §5.14 is a study in what an opaque,
 * dishonest progress indicator costs.
 *
 *   <Progress value={pct} label="Drawing" note="scene 3 of 9" />
 *
 * `label`/`note`/`showValue` render the staged, named-step readout the pipeline
 * needs — `onProgress` gives `{stage, pct, note}` and all three land here.
 */
export type ProgressProps = WithClass<ProgressPrimitive.Root.Props> & {
  label?: React.ReactNode;
  note?: React.ReactNode;
  showValue?: boolean;
};

export function Progress({
  className,
  label,
  note,
  showValue = true,
  value,
  ...props
}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('flex w-full flex-col gap-2', className)}
      {...props}
    >
      {label || note || showValue ? (
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            {label ? (
              <ProgressPrimitive.Label className="text-sm font-medium text-foreground">
                {label}
              </ProgressPrimitive.Label>
            ) : null}
            {note ? <span className="truncate text-xs text-muted-foreground">{note}</span> : null}
          </div>
          {showValue ? (
            <ProgressPrimitive.Value className="tabular shrink-0 text-xs text-muted-foreground" />
          ) : null}
        </div>
      ) : null}

      <ProgressPrimitive.Track
        className={cn(
          'relative h-1.5 w-full overflow-hidden rounded-full bg-muted',
          'inset-shadow-well',
        )}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full rounded-full bg-primary',
            'transition-[width] duration-slow ease-out',
            // Indeterminate: a sweep across the full track, so the bar reads as
            // "working, duration unknown" rather than as a stalled 0%.
            'data-indeterminate:w-full data-indeterminate:animate-shimmer',
            'data-indeterminate:bg-[linear-gradient(90deg,var(--color-muted),var(--color-primary),var(--color-muted))] data-indeterminate:bg-[length:200%_100%]',
            'data-complete:bg-success',
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}
