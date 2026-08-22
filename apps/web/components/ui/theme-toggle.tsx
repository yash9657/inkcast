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
 *
 * It is the same object as `TabsList`, and it is built the same way on purpose —
 * a recessed well with an ink frame, and the on state stated as an accent block
 * rather than as a segment one shade lighter than its neighbours. Two segmented
 * controls in one product that disagree about what "selected" looks like is a
 * more expensive inconsistency than it looks, because the header shows this one
 * on every page.
 *
 * The arithmetic, which is the part that is easy to get wrong now that the frame
 * costs pixels. The control is a fixed `h-8` (32px). The ink border spends 2,
 * leaving 30; `p-0.5` spends 4 more, leaving 26. So the segments are `size-6.5`
 * (26px) and the height closes exactly — with the previous `size-7` they would
 * each have overflowed the new frame by a pixel top and bottom, which is exactly
 * the bug `TabsList` had to fix for the same reason. Width follows from the same
 * sum: 3x26 + 2x2 of `gap-0.5` + 4 of padding + 2 of border = 88px, so the
 * pre-mount box is `w-22`. It was `w-[6.5rem]` (104px) against a control that
 * measured 94px, which reserved 10px too much and let the header twitch on
 * hydration — invisible in isolation, and the reason the box exists at all.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn('h-8 w-22', className)} aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inset-shadow-well inline-flex h-8 items-center gap-0.5 rounded-none',
        'border border-border bg-muted p-0.5',
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
              'inline-flex size-6.5 items-center justify-center rounded-none outline-none',
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
                ? 'bg-primary text-primary-foreground'
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
