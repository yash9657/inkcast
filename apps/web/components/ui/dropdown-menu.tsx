'use client';

import * as React from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react';

import { cn, type WithClass } from '@/lib/utils';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;
export const DropdownMenuSub = MenuPrimitive.SubmenuRoot;

const popupClasses = [
  'max-h-[var(--available-height)] min-w-40 overflow-y-auto overscroll-contain',
  'rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-overlay',
  'origin-[var(--transform-origin)]',
  'transition-[opacity,transform,translate] duration-brisk ease-out',
  'data-starting-style:scale-[0.97] data-starting-style:opacity-0',
  'data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-fast',
  'data-[side=bottom]:data-starting-style:-translate-y-1',
  'data-[side=top]:data-starting-style:translate-y-1',
  // A menu reopened by keyboard while still animating out should snap, not
  // cross-fade with its own ghost.
  'data-[instant]:transition-none',
];

export function DropdownMenuContent({
  className,
  children,
  sideOffset = 6,
  align = 'start',
  ...props
}: WithClass<MenuPrimitive.Positioner.Props>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        data-slot="dropdown-menu-positioner"
        sideOffset={sideOffset}
        align={align}
        className="z-50 max-h-[var(--available-height)]"
        {...props}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(popupClasses, className)}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

// The highlighted row is stated twice, in colour and in shape, and the shape is
// the part that is load-bearing. `--accent` is a 4.5% tint of paper (the C1 swap
// deliberately kept it as a quiet interaction surface rather than making it the
// hot violet — docs/DESIGN.md §11 "Not changed, deliberately"), which is a
// perfectly good hover wash and a poor sole indicator of where the keyboard is:
// it is nearly invisible on a bright screen at an angle and worth nothing at all
// to a user with low colour discrimination. docs/DESIGN.md §8 states the rule
// outright — never convey state by colour alone.
//
// A 2px accent edge on the leading side is the answer this system already has a
// vocabulary for, and it is present-but-transparent in every state so that
// arrowing down a menu does not shunt every label 2px sideways as the highlight
// passes. The destructive variant recolours the same edge instead of adding a
// second one, so a dangerous row is never the only row with two signals.
const itemClasses = [
  'relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5',
  'text-sm text-foreground outline-none select-none',
  'border-l-2 border-transparent',
  'data-highlighted:border-primary data-highlighted:bg-accent data-highlighted:text-accent-foreground',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  '[&_svg]:text-muted-foreground data-highlighted:[&_svg]:text-current',
];

const destructiveItemClasses = [
  'text-destructive [&_svg]:text-destructive',
  'data-highlighted:border-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive',
  'data-highlighted:[&_svg]:text-destructive',
];

export type DropdownMenuItemProps = WithClass<MenuPrimitive.Item.Props> & {
  variant?: 'default' | 'destructive';

  inset?: boolean;
};

export function DropdownMenuItem({
  className,
  variant = 'default',
  inset,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        itemClasses,
        variant === 'destructive' && destructiveItemClasses,
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: WithClass<MenuPrimitive.CheckboxItem.Props>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClasses, 'pl-8', className)}
      {...props}
    >
      <MenuPrimitive.CheckboxItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-3.5 text-primary" aria-hidden />
      </MenuPrimitive.CheckboxItemIndicator>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: WithClass<MenuPrimitive.RadioItem.Props>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClasses, 'pl-8', className)}
      {...props}
    >
      <MenuPrimitive.RadioItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <CircleIcon className="size-2 fill-primary text-primary" aria-hidden />
      </MenuPrimitive.RadioItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: WithClass<MenuPrimitive.SubmenuTrigger.Props>) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      // The open sub-trigger recolours the same left edge the highlighted state
      // uses, rather than relying on the tint alone. A submenu stays open while
      // the pointer travels into it, so this is the one row in the menu that can
      // be "the active one" without the keyboard being on it — which makes it the
      // row where a 4.5% tint as sole signal is least defensible, not most.
      className={cn(
        itemClasses,
        'data-[popup-open]:border-primary data-[popup-open]:bg-accent',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" aria-hidden />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: WithClass<MenuPrimitive.Positioner.Props>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={sideOffset} className="z-50" {...props}>
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(popupClasses, className)}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: WithClass<MenuPrimitive.GroupLabel.Props>) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      // Mono, like every other uppercase micro-label. See `command.tsx`.
      className={cn('px-2 py-1.5 font-mono text-2xs uppercase text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dropdown-menu-separator"
      role="presentation"
      // Subtle, not ink: a full-ink rule inside a 1px-bordered popup reads as a
      // second frame. docs/DESIGN.md §2 keeps `--border-subtle` for exactly the
      // separators that live inside a bordered surface.
      className={cn('-mx-1 my-1 h-px bg-border-subtle', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('tabular ml-auto pl-4 font-mono text-2xs text-muted-foreground', className)}
      {...props}
    />
  );
}
