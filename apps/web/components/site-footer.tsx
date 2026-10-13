import Link from 'next/link';
import { Logo } from '@/components/marketing/logo';
import { repoUrl } from '@/components/marketing/site-config';
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="page-container flex flex-col gap-10 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/" className="focus-ring inline-flex" aria-label="Inkcast home">
            <Logo />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            A little ink. A clearer idea.
            <br />
            Open-source video creation.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
          <Link href="/studio" className="focus-ring hover:text-primary">
            Studio
          </Link>
          <a href="#how-it-works" className="focus-ring hover:text-primary">
            How it works
          </a>
          <a href="#faq" className="focus-ring hover:text-primary">
            FAQ
          </a>
          {repoUrl ? (
            <a
              href={repoUrl}
              className="focus-ring hover:text-primary"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          ) : null}
        </nav>
      </div>
      <div className="page-container pb-6 text-xs text-muted-foreground">
        Inkcast · Open source under AGPL-3.0-only
      </div>
    </footer>
  );
}
