'use client';
import Link from 'next/link';
import { MenuIcon, ArrowRightIcon } from 'lucide-react';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  ThemeToggle,
} from '@/components/ui';
import { Logo } from './logo';
import { sectionLinks } from './site-config';
export function MarketingHeader() {
  return (
    <header className="marketing-header">
      <div className="page-container flex h-20 items-center justify-between gap-5">
        <Link href="/" className="focus-ring rounded-md" aria-label="Inkcast home">
          <Logo />
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-8 md:flex">
          {sectionLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="focus-ring rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Button size="sm" render={<Link href="/studio" />}>
            Open studio <ArrowRightIcon aria-hidden />
          </Button>
          <Drawer swipeDirection="right">
            <DrawerTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Open menu" className="md:hidden" />
              }
            >
              <MenuIcon aria-hidden />
            </DrawerTrigger>
            <DrawerContent side="right">
              <DrawerHeader>
                <DrawerTitle>Explore Inkcast</DrawerTitle>
              </DrawerHeader>
              <DrawerBody>
                <nav aria-label="Mobile navigation" className="flex flex-col gap-2">
                  {sectionLinks.map((link) => (
                    <DrawerClose
                      key={link.href}
                      render={
                        <a
                          href={link.href}
                          className="focus-ring rounded-md px-3 py-4 text-md hover:bg-accent"
                        />
                      }
                    >
                      {link.label}
                    </DrawerClose>
                  ))}
                </nav>
                <div className="mt-8 border-t border-border pt-6">
                  <ThemeToggle />
                </div>
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
