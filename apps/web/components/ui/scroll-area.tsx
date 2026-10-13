'use client';

import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';

import { cn, type WithClass } from '@/lib/utils';

export type ScrollAreaProps = WithClass<ScrollAreaPrimitive.Root.Props> & {
  orientation?: 'vertical' | 'horizontal' | 'both';

  fadeEdges?: boolean;
};

export function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  fadeEdges = false,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      {}
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          'size-full overscroll-contain rounded-[inherit] outline-none',
          'focus-visible:inset-ring-2 focus-visible:inset-ring-ring',
          fadeEdges && orientation === 'vertical' && 'mask-fade-b',
          fadeEdges && orientation === 'horizontal' && 'mask-fade-r',
        )}
      >
        <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>

      {orientation !== 'horizontal' ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== 'vertical' ? <ScrollBar orientation="horizontal" /> : null}
      {orientation === 'both' ? <ScrollAreaPrimitive.Corner className="bg-transparent" /> : null}
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-0.5 opacity-0 transition-opacity duration-brisk ease-out select-none',
        'data-hovering:opacity-100 data-scrolling:opacity-100',
        orientation === 'vertical' ? 'w-2.5' : 'h-2.5 flex-col',
      )}
    >
      {}
      <ScrollAreaPrimitive.Thumb
        className={cn(
          'relative flex-1 rounded-pill bg-track transition-colors duration-fast ease-out',
          'hover:bg-muted-foreground/60',
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
