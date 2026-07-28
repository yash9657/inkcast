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

/**
 * A three-way theme control: light, dark, follow the OS.
 *
 * "System" is a real option, not a default that hides — a user whose machine
 * switches at sunset should not have to come back here.
 *
 * Renders nothing until mounted, because the resolved theme is only known on the
 * client: painting a guess and then correcting it is a visible flicker on every
 * page load. The reserved box keeps the layout from shifting when it appears.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn('h-8 w-[6.5rem]', className)} aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inset-shadow-well inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5',
        className,
      )}
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
              'focus-ring inline-flex size-7 items-center justify-center rounded-md outline-none',
              'transition-[background-color,color,box-shadow] duration-fast ease-out',
              active
                ? 'bg-card text-foreground shadow-xs'
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
