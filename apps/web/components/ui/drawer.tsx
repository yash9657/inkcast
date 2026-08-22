'use client';

import * as React from 'react';
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A drawer / sheet — an edge-anchored surface you can also swipe away.
 *
 *   <Drawer swipeDirection="up">
 *     <DrawerTrigger render={<Button variant="outline" />}>Scenes</DrawerTrigger>
 *     <DrawerContent side="bottom">
 *       <DrawerHandle />
 *       <DrawerHeader><DrawerTitle>Scenes</DrawerTitle></DrawerHeader>
 *       …
 *     </DrawerContent>
 *   </Drawer>
 *
 * This is Base UI's own `Drawer` (as of 1.6.0) rather than `vaul`, which
 * docs/research/design-stack.md listed before that primitive existed. Base UI's
 * version has the gesture handling, snap points and inertial dismissal vaul was
 * chosen for, and shares Base UI's focus trap and scroll lock with `Dialog` —
 * so using it means one popup implementation in the app instead of two.
 *
 * `swipeDirection` goes on `Drawer` (the root), and must match `side`:
 * bottom/up, top/down, left/left, right/right.
 */
export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;

const drawerVariants = cva(
  [
    'fixed z-50 flex flex-col rounded-none bg-popover text-popover-foreground shadow-overlay',
    'transition-transform duration-slow ease-out',
    // While a finger is down the popup follows the pointer, so the transition
    // has to get out of the way or it fights the gesture.
    'data-[swiping]:transition-none',
  ],
  {
    variants: {
      side: {
        // `rounded-t-2xl`/`rounded-b-2xl` resolved to 0 after the radius ladder
        // went flat, so they are dropped rather than left as a class that
        // states an intention the system no longer honours. The border on the
        // entering edge is the whole edge treatment now.
        bottom:
          'inset-x-0 bottom-0 max-h-[85svh] border-t border-border data-starting-style:translate-y-full data-ending-style:translate-y-full',
        top: 'inset-x-0 top-0 max-h-[85svh] border-b border-border data-starting-style:-translate-y-full data-ending-style:-translate-y-full',
        right:
          'inset-y-0 right-0 w-[min(24rem,calc(100vw-3rem))] border-l border-border data-starting-style:translate-x-full data-ending-style:translate-x-full',
        left: 'inset-y-0 left-0 w-[min(24rem,calc(100vw-3rem))] border-r border-border data-starting-style:-translate-x-full data-ending-style:-translate-x-full',
      },
    },
    defaultVariants: { side: 'bottom' },
  },
);

export type DrawerContentProps = WithClass<DrawerPrimitive.Popup.Props> &
  VariantProps<typeof drawerVariants>;

export function DrawerContent({ className, children, side, ...props }: DrawerContentProps) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop
        data-slot="drawer-backdrop"
        className={cn(
          // Flat ink scrim, same as `Dialog`'s and for the same reason: no
          // frosted glass in this system, and one scrim treatment across both
          // popup implementations.
          'fixed inset-0 z-50 bg-foreground/40',
          'transition-opacity duration-slow ease-out',
          'data-starting-style:opacity-0 data-ending-style:opacity-0',
        )}
      />
      <DrawerPrimitive.Popup
        data-slot="drawer-content"
        className={cn(drawerVariants({ side }), className)}
        {...props}
      >
        {children}
      </DrawerPrimitive.Popup>
    </DrawerPrimitive.Portal>
  );
}

/**
 * The grab affordance. It is also the swipe area, so dragging it works even
 * when the drawer's body scrolls.
 */
export function DrawerHandle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <DrawerPrimitive.SwipeArea
      data-slot="drawer-handle"
      className={cn(
        'flex shrink-0 cursor-grab justify-center py-3 active:cursor-grabbing',
        className,
      )}
      {...props}
    >
      {/* `bg-input` was a mid grey when this was written and is full ink now,
          so the handle had become a solid black bar. `--track` is the token for
          the fill of a control track (docs/DESIGN.md §11, breakage 1), and a
          grab handle is one. It stays a pill: it is a lozenge, not a box. */}
      <div className="h-1.5 w-10 rounded-pill bg-track" />
    </DrawerPrimitive.SwipeArea>
  );
}

export function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('flex shrink-0 flex-col gap-1.5 px-6 pt-2 pb-4', className)}
      {...props}
    />
  );
}

export function DrawerTitle({ className, ...props }: WithClass<DrawerPrimitive.Title.Props>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-xl leading-tight font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: WithClass<DrawerPrimitive.Description.Props>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Scrollable body. Base UI's `Viewport` keeps the gesture and the scroll from fighting. */
export function DrawerBody({ className, ...props }: WithClass<DrawerPrimitive.Viewport.Props>) {
  return (
    <DrawerPrimitive.Viewport
      data-slot="drawer-body"
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6', className)}
      {...props}
    />
  );
}

export function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 px-6 pt-4 pb-6 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
