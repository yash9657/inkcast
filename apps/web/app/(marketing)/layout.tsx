import * as React from 'react';

import { MarketingHeader } from '@/components/marketing';
import { SiteFooter } from '@/components/site-footer';

/**
 * The marketing shell: header, main, footer.
 *
 * It exists here rather than in `app/layout.tsx` because the root layout is the
 * design system's and deliberately owns only fonts, providers and the skip link
 * (see its own comment). Page chrome belongs to a nested layout — this one.
 *
 * ## The header moved into `components/marketing/`
 *
 * This used to render `components/site-header.tsx`. `PLAN-LAUNCH.md` C5 respecs
 * the nav wholesale — mark and wordmark, exactly three section links, one pill
 * CTA reading "Make one free" — and a header that only the marketing surface
 * renders and only the marketing spec describes belongs to the marketing surface.
 * `MarketingHeader` is that header. `components/site-header.tsx` had this as its
 * single call site and is now unreferenced; deleting it belongs to whoever owns
 * that file, and leaving it in place costs nothing at runtime because nothing
 * imports it into a bundle.
 *
 * The footer stays where it is. It is not respecced by C5, it reads the same
 * `site-config.ts` link table the header does, and it is shared with surfaces
 * outside this route group — so moving it would be churn with no argument behind
 * it.
 *
 * `id="main"` is not decoration: the skip link in the root layout targets it, so
 * without it a keyboard user has nowhere to skip to.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      {/* The scroll reveals animate from opacity 0. With JavaScript disabled
          nothing would ever set them back to 1, so the page would render blank
          below the fold. One rule, once, instead of a fallback per component. */}
      <noscript>
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      <MarketingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
