'use client';

import * as React from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn('h-9 w-26', className)} aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('inline-flex h-9 items-center gap-0.5 rounded-pill bg-muted p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-pill outline-none',
              'transition-colors duration-fast ease-out',
              // The selected segment is an accent block, so `focus-ring`'s violet
              // outline would otherwise be drawn 2px outside a violet fill and
              // vanish. The `ring-background` band holds a paper-coloured edge
              // between the two — the same fix `button.tsx` and `tabs.tsx` need,
              // and the reason it is worth repeating rather than abstracting is
              // that it only misbehaves in one state of one variant, which is the
              // kind of focus bug that ships.
              'focus-ring focus-visible:ring-2 focus-visible:ring-background',
              active
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
