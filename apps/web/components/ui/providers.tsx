'use client';

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from 'next-themes';

import { Toaster } from './sonner';

/**
 * The three cross-cutting concerns, wired exactly once.
 *
 * 1. `ThemeProvider` sets both `class="dark"` and `data-theme="dark"` on
 *    <html>. `app/globals.css` matches on either, so CSS-only surfaces can
 *    force a theme without React.
 * 2. `MotionConfig reducedMotion="user"` makes every `motion/react` animation
 *    in the app honour the OS setting. No component re-implements this, and no
 *    component calls `useReducedMotion()` to gate itself by hand.
 * 3. `Tooltip.Provider` shares one hover delay across all tooltips, so moving
 *    between adjacent triggers does not re-wait the full delay.
 *
 * `defaultSpring` is the spring the whole product moves with; see docs/DESIGN.md
 * for when to override it (and when not to).
 */

/** The house spring. Pointer-driven motion should feel like this by default. */
export const defaultSpring = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.9,
} as const;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute={['class', 'data-theme']}
      defaultTheme="system"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
      storageKey="inkcast-theme"
    >
      <MotionConfig reducedMotion="user" transition={defaultSpring}>
        <TooltipPrimitive.Provider delay={280} closeDelay={80}>
          {children}
          <Toaster />
        </TooltipPrimitive.Provider>
      </MotionConfig>
    </ThemeProvider>
  );
}
