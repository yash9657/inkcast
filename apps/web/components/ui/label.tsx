import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A form label. Deliberately a native `<label>`: `htmlFor` already gives the
 * click-to-focus and screen-reader association a primitive would wrap, so there
 * is nothing to add and one less dependency to carry.
 *
 * Always pair it with a control. A bare label is a caption, not a label — use
 * `text-xs text-muted-foreground` for that.
 */
export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium text-foreground select-none',
        // Follows its own control's disabled state when inside a wrapper that
        // sets `data-disabled`, and any wrapped control's `:disabled`.
        'group-data-disabled/field:opacity-50 has-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** Helper text under a control. */
export function LabelHint({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="label-hint"
      className={cn('text-xs leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Validation message under a control. */
export function LabelError({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="label-error"
      role="alert"
      className={cn('text-xs leading-relaxed font-medium text-destructive', className)}
      {...props}
    />
  );
}
