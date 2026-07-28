'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A select.
 *
 *   <Select defaultValue="16:9">
 *     <SelectTrigger className="w-40"><SelectValue placeholder="Aspect" /></SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="16:9">Landscape</SelectItem>
 *       <SelectItem value="9:16">Vertical</SelectItem>
 *     </SelectContent>
 *   </Select>
 *
 * `Select` is Base UI's `Root` re-exported unwrapped, so its generics survive:
 * `value`/`onValueChange` stay typed to whatever you put in `SelectItem`.
 *
 * Enter/exit is driven by Base UI's `data-starting-style` / `data-ending-style`
 * attributes with a CSS transition, and scaled from `--transform-origin` so the
 * popup grows out of its trigger regardless of which side it flipped to.
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: WithClass<SelectPrimitive.Trigger.Props>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'group/select-trigger',
        'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3',
        'text-base text-foreground shadow-xs select-none',
        'transition-[border-color,background-color] duration-fast ease-out',
        'hover:bg-accent/40',
        'focus-ring outline-none data-[popup-open]:border-ring',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'data-invalid:border-destructive',
        "[&>span]:truncate data-[placeholder]:[&>span]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground',
              'transition-transform duration-brisk ease-out',
              'group-data-[popup-open]/select-trigger:rotate-180',
            )}
            aria-hidden
          />
        }
      />
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: WithClass<SelectPrimitive.Positioner.Props>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        data-slot="select-positioner"
        sideOffset={sideOffset}
        // `false` positions the popup below the trigger like a normal dropdown.
        // `true` (Base UI's default) overlays the selected item on the trigger,
        // which is native-macOS behaviour and reads as a bug in a web app.
        alignItemWithTrigger={false}
        className="z-50 max-h-[var(--available-height)]"
        {...props}
      >
        <SelectPrimitive.Popup
          className={cn(
            'max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-hidden',
            'rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            'origin-[var(--transform-origin)]',
            'transition-[opacity,transform,translate] duration-brisk ease-out',
            'data-starting-style:scale-[0.97] data-starting-style:opacity-0',
            'data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-fast',
            'data-[side=bottom]:data-starting-style:-translate-y-1',
            'data-[side=top]:data-starting-style:translate-y-1',
            className,
          )}
        >
          <SelectScrollUpArrow />
          <SelectPrimitive.List className="max-h-[inherit] overflow-y-auto overscroll-contain">
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownArrow />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: WithClass<SelectPrimitive.Item.Props>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8',
        'text-sm text-foreground outline-none select-none',
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-3.5 text-primary" aria-hidden />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="truncate">{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectGroupLabel({
  className,
  ...props
}: WithClass<SelectPrimitive.GroupLabel.Props>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-group-label"
      className={cn('px-2 py-1.5 text-2xs uppercase text-muted-foreground', className)}
      {...props}
    />
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="select-separator"
      role="presentation"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

function SelectScrollUpArrow() {
  return (
    <SelectPrimitive.ScrollUpArrow className="flex h-5 items-center justify-center bg-popover text-muted-foreground">
      <ChevronUpIcon className="size-3.5" aria-hidden />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownArrow() {
  return (
    <SelectPrimitive.ScrollDownArrow className="flex h-5 items-center justify-center bg-popover text-muted-foreground">
      <ChevronDownIcon className="size-3.5" aria-hidden />
    </SelectPrimitive.ScrollDownArrow>
  );
}
