import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * A pill that fills something in: a starter question, an example, an edit
 * suggestion. Quieter than a button. `on` names the surface it sits on, so the
 * chip always reads as one step lighter or darker than its background.
 * Use `chipVariants()` on a Link; use `<Chip>` for a button.
 */
const chipVariants = cva(
  [
    'focus-ring inline-flex items-center rounded-pill border border-border px-3 py-1 text-sm text-foreground',
    'transition-colors duration-fast hover:border-input hover:bg-accent/50',
    'disabled:pointer-events-none disabled:opacity-45',
  ],
  {
    variants: {
      on: {
        page: 'bg-card',
        card: 'bg-background',
      },
      size: {
        default: 'py-1',
        lg: 'py-1.5',
      },
    },
    defaultVariants: { on: 'page', size: 'default' },
  },
);

export type ChipProps = React.ComponentProps<'button'> & VariantProps<typeof chipVariants>;

export function Chip({ className, on, size, type = 'button', ...props }: ChipProps) {
  return (
    <button
      data-slot="chip"
      type={type}
      className={cn(chipVariants({ on, size }), className)}
      {...props}
    />
  );
}

export { chipVariants };
