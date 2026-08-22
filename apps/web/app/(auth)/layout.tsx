import * as React from 'react';
import Link from 'next/link';

import { Logo } from '@/components/marketing';

/**
 * The shell for `/sign-in` and `/sign-up`: a mark, a centred card, and nothing
 * else.
 *
 * No header and no footer, deliberately. `components/marketing/marketing-header.tsx`
 * renders three section links and a "Make one free" CTA, and every one of them
 * leads away from the one thing this page is for; the footer's link table is the
 * same problem lower down. A sign-in page with a full nav is a sign-in page people
 * leave. The mark stays, and it is a link home, so the exit exists and there is
 * exactly one of it.
 *
 * `id="main"` is not decoration: the skip link in `app/layout.tsx` targets it, so
 * without it a keyboard user has nowhere to skip to.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-12">
      <Link href="/" className="focus-ring" aria-label="Inkcast home">
        <Logo size={28} />
      </Link>
      <main id="main" className="flex w-full flex-col items-center">
        {children}
      </main>
    </div>
  );
}
