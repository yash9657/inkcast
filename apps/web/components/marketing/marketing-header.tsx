'use client';

import Link from 'next/link';
import { MenuIcon } from 'lucide-react';

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
  ThemeToggle,
} from '@/components/ui';
import { cn } from '@/lib/utils';

import { Logo } from './logo';
import { repoUrl, sectionLinks, STUDIO_HREF } from './site-config';

/**
 * The marketing nav: mark, wordmark, three links, one pill CTA.
 *
 * ## Why this exists next to `components/site-header.tsx`
 *
 * The old header was a product header — four section links, a ghost source
 * button, a square "Open studio" CTA — and it lived outside this directory
 * because it was shared. It no longer is: it had exactly one call site, the
 * marketing layout, and `PLAN-LAUNCH.md` C5 replaces its contents wholesale
 * (three links, a pill, "Make one free"). A nav that only the marketing surface
 * renders and only the marketing spec describes belongs to the marketing
 * surface. `components/site-header.tsx` is now unreferenced; deleting it belongs
 * to whoever owns that file.
 *
 * ## The row, and why it is a plan rather than a set of breakpoints
 *
 * At 360px the row genuinely cannot hold everything, so the split is decided
 * once here instead of being discovered per element:
 *
 * - `< sm` — mark, wordmark, the pill, one menu button. Links and theme move
 *   into the drawer. **The CTA never moves into the drawer**, which is the one
 *   change from the old header's plan: this page's entire job is that button,
 *   and a CTA behind a hamburger is a CTA nobody presses.
 * - `sm` — the theme toggle joins the row.
 * - `md` — the section links join it too, and the menu button retires.
 *
 * The surface is opaque `bg-background` rather than the old translucent blur.
 * Two reasons, and neither is taste: the page paints a 24px dot grid on `body`,
 * and a blurred strip over a dot grid smears the dots into grey mush; and
 * `backdrop-filter` on a sticky element costs a full-width composite every
 * scroll frame, which is a Lighthouse cost for an effect this system does not
 * want anyway (docs/DESIGN.md §10 — no glass).
 */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="focus-ring shrink-0" aria-label="Inkcast, home">
          <Logo />
        </Link>

        <nav aria-label="Sections" className="hidden flex-1 justify-center md:flex">
          <ul className="flex items-center gap-1">
            {sectionLinks.map((link) => (
              <li key={link.href}>
                {/* The hover state is a hard 2px rule in the accent, not a
                    colour fade: this system draws attention with an edge. The
                    transparent border is present at rest so nothing shifts by a
                    pixel when it appears. */}
                <a
                  href={link.href}
                  className="focus-ring block border-b-2 border-transparent px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-out hover:border-accent-strong hover:text-foreground"
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

          {/* The pill. `shape="pill"` is the cva variant, not a `rounded-pill`
              in `className`: the shape is a specified, recurring state of the
              button (DESIGN.md §4 names the nav CTA as one of the pill shapes)
              and two call sites hand-writing the same override is exactly what
              the variant exists to prevent — this one and its twin inside the
              drawer below.

              `shadow-card` stays an override, because it is a fact about this
              row rather than about the button. `shadow-pop`, which
              `variant="default"` carries, is `10px 10px 0` and this control is
              32px tall inside an `h-14` header: 12px of clearance, so a 10px
              offset plane very nearly touches the header's own bottom rule and
              reads as a smear rather than as elevation. The other half of the
              reason is the budget — DESIGN.md §5 caps `shadow-pop` at twice per
              *screen*, and the first screen already spends both on the hero's
              primary CTA and the ink-demo frame, so a third accent plane in a
              sticky header would break the cap at every scroll position on the
              page rather than at one. */}
          <Button
            size="sm"
            shape="pill"
            className="px-4 shadow-card"
            render={<Link href={STUDIO_HREF} />}
          >
            Make one free
          </Button>

          {/* Uncontrolled: every item inside is a `DrawerClose`, so nothing out
              here needs to read or set the open state. */}
          <Drawer swipeDirection="right">
            <DrawerTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Open menu"
                  className="md:hidden"
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
                  <ul className="flex flex-col">
                    {sectionLinks.map((link) => (
                      <li key={link.href} className="border-b border-border-subtle">
                        <DrawerClose
                          render={
                            <a
                              href={link.href}
                              className="focus-ring block px-3 py-3 text-md font-medium text-foreground transition-colors duration-fast ease-out hover:bg-accent-soft"
                            />
                          }
                        >
                          {link.label}
                        </DrawerClose>
                      </li>
                    ))}
                    {repoUrl ? (
                      <li className="border-b border-border-subtle">
                        <a
                          href={repoUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="focus-ring flex items-center gap-2 px-3 py-3 text-md font-medium text-foreground transition-colors duration-fast ease-out hover:bg-accent-soft"
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
                    CTA must be the same object as the row's, not a lookalike —
                    including its shape, which is why `pill` comes from the
                    variant here too instead of a `rounded-pill` appended after
                    it. */}
                <DrawerClose
                  render={<Link href={STUDIO_HREF} />}
                  className={cn(buttonVariants({ size: 'lg', shape: 'pill' }), 'mt-6 mb-6 w-full')}
                >
                  Make one free
                </DrawerClose>
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
