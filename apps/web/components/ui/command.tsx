'use client';

import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

/**
 * A command palette (⌘K) and the filterable list it is built from.
 *
 * Standalone list (for an inline picker — a voice, a language, a scene):
 *   <Command>
 *     <CommandInput placeholder="Find a voice…" />
 *     <CommandList>
 *       <CommandEmpty>No matches.</CommandEmpty>
 *       <CommandGroup heading="Voices">
 *         <CommandItem value="af_heart" onSelect={pick}>Heart</CommandItem>
 *       </CommandGroup>
 *     </CommandList>
 *   </Command>
 *
 * As a palette, wrap it in `CommandDialog`, which supplies the required
 * accessible name via a visually hidden title.
 *
 * cmdk owns filtering, scoring and arrow-key navigation. Do not filter the
 * children yourself — pass everything and let it score.
 */
export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        // No border and no shadow of its own. Standalone it is an inline region
        // inside somebody else's bordered box; as a palette it is the only child
        // of `DialogContent`, which already supplies the ink frame and
        // `shadow-overlay`. A second border here would draw a line 0px from the
        // dialog's.
        'flex size-full flex-col overflow-hidden rounded-none bg-popover text-popover-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type CommandDialogProps = Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  title?: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
};

export function CommandDialog({
  title = 'Command palette',
  description = 'Search for a command or a project.',
  children,
  className,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        showClose={false}
        className={cn('max-w-xl gap-0 overflow-hidden p-0', className)}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    // Full ink here, unlike `CommandSeparator` two functions down, and the
    // distinction is structural rather than inconsistent: this rule divides the
    // palette into two regions that behave differently — one you type into, one
    // you arrow through — whereas a separator groups rows inside a single list.
    // The reference system treats the two the same way: a section boundary is a
    // real line, a list divider is a hairline.
    <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {/* The one focusable element in the primitives that deliberately carries no
          ring, and the reason is that adding one here makes the palette worse in
          both directions. `focus-ring` draws its outline 2px outside the border
          box, and this input is flush against three edges of a `Command` root
          that is `overflow-hidden` — so the ring would be clipped on the left,
          right and top and survive only along the bottom, which is a worse signal
          than none because it reads as a rendering fault. An inset ring (the fix
          `scroll-area.tsx` uses) would fit, but this field is focused
          unconditionally the moment the palette opens and is the only thing in it
          that can take focus, so the ring would be permanently on: a 2px violet
          frame that never means anything because it never changes. The caret is
          the indicator, which is what WCAG 2.4.7 accepts for a text field, and
          the dialog's own frame is the boundary. */}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-full w-full bg-transparent text-md text-foreground outline-none',
          'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-80 overflow-y-auto overscroll-contain p-1.5', className)}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-8 text-center text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden text-foreground',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
        // Mono, like every other uppercase micro-label in the system. The third
        // face exists for exactly this job (plan item C2: "JetBrains Mono ->
        // timecodes, figures, mono labels") and a 10px all-caps group heading in
        // the body face is indistinguishable from small body text.
        '[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex cursor-default items-center gap-2.5 rounded-none px-2 py-2',
        'text-sm text-foreground outline-none select-none',
        // The selected row carries a shape as well as a tint, and this is an
        // accessibility fix rather than a flourish. cmdk drives selection through
        // `aria-activedescendant`, so the highlighted item never takes focus and
        // never gets a focus ring — the tint is the ONLY signal, which is the one
        // thing docs/DESIGN.md §8 forbids ("never convey state by colour alone").
        // The accent surface is a 4.5%-tinted paper; on a bright screen at an
        // angle it is close to invisible, and to a user with low colour
        // discrimination it is nothing at all.
        //
        // A left edge in the accent is the brutalist answer and costs no layout:
        // the transparent border is present in every state, so the text does not
        // move 2px when the highlight arrives, which a `data-[selected]:border-l-2`
        // on its own would have made it do while the user held the arrow key down.
        'border-l-2 border-transparent',
        'data-[selected=true]:border-primary data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        '[&_svg]:text-muted-foreground data-[selected=true]:[&_svg]:text-current',
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      // Subtle, not ink. The palette always lives inside a bordered surface, and
      // a full-ink rule inside a 1px-ink frame reads as the surface being cut in
      // two rather than as a divider — the case docs/DESIGN.md §2 added
      // `--border-subtle` for, and the same call the select and dropdown
      // separators make.
      className={cn('-mx-1.5 my-1.5 h-px bg-border-subtle', className)}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('tabular ml-auto pl-4 font-mono text-2xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export { CommandPrimitive };
