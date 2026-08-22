import * as React from 'react';

import { cn } from '@/lib/utils';

import { Reveal } from './reveal';

/**
 * Page rhythm for the marketing surface, in one place so every section is on
 * the same grid: `py-20 sm:py-24` between sections, a rule to separate them,
 * `max-w-6xl` container, `mb-3` under a heading and `mb-10` under its lead
 * paragraph (docs/DESIGN.md §4).
 *
 * The separator used to be described as a hairline. It is not one any more and
 * that is the whole re-skin in miniature: `--border` is ink now
 * (docs/DESIGN.md §11), so `border-t border-border` draws a 1px black rule
 * across the page. The class did not change; the value did. Sections are ruled
 * off from each other the way a page of notes is, which is why none of them
 * needs a background of its own — the dot grid on `body` shows through every one
 * of them, and a section that painted a surface would break the sheet.
 *
 * `scroll-mt-16` exists because the header is sticky at `h-14` — without it an
 * anchor jump parks the heading underneath the nav.
 */
export function Section({ className, children, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('scroll-mt-16 border-t border-border py-20 sm:py-24', className)}
      {...props}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

/**
 * An eyebrow + `h2` + lead paragraph.
 *
 * The eyebrow is sentence case in the markup and uppercased visually, so a
 * screen reader still reads words rather than spelling out letters
 * (DESIGN.md §8). It is set in the mono face and preceded by a small solid
 * accent square: a mono label with a printer's mark beside it is how this system
 * says "new section" without spending a colour or a size on it.
 *
 * The `h2` inherits `font-display` from the base layer — Space Grotesk on every
 * `h1`–`h6` — so it is not written here. Writing it would be harmless and it
 * would also be the kind of redundancy that later reads as significant.
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
      <p
        className={cn(
          'mb-4 flex items-center gap-2 font-mono text-2xs uppercase text-muted-foreground',
          align === 'center' && 'justify-center',
        )}
      >
        <span className="size-2 shrink-0 bg-accent-strong" aria-hidden />
        {eyebrow}
      </p>
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
 *
 * Bordered rather than filled. A tinted block of `bg-muted` behind mono text was
 * the right chip for a system with soft corners; with the radius ladder flat, a
 * fill with no edge reads as a smudge, and the accent-tinted box with a hard
 * 1px edge reads as a quotation.
 */
export function CodeChip({ className, children, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'border border-accent-border bg-accent-soft px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}
