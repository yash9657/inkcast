'use client';

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A tooltip.
 *
 *   <Tooltip>
 *     <TooltipTrigger render={<Button variant="ghost" size="icon" />}>
 *       <UndoIcon />
 *     </TooltipTrigger>
 *     <TooltipContent>Undo last edit</TooltipContent>
 *   </Tooltip>
 *
 * The shared hover delay lives in `Tooltip.Provider` (components/ui/providers.tsx),
 * not here, so moving along a toolbar does not re-wait 280ms per button.
 *
 * A tooltip is a hint, never the only place information exists: it does not
 * appear on touch and it is not read reliably by every assistive technology.
 * If a control needs a name, give it `aria-label` too.
 */
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipProvider = TooltipPrimitive.Provider;

export function TooltipContent({
  className,
  children,
  sideOffset = 8,
  showArrow = true,
  ...props
}: WithClass<TooltipPrimitive.Positioner.Props> & { showArrow?: boolean }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        data-slot="tooltip-positioner"
        sideOffset={sideOffset}
        className="z-50"
        {...props}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            // The one overlay with no border, and the only one that does not need
            // one: docs/DESIGN.md §5 requires a border under a hard shadow because
            // the shadow is an offset plane and the border is its edge — but this
            // popup is a solid `--foreground` block, so its fill IS its edge
            // against every surface in the app. An ink border on an ink tile
            // would be a line nobody can see, drawn to satisfy a rule about
            // lines that can.
            //
            // `shadow-md` was the deprecated alias here and resolved to
            // `shadow-card`, giving a tooltip the elevation of a resting input.
            // A tooltip floats, so it takes `shadow-overlay` like every other
            // portalled surface (docs/DESIGN.md §11 names this call site).
            'max-w-64 rounded-none bg-foreground px-2.5 py-1.5',
            'text-xs leading-snug font-medium text-background shadow-overlay',
            'origin-[var(--transform-origin)]',
            'transition-[opacity,transform] duration-instant ease-out',
            'data-starting-style:scale-95 data-starting-style:opacity-0',
            'data-ending-style:scale-95 data-ending-style:opacity-0',
            'data-[instant]:transition-none',
            className,
          )}
        >
          {children}
          {showArrow ? (
            <TooltipPrimitive.Arrow className="data-[side=bottom]:top-[-5px] data-[side=bottom]:rotate-180 data-[side=left]:right-[-8px] data-[side=left]:-rotate-90 data-[side=right]:left-[-8px] data-[side=right]:rotate-90 data-[side=top]:bottom-[-5px]">
              <svg width="10" height="5" viewBox="0 0 10 5" aria-hidden className="fill-foreground">
                <path d="M5 5 0 0h10L5 5Z" />
              </svg>
            </TooltipPrimitive.Arrow>
          ) : null}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
