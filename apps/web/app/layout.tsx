import type { Metadata, Viewport } from 'next';

import { Providers } from '@/components/ui/providers';
import { fontVariables } from '@/lib/fonts';

import './globals.css';

/**
 * The root layout. It does four things and nothing else:
 *   1. publishes the `--font-*` variables the theme's `--font-sans` etc. read;
 *   2. declares `suppressHydrationWarning`, which next-themes requires because
 *      its inline script sets `class`/`data-theme` on <html> before React runs;
 *   3. mounts `Providers` (theme, motion config, tooltip delay, toaster);
 *   4. renders a skip link, because a keyboard user should not have to tab
 *      through the whole nav to reach the page.
 *
 * Page chrome — nav, footer, shells — belongs in a nested layout owned by the
 * UI agents, not here.
 */
export const metadata: Metadata = {
  title: {
    default: 'Inkcast — draw an explainer from anything you have written',
    template: '%s · Inkcast',
  },
  description:
    'Open-source AI explainer videos. Feed it a document or a prompt; it sketches one growing whiteboard, writes on it stroke by stroke, and narrates. Runs locally, no API keys, no per-minute bill.',
  applicationName: 'Inkcast',
  metadataBase: process.env.NEXT_PUBLIC_INKCAST_BASE_URL
    ? new URL(process.env.NEXT_PUBLIC_INKCAST_BASE_URL)
    : undefined,
  openGraph: {
    title: 'Inkcast',
    description:
      'Draw an explainer from anything you have written. One growing canvas, real hand-drawn strokes, synced narration — free and local.',
    siteName: 'Inkcast',
    type: 'website',
  },
  icons: {
    // An inline SVG mark: a nib on a board. No binary favicon to keep in sync,
    // and it inherits nothing from the theme so it reads on any browser chrome.
    //
    // Held to the token swap only as far as a data URI can be: the tile is now
    // square (`rx` gone, because the radius ladder is flat) and filled with cast
    // violet #4F46E5 rather than the old #535ae4. This is a placeholder with a
    // shelf life — the real mark, `favicon.svg`, the apple-touch-icon and the OG
    // image are plan item C4, and that change replaces this whole block.
    icon: [
      {
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%234F46E5'/%3E%3Cpath d='M8 22c3-9 8-13 16-14' stroke='white' stroke-width='2.5' stroke-linecap='round' fill='none'/%3E%3Cpath d='M19 21l5 3-1-5.6z' fill='white'/%3E%3C/svg%3E",
        type: 'image/svg+xml',
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    // Matches --background in each theme, so the mobile browser chrome blends
    // into the page instead of drawing a seam across the top. These are the sRGB
    // conversions of the OKLCH tokens in globals.css — light
    // `oklch(0.995 0.004 95)`, dark `oklch(0.16 0.01 285)`. Meta tags cannot
    // take a `var()`, so this is the one place a hex is allowed to exist; if
    // `--background` moves in either theme, it has to move here in the same
    // change or the phone draws a seam.
    { media: '(prefers-color-scheme: light)', color: '#fefdfa' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d11' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-svh antialiased">
        <a
          href="#main"
          className="focus-ring sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-100"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
