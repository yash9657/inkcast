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
    <div className="studio-shell">
      <AppNav />
      <div className="studio-workspace">
        <header className="studio-topbar">
          <span className="text-xs text-muted-foreground">Your creative workspace</span>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">
              Ideas into motion.
            </span>
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
            <Suspense>
              <AuthControls access={access} links={accessLinks()} />
            </Suspense>
          </div>
        </header>
        <main id="main" className="studio-main">
          {children}
        </main>
        <footer className="studio-footer">
          <span>Made with a little ink.</span>
          <span>
            Local processing has no provider fees. Cloud usage is billed by your providers.
          </span>
        </footer>
      </div>
    </div>
  );
}
