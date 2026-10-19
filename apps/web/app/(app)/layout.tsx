import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppNav } from '@/components/studio/app-nav';
import { ThemeToggle } from '@/components/ui';
import { accessLinks, readAccess } from './access';
import { AuthControls } from './sign-in-gate';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { default: 'Studio', template: '%s · Inkcast' } };
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await readAccess();
  return (
    <div className="flex min-h-svh flex-col">
      <AppNav
        trailing={
          <>
            <ThemeToggle className="max-md:hidden" />
            <Suspense>
              <AuthControls access={access} links={accessLinks()} />
            </Suspense>
          </>
        }
      />
      <main id="main" className="container-page flex-1 pt-8 pb-20 sm:pt-12">
        {children}
      </main>
    </div>
  );
}
