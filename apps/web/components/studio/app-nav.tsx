'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * The two places in the app. A tab strip would imply they are peers of one
 * document; these are two views of the same project directory, so they are
 * links with an active state and nothing more.
 */

const LINKS = [
  { href: '/studio', label: 'Studio' },
  { href: '/library', label: 'Library' },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Studio" className="flex items-center gap-1">
      {LINKS.map((link) => {
        // `/project/:id` belongs to the library: that is where you came from.
        const active =
          pathname === link.href ||
          pathname.startsWith(`${link.href}/`) ||
          (link.href === '/library' && pathname.startsWith('/project/'));

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'focus-ring rounded-md px-2.5 py-1.5 text-sm font-medium outline-none',
              'transition-colors duration-fast ease-out',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
