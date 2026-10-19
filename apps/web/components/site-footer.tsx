import Link from 'next/link';
import { Logo } from '@/components/marketing/logo';
import { LICENCE, repoUrl, sectionLinks } from '@/components/marketing/site-config';
import { ThemeToggle } from '@/components/ui';

export function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="container-page flex flex-col gap-8 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3">
          <Link href="/" className="focus-ring self-start rounded-md" aria-label="Inkcast home">
            <Logo size={24} />
          </Link>
          <p className="text-sm text-muted-foreground">
            Hand-drawn explainer videos. Open source under {LICENCE}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 text-sm">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3">
            <Link href="/studio" className="focus-ring rounded-sm hover:underline">
              Studio
            </Link>
            {sectionLinks.map((link) => (
              <a key={link.href} href={link.href} className="focus-ring rounded-sm hover:underline">
                {link.label}
              </a>
            ))}
            {repoUrl ? (
              <a
                href={repoUrl}
                className="focus-ring rounded-sm hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            ) : null}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
