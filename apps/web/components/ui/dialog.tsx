'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A modal dialog.
 *
 *   <Dialog>
 *     <DialogTrigger render={<Button variant="outline" />}>Rename</DialogTrigger>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>Rename project</DialogTitle>
 *         <DialogDescription>This only changes the display name.</DialogDescription>
 *       </DialogHeader>
 *       …
 *       <DialogFooter>
 *         <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
 *         <Button>Save</Button>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * `DialogTitle` is required — Base UI wires it to `aria-labelledby`, and a
 * modal without an accessible name is a bug. If the title should not be seen,
 * use `<DialogTitle className="sr-only">`.
 *
 * Base UI traps focus, locks scroll and restores focus to the trigger on close.
 * Nothing here re-implements any of that.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function DialogBackdrop() {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        'fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px]',
        'transition-opacity duration-slow ease-out',
        'data-starting-style:opacity-0 data-ending-style:opacity-0',
      )}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: WithClass<DialogPrimitive.Popup.Props> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogBackdrop />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // 2rem === spacing-8: a gutter on small screens, capped at max-w-lg.
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-lg gap-6',
          '-translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-xl',
          'transition-[opacity,transform] duration-slow ease-out',
          // Rises 8px and settles. Scale is subtle on purpose: a big zoom reads
          // as a notification, not as a surface you are meant to work in.
          'data-starting-style:translate-y-[calc(-50%+0.5rem)] data-starting-style:scale-[0.98] data-starting-style:opacity-0',
          'data-ending-style:translate-y-[calc(-50%+0.25rem)] data-ending-style:scale-[0.99] data-ending-style:opacity-0 data-ending-style:duration-brisk',
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(
              'absolute top-4 right-4 flex size-7 items-center justify-center rounded-sm',
              'text-muted-foreground transition-colors duration-fast ease-out',
              'hover:bg-accent hover:text-accent-foreground',
              'focus-ring outline-none',
            )}
          >
            <XIcon className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 pr-8 text-left', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: WithClass<DialogPrimitive.Title.Props>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-xl leading-tight font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: WithClass<DialogPrimitive.Description.Props>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
