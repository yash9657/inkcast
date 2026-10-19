'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGridIcon, PlusIcon, Settings2Icon } from 'lucide-react';
import { Logo } from '@/components/marketing/logo';
import { cn } from '@/lib/utils';

/**
 * The studio's one bar. Three destinations don't need a sidebar: a sidebar
 * spends a fifth of the screen to say what a row of three words says, and
 * pushes the actual work off-centre. Create is the verb, so it is the first
 * tab and the one the eye lands on.
 */
const LINKS = [
  { href: '/studio', label: 'Create', icon: PlusIcon },
  { href: '/library', label: 'Library', icon: LayoutGridIcon },
  { href: '/settings', label: 'Settings', icon: Settings2Icon },
];

export function AppNav({ trailing }: { trailing?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/92 backdrop-blur-md">
      <div className="container-page flex h-(--header-height) items-center gap-2 sm:gap-6">
        <Link href="/" className="focus-ring mr-1 rounded-md" aria-label="Inkcast home">
          <Logo size={28} className="max-sm:[&>span:last-child]:sr-only" />
        </Link>
        <nav aria-label="Studio" className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || (href === '/library' && pathname.startsWith('/project/'));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-ring relative inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-sm font-medium',
                  'transition-colors duration-fast',
                  active
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className={cn(href === '/settings' && 'max-sm:sr-only')}>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">{trailing}</div>
      </div>
    </header>
  );
}
