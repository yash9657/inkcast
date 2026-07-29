'use client';

import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A scrollable region with an overlay scrollbar that appears on hover or while
 * scrolling — so a sidebar or a scene rail does not permanently reserve 15px of
 * gutter, and does not look different on Windows and macOS.
 *
 *   <ScrollArea className="h-72">
 *     <div className="p-4">…</div>
 *   </ScrollArea>
 *
 * The root must have a bounded height, or there is nothing to scroll. Keyboard
 * scrolling works because the viewport is focusable.
 *
 * Do not use this for the whole page — the document scrollbar is a browser
 * affordance users rely on. This is for panes inside a layout.
 */
export type ScrollAreaProps = WithClass<ScrollAreaPrimitive.Root.Props> & {
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Fade the region's edges where content continues out of view. */
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
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          'focus-ring size-full overscroll-contain rounded-[inherit] outline-none',
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
      <ScrollAreaPrimitive.Thumb
        className={cn(
          'relative flex-1 rounded-full bg-input transition-colors duration-fast ease-out',
          'hover:bg-muted-foreground/60',
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
