import type { Metadata } from 'next';
import Link from 'next/link';

import { ThemeToggle } from '@/components/ui';
import { AppNav } from '@/components/studio/app-nav';

/**
 * The app shell: one hairline header, one content column, nothing else.
 *
 * The studio's subject is a drawing, so the chrome stays out of the way — no
 * sidebar, no breadcrumbs, no second navigation layer. `#main` is here because
 * the root layout's skip link targets it.
 */
export const metadata: Metadata = {
  title: { default: 'Studio', template: '%s · Inkcast' },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            href="/"
            className="focus-ring flex items-center gap-2 rounded-md outline-none"
            aria-label="Inkcast home"
          >
            <svg viewBox="0 0 32 32" aria-hidden className="size-6 shrink-0">
              <rect width="32" height="32" rx="8" className="fill-primary" />
              <path
                d="M8 22c3-9 8-13 16-14"
                className="stroke-primary-foreground"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
              <path d="M19 21l5 3-1-5.6z" className="fill-primary-foreground" />
            </svg>
            <span className="text-base font-semibold tracking-tight text-foreground max-sm:sr-only">
              Inkcast
            </span>
          </Link>

          <div className="flex-1 sm:ml-2">
            <AppNav />
          </div>

          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <p>Runs on this machine. No keys, no per-minute bill.</p>
          <p className="font-mono">projects/&lt;id&gt;/out.mp4</p>
        </div>
      </footer>
    </div>
  );
}
