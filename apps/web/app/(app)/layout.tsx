import type { Metadata } from 'next';
import Link from 'next/link';

import { Logo } from '@/components/marketing/logo';
import { ThemeToggle } from '@/components/ui';
import { AppNav } from '@/components/studio/app-nav';

import { accessLinks, readAccess } from './access';
import { AuthControls } from './sign-in-gate';

/**
 * The app shell: one hairline header, one content column, nothing else.
 *
 * The studio's subject is a drawing, so the chrome stays out of the way — no
 * sidebar, no breadcrumbs, no second navigation layer. `#main` is here because
 * the root layout's skip link targets it.
 *
 * ## Why this whole group is rendered per request
 *
 * `next build` used to report `○ /studio`, `○ /library`, `○ /settings` — all
 * three prerendered as static HTML at image-build time. That is fine for a page
 * whose contents are a constant, and it is a hole under a gate: the Docker image
 * is built without the Clerk variables and *run* with them (the Dockerfile only
 * passes `NEXT_PUBLIC_INKCAST_BASE_URL` and `NEXT_PUBLIC_INKCAST_REPO_URL` as
 * build arguments), so a statically baked page would have decided "no gate here"
 * months before the first visitor arrived and would keep serving that answer
 * forever. The gate would be absent and nothing would say so, which is the
 * silent-degradation failure `docs/PLAN-LAUNCH.md` names as this repo's dominant
 * one.
 *
 * `force-dynamic` on the group's layout rather than on each page, because the
 * property belongs to the shell: the header itself reads identity now. Route
 * segment config in a layout applies to every segment below it, so `/studio`,
 * `/library`, `/settings` and `/project/:id` are all covered by this one line.
 * The cost is a server render of a shell with no I/O in it — these pages fetch
 * everything they display from `/api/*` in the browser — which is not the kind
 * of dynamic that costs anything. `/` and `/share/:id` are untouched and the
 * landing page stays static.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Studio', template: '%s · Inkcast' },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await readAccess();
  const links = accessLinks();

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

          {/* Renders `null` when this deployment has no accounts, so a
              self-hoster's header is exactly the header it was before the gate
              existed. It sits after the theme toggle because identity is the
              rightmost thing in every header on the web and the muscle memory is
              worth more than the symmetry. */}
          <AuthControls access={access} links={links} />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <p>Local processing has no provider fees. Cloud usage is billed by your providers.</p>
          <p className="font-mono">projects/&lt;id&gt;/out.mp4</p>
        </div>
      </footer>
    </div>
  );
}
