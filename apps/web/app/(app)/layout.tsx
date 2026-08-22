import type { Metadata } from 'next';
import Link from 'next/link';

import { Logo } from '@/components/marketing/logo';
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
          <Link href="/" className="focus-ring rounded-md outline-none" aria-label="Inkcast home">
            {/* Two elements, one visible: the app header has to hold the nav and
                the theme toggle at 360px, so the wordmark drops below `sm` — the
                behaviour the hand-inlined copy of the logo used to get from
                `max-sm:sr-only` on its own text span. It is expressed as the
                mark/lockup variants rather than as a prop that hides part of the
                lockup, because a lockup with its wordmark switched off is not a
                lockup, it is the mark. The `Link` carries the accessible name, so
                the duplicated SVG is announced exactly once. */}
            <Logo variant="mark" size={26} className="sm:hidden" />
            <Logo size={26} className="max-sm:hidden" />
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
