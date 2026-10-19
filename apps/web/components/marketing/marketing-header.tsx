'use client';
import Link from 'next/link';
import { MenuIcon } from 'lucide-react';
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
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/90 backdrop-blur-md">
      <div className="container-page flex h-(--header-height) items-center justify-between gap-4">
        <Link href="/" className="focus-ring rounded-md" aria-label="Inkcast home">
          <Logo size={28} />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {sectionLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="focus-ring rounded-pill px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <Button size="sm" render={<Link href="/studio" />}>
            Open studio
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
                <DrawerTitle>Menu</DrawerTitle>
              </DrawerHeader>
              <DrawerBody>
                <nav aria-label="Mobile" className="flex flex-col gap-1">
                  {sectionLinks.map((link) => (
                    <DrawerClose
                      key={link.href}
                      render={
                        <a
                          href={link.href}
                          className="focus-ring rounded-md px-3 py-3.5 text-base hover:bg-accent/60"
                        />
                      }
                    >
                      {link.label}
                    </DrawerClose>
                  ))}
                </nav>
                <div className="mt-8 flex items-center justify-between border-t border-border pt-6 text-sm text-muted-foreground">
                  Theme
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
