'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A multi-line input — the studio's primary entry point, since pasting a
 * document or a prompt is how a project starts.
 *
 * `field-sizing-content` lets the browser grow the box with its content up to
 * `max-h`, so a long paste does not become a two-line scroll pit. Set
 * `rows` for the resting height.
 *
 * Styled exactly like `Input` and for the same reasons: ink edge, square
 * corners, `shadow-card`, and the focus outline alone as the focus indicator
 * rather than an outline plus a recoloured border.
 */
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-20 w-full rounded-none border border-input bg-card px-3 py-2',
        'text-base text-foreground shadow-card',
        'transition-[border-color,box-shadow] duration-fast ease-out',
        'placeholder:text-muted-foreground',
        'focus-ring outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive',
        'resize-none',
        className,
      )}
      {...props}
    />
  );
}
