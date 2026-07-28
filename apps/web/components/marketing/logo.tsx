import { cn } from '@/lib/utils';

/**
 * The mark: a marker stroke sweeping up, with a nib on the end. Same geometry as
 * the favicon declared in `app/layout.tsx`, so the tab and the header agree.
 *
 * It is a tinted tile rather than a bare glyph because the wordmark next to it is
 * already `foreground` — two neutral shapes side by side would have no anchor.
 * This is one of the small load-bearing uses of `primary` DESIGN.md §1.2 allows.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="size-5" fill="none">
        <path
          d="M8 22c3-9 8-13 16-14"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        <path d="M19 21l5 3-1-5.6z" fill="currentColor" />
      </svg>
    </span>
  );
}

/** Mark plus wordmark. `href` is left to the caller so it works in nav and footer. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-md font-semibold tracking-tight text-foreground">Inkcast</span>
    </span>
  );
}
