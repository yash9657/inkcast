import Link from 'next/link';

import { Logo } from '@/components/marketing/logo';
import {
  LICENCE,
  repoPath,
  repoUrl,
  sectionLinks,
  STUDIO_HREF,
} from '@/components/marketing/site-config';
import { ThemeToggle } from '@/components/theme-toggle';
import { GithubIcon } from '@/components/ui';

/**
 * The footer.
 *
 * Every link in here resolves. The repository, licence and docs links are
 * rendered only when `NEXT_PUBLIC_INKCAST_REPO_URL` is set, because a footer full
 * of guesses is worse than a short footer — same rule the pipeline uses for a
 * missing API key: degrade visibly, never fabricate.
 *
 * There is no copyright line naming a company, because there is no company. The
 * project is AGPL-3.0-only and belongs to the people who wrote it.
 */

type FooterColumn = {
  heading: string;
  links: { href: string; label: string; external?: boolean }[];
};

export function SiteFooter() {
  const licenceHref = repoPath('LICENSE');
  const contractHref = repoPath('docs/CONTRACT.md');
  const irHref = repoPath('packages/core/src/storyboard.ts');

  const columns: FooterColumn[] = [
    {
      heading: 'Product',
      links: [{ href: STUDIO_HREF, label: 'Open studio' }, ...sectionLinks],
    },
    {
      heading: 'Project',
      links: [
        ...(repoUrl ? [{ href: repoUrl, label: 'Source', external: true }] : []),
        ...(irHref ? [{ href: irHref, label: 'Storyboard IR', external: true }] : []),
        ...(contractHref ? [{ href: contractHref, label: 'Build contract', external: true }] : []),
        ...(licenceHref
          ? [{ href: licenceHref, label: `Licence (${LICENCE})`, external: true }]
          : []),
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col gap-12 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground">
              Hand-drawn explainer videos, compiled from your own documents. One canvas, real
              strokes, no per-minute bill.
            </p>
            {repoUrl ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="focus-ring mt-4 inline-flex items-center gap-2 rounded-sm text-sm font-medium text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
              >
                <GithubIcon className="size-4" aria-hidden />
                Read the source
              </a>
            ) : null}
          </div>

          <div className="flex gap-12 sm:gap-16">
            {columns
              .filter((column) => column.links.length > 0)
              .map((column) => (
                <nav key={column.heading} aria-labelledby={`footer-${column.heading}`}>
                  <h2
                    id={`footer-${column.heading}`}
                    className="mb-3 text-2xs uppercase text-muted-foreground"
                  >
                    {column.heading}
                  </h2>
                  <ul className="flex flex-col gap-2.5">
                    {column.links.map((link) => (
                      <li key={link.href}>
                        {link.external ? (
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="focus-ring rounded-sm text-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                          >
                            {link.label}
                          </a>
                        ) : link.href.startsWith('#') ? (
                          <a
                            href={link.href}
                            className="focus-ring rounded-sm text-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                          >
                            {link.label}
                          </a>
                        ) : (
                          <Link
                            href={link.href}
                            className="focus-ring rounded-sm text-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                          >
                            {link.label}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Free software under {LICENCE}. Run it on your own machine; nothing phones home.
          </p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
