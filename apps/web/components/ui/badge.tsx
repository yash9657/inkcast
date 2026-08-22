import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * A badge — a status, a count, a tag. Never interactive; if it can be clicked
 * it is a `Button size="xs"`, not a badge.
 *
 * Hierarchy comes from tracking and weight rather than size: badges are all
 * one size, and the tint carries the meaning.
 *
 * The badge is the one place the pill survives. docs/DESIGN.md §4: "if it is a
 * rectangle, it has square corners; if it is a lozenge or a circle, use the
 * pill. There is nothing in between." A badge is a lozenge, so `rounded-pill`
 * is named explicitly rather than inherited from a `rounded-full` that happens
 * to still resolve.
 *
 * Every variant now draws a real line. `border-transparent` on a tinted chip
 * was the previous system's way of reserving the 1px without spending it; in a
 * system built on 1px edges an invisible edge is just a chip that floats. Each
 * status variant borders itself at 35% — its own hue, so the chip reads as one
 * object — and the accent variant uses the two derivatives the reference system
 * derives everything from (`accent-soft` at 8%/12%, `accent-border` at
 * 28%/34%). No hard shadow anywhere: a 6px offset plane under an 18px chip is
 * an object the size of its own shadow.
 */
const badgeVariants = cva(
  [
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap',
    'rounded-pill border px-2 py-0.5 text-2xs font-medium',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  ],
  {
    variants: {
      variant: {
        default: 'border-accent-border bg-accent-soft text-primary',
        neutral: 'border-border-subtle bg-muted text-muted-foreground',
        outline: 'border-input bg-transparent text-foreground',
        success: 'border-success/35 bg-success/12 text-success',
        warning: 'border-warning/35 bg-warning/14 text-warning',
        destructive: 'border-destructive/35 bg-destructive/12 text-destructive',
        /** For the whiteboard's own vocabulary: an ink-style legend chip. */
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

/**
 * A live status dot, for pipeline stages. Pairs with `Badge` or stands alone.
 * `pulse` is opt-in and only for genuinely in-flight work.
 */
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
      {/* `rounded-pill`, not `rounded-full`. The two tokens are both 999px and
          always will be, so this changes no pixels — it changes which name the
          file uses for "round", and this file's own docstring six lines up
          argues that the pill should be named rather than inherited from a
          `rounded-full` that happens to still resolve. A file that makes that
          argument in its header and then contradicts it in its footer teaches
          the wrong lesson to whoever copies from it next. */}
      {pulse ? (
        <span className={cn('absolute inset-0 animate-ping rounded-pill opacity-60', toneClass)} />
      ) : null}
      <span className={cn('relative size-2 rounded-pill', toneClass)} />
    </span>
  );
}

export { badgeVariants };
