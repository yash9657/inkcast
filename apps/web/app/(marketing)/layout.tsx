import * as React from 'react';

import { MarketingHeader } from '@/components/marketing';
import { SiteFooter } from '@/components/site-footer';

/**
 * The marketing shell: header, main, footer. `id="main"` is the skip link's target.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <MarketingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
