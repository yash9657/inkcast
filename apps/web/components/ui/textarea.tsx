'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-20 w-full rounded-md border border-input bg-card px-3 py-2',
        'text-base text-foreground shadow-none',
        'transition-[border-color,box-shadow] duration-fast ease-out',
        'placeholder:text-muted-foreground',
        'outline-none focus-visible:border-foreground focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive',
        'resize-none',
        className,
      )}
      {...props}
    />
  );
}
