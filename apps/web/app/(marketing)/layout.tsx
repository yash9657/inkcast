import * as React from 'react';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

/**
 * The marketing shell: header, main, footer.
 *
 * It exists here rather than in `app/layout.tsx` because the root layout is the
 * design system's and deliberately owns only fonts, providers and the skip link
 * (see its own comment). Page chrome belongs to a nested layout — this one.
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

      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
