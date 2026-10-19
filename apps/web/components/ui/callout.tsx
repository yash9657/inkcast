import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, OctagonAlertIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A notice that belongs to the content around it: a caveat on a video, a
 * failed request, a "you'll need a key for this". One block, an icon that
 * carries the tone (never colour alone), a short title and optional body.
 */
const calloutVariants = cva(
  'flex gap-3 rounded-lg border px-4 py-3.5 text-sm leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        info: 'border-border bg-muted text-foreground [&>svg]:text-muted-foreground',
        warning: 'border-warning/30 bg-warning/8 text-foreground [&>svg]:text-warning',
        destructive:
          'border-destructive/30 bg-destructive/7 text-foreground [&>svg]:text-destructive',
        success: 'border-success/30 bg-success/8 text-foreground [&>svg]:text-success',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

const ICONS = {
  info: InfoIcon,
  warning: AlertTriangleIcon,
  destructive: OctagonAlertIcon,
  success: CheckCircle2Icon,
} as const;

export type CalloutProps = Omit<React.ComponentProps<'div'>, 'title'> &
  VariantProps<typeof calloutVariants> & {
    title?: React.ReactNode;
    /** Trailing control, e.g. a "Try again" button. */
    action?: React.ReactNode;
  };

export function Callout({ tone, title, action, className, children, ...props }: CalloutProps) {
  const Icon = ICONS[tone ?? 'info'];
  return (
    <div data-slot="callout" className={cn(calloutVariants({ tone }), className)} {...props}>
      <Icon aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? (
          <div className={cn('text-muted-foreground', title ? 'mt-0.5' : null)}>{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
