'use client';

import * as React from 'react';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import { cn, type WithClass } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, children, ...props }: WithClass<TabsPrimitive.List.Props>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // `p-0.5`, not `p-1`, and the reason is arithmetic rather than taste:
        // the strip is a fixed `h-9` (36px) and now spends 2px of it on the ink
        // border, leaving 34px. A 28px tab inside 4px of padding needs 36, so
        // with `p-1` every tab overflowed its own frame by a pixel top and
        // bottom. 2px gutters fit, and the indicator still lands exactly —
        // `offsetTop`/`offsetLeft` and an `absolute top-0` are both measured
        // from the padding edge, so a border cannot shift one without the other.
        'relative isolate inline-flex h-10 items-center gap-0.5 rounded-pill bg-muted p-1',
        className,
      )}
      {...props}
    >
      <TabsPrimitive.Indicator
        // `renderBeforeHydration` paints the indicator in the server HTML, so
        // it does not jump into place on first load.
        renderBeforeHydration
        className={cn(
          // No shadow on the indicator, deliberately: it lives inside a 4px
          // padded well, and a 6px offset plane would spill straight out of the
          // strip it is supposed to sit in. The well is the depth; the block is
          // the state.
          'absolute top-0 left-0 z-0 rounded-pill bg-card shadow-pop',
          'h-[var(--active-tab-height)] w-[var(--active-tab-width)]',
          'translate-x-[var(--active-tab-left)] translate-y-[var(--active-tab-top)]',
          'transition-[translate,width,height] duration-brisk ease-out',
        )}
      />
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTab({ className, ...props }: WithClass<TabsPrimitive.Tab.Props>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        'relative z-10 inline-flex h-8 items-center justify-center gap-1.5 rounded-pill px-3.5',
        'text-sm font-medium whitespace-nowrap text-muted-foreground select-none',
        'transition-colors duration-fast ease-out',
        'hover:text-foreground',
        // The active tab sits on the accent indicator, so the focus outline
        // would otherwise be a violet line 2px outside a violet block. The
        // `ring-background` band keeps a paper-coloured edge between them, the
        // same fix the primary button needs.
        'focus-ring outline-none focus-visible:ring-2 focus-visible:ring-background',
        'data-active:text-foreground',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: WithClass<TabsPrimitive.Panel.Props>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn('focus-ring mt-4 outline-none', className)}
      {...props}
    />
  );
}
