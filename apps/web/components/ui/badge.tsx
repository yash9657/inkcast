import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  [
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap',
    'rounded-pill border px-2 py-0.5 text-2xs font-medium',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  ],
  {
    variants: {
      variant: {
        default: 'border-transparent bg-highlighter text-highlighter-foreground',
        neutral: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-input bg-transparent text-foreground',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/14 text-warning',
        destructive: 'border-transparent bg-destructive/12 text-destructive',

        ink: 'border-ink-violet/30 bg-ink-violet/12 font-hand text-sm text-ink-violet',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export function StatusDot({
  tone = 'neutral',
  pulse = false,
  className,
  ...props
}: React.ComponentProps<'span'> & {
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'destructive';
  pulse?: boolean;
}) {
  const toneClass = {
    neutral: 'bg-muted-foreground',
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
  }[tone];

  return (
    <span
      data-slot="status-dot"
      className={cn('relative inline-flex size-2 shrink-0', className)}
      {...props}
    >
      {}
      {pulse ? (
        <span className={cn('absolute inset-0 animate-ping rounded-pill opacity-60', toneClass)} />
      ) : null}
      <span className={cn('relative size-2 rounded-pill', toneClass)} />
    </span>
  );
}

export { badgeVariants };
