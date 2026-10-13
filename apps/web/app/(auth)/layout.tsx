import Link from 'next/link';
import { Logo } from '@/components/marketing/logo';
import { ThemeToggle } from '@/components/ui';
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-layout">
      <header className="page-container flex h-20 items-center justify-between">
        <Link href="/" className="focus-ring" aria-label="Inkcast home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <div className="auth-content page-container">
        <div className="auth-intro">
          <h1>
            A little ink.
            <br />A clearer idea.
          </h1>
          <p>
            Make room for your next explanation.
            <br />
            Your projects, ideas and creative choices, all in one place.
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-primary" aria-hidden />
            Open source. Made for curious minds.
          </div>
        </div>
        <main id="main" className="flex min-w-0 flex-col items-center">
          {children}
        </main>
      </div>
      <footer className="page-container py-8 text-xs text-muted-foreground">
        Inkcast · Ideas into motion.
      </footer>
    </div>
  );
}
