'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Toaster as SonnerToaster, toast } from 'sonner';

/**
 * Toasts.
 *
 * Mounted once, by `Providers`. Everywhere else you only ever call `toast`:
 *
 *   toast.success('Render finished', { description: '1m 42s · 3.4 MB' });
 *   toast.promise(render(), { loading: 'Rendering…', success: 'Done', error: 'Render failed' });
 *
 * Sonner is styled entirely through `toastOptions.classNames` with our own
 * tokens rather than its `richColors`/CSS-variable theming, so a toast is
 * visually identical to a popover and follows the theme without a second
 * palette to keep in sync.
 *
 * A toast is for confirming something that already happened. If the user has to
 * act, or must not miss it, that is a dialog.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      gap={10}
      offset={16}
      visibleToasts={4}
      // Our own classes, so `--normal-bg` and friends are never consulted.
      style={{ '--width': '22rem' } as React.CSSProperties}
      toastOptions={{
        classNames: {
          toast: [
            'group flex w-full items-start gap-3 rounded-xl border border-border',
            'bg-popover p-4 text-popover-foreground shadow-lg',
          ].join(' '),
          title: 'text-sm font-medium leading-snug',
          description: 'text-xs leading-relaxed text-muted-foreground',
          actionButton: [
            'shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium',
            'text-primary-foreground focus-ring outline-none',
          ].join(' '),
          cancelButton: [
            'shrink-0 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium',
            'text-secondary-foreground focus-ring outline-none',
          ].join(' '),
          closeButton: [
            'rounded-sm border-border bg-popover text-muted-foreground',
            'hover:text-foreground focus-ring outline-none',
          ].join(' '),
          icon: 'mt-0.5 shrink-0',
          success: '[&_[data-icon]]:text-success',
          error: '[&_[data-icon]]:text-destructive',
          warning: '[&_[data-icon]]:text-warning',
          info: '[&_[data-icon]]:text-primary',
          loading: '[&_[data-icon]]:text-muted-foreground',
        },
      }}
    />
  );
}

export { toast };
