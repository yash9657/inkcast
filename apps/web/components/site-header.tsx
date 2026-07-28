'use client';

import Link from 'next/link';
import { MenuIcon } from 'lucide-react';

import { Logo } from '@/components/marketing/logo';
import { repoUrl, sectionLinks, STUDIO_HREF } from '@/components/marketing/site-config';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Button,
  buttonVariants,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  GithubIcon,
  Separator,
} from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The site header.
 *
 * Sticky, one row, `h-14`. The hairline and the translucent surface are
 * unconditional rather than appearing on scroll: a border that fades in on
 * scroll needs a scroll listener, and a scroll listener on a marketing page buys
 * a paint-per-frame for an effect nobody asked for.
 *
 * Responsive plan, and it is a plan rather than a set of breakpoints because the
 * row genuinely cannot hold everything at 360px:
 *
 * - `< sm`  — mark, wordmark, one menu button. Links, theme and the CTA live in
 *             the drawer.
 * - `sm`    — theme toggle and the "Open studio" CTA join the row.
 * - `md`    — the section links join it too.
 *
 * Nothing is hidden by JavaScript, so there is no flash of the wrong layout, and
 * the theme toggle reserves its own box before it mounts (see
 * `components/ui/theme-toggle.tsx`), so the row never shifts.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="focus-ring rounded-md" aria-label="Inkcast, home">
          <Logo />
        </Link>

        <nav aria-label="Sections" className="hidden flex-1 md:block">
          <ul className="flex items-center gap-1">
            {sectionLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="focus-ring rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          {repoUrl ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Source on GitHub"
              className="hidden sm:inline-flex"
              render={<a href={repoUrl} target="_blank" rel="noreferrer noopener" />}
            >
              <GithubIcon aria-hidden />
            </Button>
          ) : null}

          <ThemeToggle className="hidden sm:inline-flex" />

          <Button size="sm" className="hidden sm:inline-flex" render={<Link href={STUDIO_HREF} />}>
            Open studio
          </Button>

          {/* Uncontrolled: every item inside is a `DrawerClose`, so nothing needs
              to read or set the open state from out here. */}
          <Drawer swipeDirection="right">
            <DrawerTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Open menu"
                  className="sm:hidden"
                />
              }
            >
              <MenuIcon aria-hidden />
            </DrawerTrigger>
            <DrawerContent side="right">
              <DrawerHeader>
                <DrawerTitle>Inkcast</DrawerTitle>
              </DrawerHeader>
              <DrawerBody>
                {/* A different label from the desktop nav on purpose: two
                    landmarks with the same accessible name are indistinguishable
                    in a screen reader's landmark list. */}
                <nav aria-label="Site menu">
                  <ul className="flex flex-col gap-1">
                    {sectionLinks.map((link) => (
                      <li key={link.href}>
                        <DrawerClose
                          render={
                            <a
                              href={link.href}
                              className="focus-ring block rounded-sm px-3 py-2 text-md font-medium text-foreground transition-colors duration-fast ease-out hover:bg-accent hover:text-accent-foreground"
                            />
                          }
                        >
                          {link.label}
                        </DrawerClose>
                      </li>
                    ))}
                    {repoUrl ? (
                      <li>
                        <a
                          href={repoUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="focus-ring flex items-center gap-2 rounded-sm px-3 py-2 text-md font-medium text-foreground transition-colors duration-fast ease-out hover:bg-accent hover:text-accent-foreground"
                        >
                          <GithubIcon className="size-4" aria-hidden />
                          Source
                        </a>
                      </li>
                    ) : null}
                  </ul>
                </nav>

                <Separator className="my-4" />

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Theme</span>
                  <ThemeToggle />
                </div>

                {/* `buttonVariants` rather than a hand-built button: the drawer's
                    CTA must be the same object as the header's, not a lookalike. */}
                <DrawerClose
                  render={<Link href={STUDIO_HREF} />}
                  className={cn(buttonVariants({ size: 'lg' }), 'mt-6 mb-6 w-full')}
                >
                  Open studio
                </DrawerClose>
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
