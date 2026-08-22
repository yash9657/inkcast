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
      {/* The focus indicator is drawn INSIDE the viewport, and it is the one
          place in the primitives where the house `focus-ring` utility is the
          wrong tool rather than the default one.

          `focus-ring` paints `outline: 2px solid var(--color-ring)` with
          `outline-offset: 2px` — i.e. entirely outside the border box. This
          viewport is `size-full` inside a Root that is `overflow-hidden`, so
          every pixel of that outline fell outside the clip rectangle of its own
          parent and was discarded. The keyboard-scrollable region therefore had
          NO visible focus indicator at all, in either theme, while reading as if
          it did: the class was present, it compiled, and the ring was clipped.
          That is precisely the silent-degradation failure docs/HANDOFF.md calls
          the dominant one in this repo, and it is an accessibility regression
          rather than a cosmetic one — docs/DESIGN.md §8 requires a visible
          `focus-visible` indicator on every interactive element, and this
          element is interactive by design ("keyboard scrolling works because the
          viewport is focusable").

          `inset-ring-2` is a box-shadow rather than an outline, painted on the
          inside of the border box, so nothing clips it. It also does not scroll
          with the content — an inset shadow is painted against the border box,
          not the scrolled origin — so the ring frames the pane instead of
          sliding out of view on the first keypress. `inset-ring-ring` is the
          same `--ring` token the outline used, so the contrast story is
          unchanged in both themes (6.22:1 light, 6.29:1 dark against the page).

          The ring is NOT put on the Root with `has-[…]:focus-visible` instead,
          which would have let the standard outset outline work: the Root's
          `:has()` would then also fire for any focusable element in the scrolled
          content, so tabbing to a button inside the pane would draw a second
          ring around the whole region. One focus, one indicator.

          One honest limitation: `fadeEdges` adds a `mask-image`, and a mask
          applies to everything the element paints, box-shadow included — so with
          `fadeEdges` the last 3rem of the ring fades along with the content. The
          remaining three-and-a-bit sides still read unambiguously as focus, and
          the alternative (a wrapper element to carry the mask) buys a div per
          scroll pane to fix the far edge of an indicator. */}
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
      {/* `bg-input` is ink now, so this thumb had become a hard black bar
          floating over the content it scrolls — the third of the four breakages
          docs/DESIGN.md §11 lists. `--track` is the token for a control track's
          fill, and a scrollbar thumb is one. Stays a pill (§4). */}
      <ScrollAreaPrimitive.Thumb
        className={cn(
          'relative flex-1 rounded-pill bg-track transition-colors duration-fast ease-out',
          'hover:bg-muted-foreground/60',
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
