'use client';

import * as React from 'react';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import { cn, type WithClass } from '@/lib/utils';

/**
 * Tabs, with a sliding indicator.
 *
 *   <Tabs defaultValue="script">
 *     <TabsList>
 *       <TabsTab value="script">Script</TabsTab>
 *       <TabsTab value="board">Board</TabsTab>
 *     </TabsList>
 *     <TabsPanel value="script">…</TabsPanel>
 *   </Tabs>
 *
 * `TabsList` renders a `TabsIndicator` that Base UI positions from the active
 * tab's measured box (exposed as `--active-tab-left`/`--active-tab-width`), so
 * the pill slides between tabs instead of cross-fading. That movement is the
 * whole point: it tells you where you came from.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, children, ...props }: WithClass<TabsPrimitive.List.Props>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'relative isolate inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1',
        'inset-shadow-well',
        className,
      )}
      {...props}
    >
      <TabsPrimitive.Indicator
        // `renderBeforeHydration` paints the indicator in the server HTML, so
        // it does not jump into place on first load.
        renderBeforeHydration
        className={cn(
          'absolute top-0 left-0 z-0 rounded-md bg-card shadow-xs',
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
        'relative z-10 inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3',
        'text-sm font-medium whitespace-nowrap text-muted-foreground select-none',
        'transition-colors duration-fast ease-out',
        'hover:text-foreground',
        'focus-ring outline-none',
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
