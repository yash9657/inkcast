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
 * Sticky, one row, `h-14`. The rule under it is unconditional rather than
 * appearing on scroll: a border that fades in on scroll needs a scroll listener,
 * and a scroll listener on a marketing page buys a paint-per-frame for an effect
 * nobody asked for.
 *
 * The surface is opaque, and it used to be `bg-background/85 backdrop-blur-md`.
 * That was the right call against a plain paper page and is the wrong one now
 * that the body paints a 1px dot grid every 24px: an 85%-alpha bar with a 12px
 * blur behind it turns those dots into grey smudges for the top 56px of every
 * page, and then the page scrolls underneath so the smudges crawl. It is the same
 * incompatibility that got `surface-grain` deleted in the C1 swap (docs/DESIGN.md
 * §7, "the two do not compose, and of the two the grid is the one the system is
 * built on"), and the resolution is the same. Losing the blur also removes a
 * compositing layer that was repainting on every scroll frame, which C5's
 * Lighthouse gate will not mind.
 *
 * It does NOT then get the `dot-grid` utility back, and this is worth writing
 * down because the utility's own documentation looks like it asks for it: "a
 * full-bleed band … that paints over [the body grid]" is a fair description of
 * this element. The reason not to is that the header is `sticky`. Its own grid
 * would be painted from its own box origin and would sit still, while the body's
 * grid scrolls past underneath at the same 24px pitch — so the two lattices would
 * be in phase only at scroll offsets that are multiples of 24, and out of phase,
 * visibly and continuously, at every other one. `globals.css` warns about exactly
 * that ("start such a section's box on a multiple of 24px or its grid will be out
 * of phase"), and a sticky element has no fixed box to start. The honest reading
 * is that this bar is not a piece of the sheet at all: it is a plane in front of
 * it, in the same family as a card or a popover, and planes in this system are
 * flat fills with a 1px edge. The edge is the bottom border.
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
    <header className="sticky top-0 z-50 border-b border-border bg-background">
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

          {/* The one pill in the chrome. docs/DESIGN.md §4 names the nav CTA as
              one of the four or five shapes allowed to be round in a system
              whose radius ladder is otherwise flat, and the reason it earns it
              is that it has to win against a row of square objects — the mark,
              the icon button, the segmented theme control — without being
              bigger than any of them. `shape="pill"` rather than a
              `rounded-pill` in `className`, so the drawer's copy of this CTA
              below gets the same shape from the same variant. */}
          <Button
            size="sm"
            shape="pill"
            className="hidden sm:inline-flex"
            render={<Link href={STUDIO_HREF} />}
          >
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
                  className={cn(buttonVariants({ size: 'lg', shape: 'pill' }), 'mt-6 mb-6 w-full')}
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
