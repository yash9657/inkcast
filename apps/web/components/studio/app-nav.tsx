'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClapperboardIcon,
  FolderOpenIcon,
  SlidersHorizontalIcon,
  ArrowUpRightIcon,
} from 'lucide-react';
import { Logo } from '@/components/marketing/logo';
import { ThemeToggle } from '@/components/ui';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/studio', label: 'Create a video', icon: ClapperboardIcon },
  { href: '/library', label: 'Your library', icon: FolderOpenIcon },
  { href: '/settings', label: 'Settings', icon: SlidersHorizontalIcon },
];
export function AppNav() {
  const pathname = usePathname();
  return (
    <aside className="studio-sidebar">
      <Link href="/" className="focus-ring studio-brand" aria-label="Inkcast home">
        <Logo size={32} />
      </Link>
      <nav aria-label="Studio navigation" className="studio-navigation">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || (href === '/library' && pathname.startsWith('/project/'));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn('focus-ring studio-nav-link', active && 'is-active')}
            >
              <Icon className="size-4" aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <p className="font-display text-lg">
          Make something
          <br />
          worth understanding.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          From your first thought
          <br />
          to the final frame.
        </p>
        <div className="mt-6 flex items-center justify-between gap-2">
          <Link
            href="/"
            className="focus-ring inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            About Inkcast <ArrowUpRightIcon className="size-3" aria-hidden />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
