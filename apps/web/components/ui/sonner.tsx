'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Toaster as SonnerToaster, toast } from 'sonner';

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
          // A toast is a floating surface, so it takes the same frame as a
          // dropdown or a dialog: ink border, square corners, `shadow-overlay`.
          // `shadow-lg` was the deprecated alias sitting here (docs/DESIGN.md
          // §11 lists this line) and it did resolve, which is why nothing looked
          // broken — it just gave every toast the elevation of a resting card.
          toast: [
            'group flex w-full items-start gap-3 rounded-xl border border-border-subtle',
            'bg-popover p-4 text-popover-foreground shadow-overlay',
          ].join(' '),
          title: 'text-sm font-medium leading-snug',
          description: 'text-xs leading-relaxed text-muted-foreground',
          // The two buttons are blocks, and they get their border from
          // `border-input` rather than from `Button` because sonner takes class
          // strings, not components — it renders its own `<button>` and there is
          // nowhere to pass a `render` prop. They are deliberately NOT given a
          // hard shadow: a 6px offset plane under a 24px control inside a surface
          // that is itself floating on `shadow-overlay` is two elevations arguing
          // inside one box, and the frame already says which is which.
          actionButton: [
            'shrink-0 rounded-pill border border-transparent bg-primary px-3 py-1 text-xs font-medium',
            'text-primary-foreground focus-ring outline-none',
          ].join(' '),
          cancelButton: [
            'shrink-0 rounded-pill border border-border bg-secondary px-3 py-1 text-xs font-medium',
            'text-secondary-foreground focus-ring outline-none',
          ].join(' '),
          // `border-border` with no `border` was a colour with nothing to paint —
          // a latent no-op that only became visible once every other surface grew
          // a real line. It is a ghost control until you reach for it, which is
          // right for a dismiss affordance, so the edge arrives on hover.
          closeButton: [
            'rounded-md border border-transparent bg-popover text-muted-foreground',
            'transition-[border-color,color] duration-fast ease-out',
            'hover:border-input hover:text-foreground focus-ring outline-none',
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
