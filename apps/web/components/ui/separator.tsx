'use client';

import * as React from 'react';
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';

import { cn, type WithClass } from '@/lib/utils';

/**
 * A rule. Base UI gives it the right ARIA role and orientation.
 *
 * Prefer whitespace. A separator is for when two groups are genuinely peers and
 * the gap alone would read as one list — not as a way to add texture.
 *
 * `border-subtle`, not ink. Every call site in the app puts a separator INSIDE
 * a bordered surface — a settings card, the create form, the header's drawer —
 * and a full-ink rule inside a 1px-ink frame does not read as a divider, it
 * reads as the surface being cut in two. docs/DESIGN.md §2 names this exact
 * case as the one `--border-subtle` was added for. Callers who genuinely want a
 * structural rule pass `className="bg-border"`.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: WithClass<SeparatorPrimitive.Props>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border-subtle',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px self-stretch',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A separator with a label in the gap — for "or" between a paste box and an
 * upload zone, which is exactly the choice the studio's entry screen presents.
 *
 * Same `border-subtle` as `Separator`, for the same reason and one more: this one
 * appears where two large bordered controls sit above and below it, so an ink
 * rule between them would be the third heavy horizontal line in 200px and the
 * eye would read it as a third control. The label is the signal here; the rules
 * only have to reach it.
 */
export function SeparatorLabelled({ children, className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="separator-labelled"
      className={cn('flex w-full items-center gap-3', className)}
      {...props}
    >
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="font-mono text-2xs uppercase text-muted-foreground">{children}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}
