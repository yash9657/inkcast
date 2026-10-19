'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

import { cn, type WithClass } from '@/lib/utils';

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
        'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3',
        'text-base text-foreground shadow-none select-none',
        'transition-[border-color,background-color] duration-fast ease-out',
        'hover:bg-accent/40',
        // Same colour, honest name: `--ring` and `--accent-strong` are both the
        // hot accent, but docs/DESIGN.md §2 reserves `ring` for focus and
        // nothing else, and "the popup is open" is not focus.
        'focus-ring outline-none data-[popup-open]:border-accent-strong',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'data-invalid:border-destructive',
        '[&>span]:truncate data-[placeholder]:[&>span]:text-muted-foreground',
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
            'rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-overlay',
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
        'relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-8',
        'text-sm text-foreground outline-none select-none',
        // A shape as well as a tint on the highlighted row, matching
        // `dropdown-menu.tsx` — see the long note above `itemClasses` there for
        // why `--accent` alone is not an adequate keyboard-position indicator.
        // Kept identical rather than shared because the two files are separate
        // primitives over separate Base UI parts, and a shared string here would
        // couple a select's rows to a menu's for the sake of nine words.
        'border-l-2 border-transparent',
        'data-highlighted:border-primary data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-3.5 text-foreground" aria-hidden />
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
      // Mono: every uppercase micro-label in the system is set in the third face.
      // See `command.tsx`'s group heading for the argument.
      className={cn('px-2 py-1.5 font-mono text-2xs uppercase text-muted-foreground', className)}
      {...props}
    />
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="select-separator"
      role="presentation"
      // `bg-border` is full ink now, which inside a 1px-bordered popup reads as
      // a second frame cutting the menu in half. docs/DESIGN.md §2 names
      // exactly this case as what `--border-subtle` is for. (The utility is
      // `border-border-subtle`/`bg-border-subtle` — the token is
      // `--color-border-subtle`, so the colour's name is `border-subtle`.)
      className={cn('-mx-1 my-1 h-px bg-border-subtle', className)}
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
