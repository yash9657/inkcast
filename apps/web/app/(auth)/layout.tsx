import Link from 'next/link';
import { Logo } from '@/components/marketing/logo';
import { ThemeToggle } from '@/components/ui';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="container-page flex h-(--header-height) items-center justify-between">
        <Link href="/" className="focus-ring rounded-md" aria-label="Inkcast home">
          <Logo size={28} />
        </Link>
        <ThemeToggle />
      </header>
      <div className="container-page grid flex-1 items-center gap-10 py-10 md:grid-cols-[1fr_auto] md:gap-16 md:py-16">
        <div className="max-md:text-center">
          <h1 className="display-lg max-w-md max-md:mx-auto">
            Sign in to keep your videos in one place.
          </h1>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground max-md:mx-auto max-md:hidden">
            Your projects, drafts and provider keys stay with your account. Inkcast is open source,
            so you can also run it on your own machine without one.
          </p>
        </div>
        <main id="main" className="flex min-w-0 flex-col items-center">
          {children}
        </main>
      </div>
      <footer className="container-page py-8 text-xs text-muted-foreground">
        Inkcast · Open source
      </footer>
    </div>
  );
}
