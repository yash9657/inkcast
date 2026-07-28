import * as React from 'react';

import { cn } from '@/lib/utils';

import { Reveal } from './reveal';

/**
 * Page rhythm for the marketing surface, in one place so every section is on
 * the same grid: `py-20 sm:py-24` between sections, a hairline rule to separate
 * them, `max-w-6xl` container, `mb-3` under a heading and `mb-10` under its
 * lead paragraph (docs/DESIGN.md §4).
 *
 * `scroll-mt-20` exists because the header is sticky at `h-14` — without it an
 * anchor jump parks the heading underneath the nav.
 */
export function Section({ className, children, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('scroll-mt-20 border-t border-border py-20 sm:py-24', className)}
      {...props}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

/**
 * An eyebrow + `h2` + lead paragraph. The eyebrow is sentence case in the
 * markup and uppercased visually, so a screen reader still reads words rather
 * than spelling out letters (DESIGN.md §8).
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  headingId,
  align = 'start',
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  headingId?: string;
  align?: 'start' | 'center';
  className?: string;
}) {
  return (
    <Reveal
      className={cn('mb-10 max-w-3xl', align === 'center' && 'mx-auto text-center', className)}
    >
      <p className="mb-3 text-2xs uppercase text-muted-foreground">{eyebrow}</p>
      <h2 id={headingId} className="mb-3 text-3xl sm:text-4xl">
        {title}
      </h2>
      {lead ? <p className="text-lg text-muted-foreground">{lead}</p> : null}
    </Reveal>
  );
}

/**
 * A mono chip for a real identifier from the codebase — a stage entry point, an
 * IR field, an env var. Used sparingly, and only ever quoting something that
 * genuinely exists, because its whole job is to be checkable.
 */
export function CodeChip({ className, children, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}
