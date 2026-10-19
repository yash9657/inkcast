import type { Metadata, Viewport } from 'next';

import { clerkConfigured } from '@/app/api/_lib/clerk';
import { Providers } from '@/components/ui/providers';
import { fontVariables } from '@/lib/fonts';

import './globals.css';

/**
 * The root layout. It does five things and nothing else:
 *   1. publishes the `--font-*` variables the theme's `--font-sans` etc. read;
 *   2. declares `suppressHydrationWarning`, which next-themes requires because
 *      its inline script sets `class`/`data-theme` on <html> before React runs;
 *   3. mounts `Providers` (theme, motion config, tooltip delay, toaster);
 *   4. renders a skip link, because a keyboard user should not have to tab
 *      through the whole nav to reach the page;
 *   5. wraps the document in Clerk's provider — but only on a deployment that
 *      has a Clerk instance. See `RootLayout` for why that is a runtime branch
 *      and not a build-time one.
 *
 * Page chrome — nav, footer, shells — belongs in a nested layout owned by the
 * UI agents, not here.
 */
/**
 * The two descriptions below are the highest-traffic sentences the project owns:
 * one is the Google result for inkcast.video, the other is every Slack, iMessage
 * and X unfurl of a link to it. Both used to end "Runs locally, no API keys, no
 * per-minute bill" and "free and local" — true of the repository, and false of the
 * hosted site the moment a sign-in is required to render anything.
 *
 * They are fixed by rewriting rather than by branching on `signInRequired`, and
 * that is the better fix rather than the lazier one. `components/marketing/
 * site-config.ts` routes the *page* copy through that flag because a pill reading
 * "no API keys" next to a "Sign in" button is a contradiction a visitor can see in
 * one glance. A meta description has no such neighbour: it is read alone, months
 * later, out of a search result. So the sentence that survives is the one that is
 * true of both deployments at once — the local path is stated as something you can
 * *do* ("run it yourself") rather than as what this URL is, which is what made the
 * old wording false. One string, no build-time flag, nothing to forget.
 *
 * The honesty rule this follows is `site-config.ts`'s own, quoted there: every
 * figure verified, every claim checkable — "the same 'degrade, never fabricate'
 * rule the pipeline applies to a missing API key".
 */
export const metadata: Metadata = {
  title: {
    default: 'Inkcast: explain anything with a hand-drawn video',
    template: '%s · Inkcast',
  },
  description:
    'Open-source AI explainer videos. Feed it a document or a prompt; it sketches one growing whiteboard, writes on it stroke by stroke, and narrates. Run it yourself with no API keys and no per-minute bill.',
  applicationName: 'Inkcast',
  metadataBase: process.env.NEXT_PUBLIC_INKCAST_BASE_URL
    ? new URL(process.env.NEXT_PUBLIC_INKCAST_BASE_URL)
    : undefined,
  openGraph: {
    title: 'Inkcast',
    description:
      'Draw an explainer from anything you have written. One growing canvas, real hand-drawn strokes, synced narration — and it is open source, so you can run the whole thing yourself.',
    siteName: 'Inkcast',
    type: 'website',
  },
  // No `icons` block, and its absence is the point.
  //
  // There used to be one here holding an inline data-URI nib, described in its own
  // comment as "a placeholder with a shelf life" that plan item C4 "replaces this whole
  // block". C4 landed — `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`,
  // `app/opengraph-image.png` and its `.alt.txt` are all on disk and all served 200 — but
  // the block stayed, and an explicit `metadata.icons` *overrides* Next's file convention.
  // So the launch favicon was still the placeholder and the real mark was dead weight:
  // shipped, reachable by URL, and referenced by nothing the browser reads. Deleting the
  // block is the whole fix; Next picks the files up from `app/` by name, which is why C4
  // put them there rather than adding paths here for someone to keep in sync.
};

export const viewport: Viewport = {
  themeColor: [
    // Matches --background in each theme, so the mobile browser chrome blends
    // into the page instead of drawing a seam across the top. These are the sRGB
    // conversions of the OKLCH tokens in globals.css — light
    // `oklch(0.982 0.005 90)`, dark `oklch(0.17 0.016 262)`. Meta tags cannot
    // take a `var()`, so this is the one place a hex is allowed to exist; if
    // `--background` moves in either theme, it has to move here in the same
    // change or the phone draws a seam.
    { media: '(prefers-color-scheme: light)', color: '#faf9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0f16' },
  ],
  colorScheme: 'light dark',
};

/**
 * Async, and conditionally wrapped, and both halves of that are the requirement.
 *
 * `<ClerkProvider>` goes *outside* `<html>` — that is Clerk's documented shape —
 * so the document is built once into a variable and either returned bare or
 * returned wrapped. One tree, two returns: a duplicated JSX block would be the
 * kind of copy that drifts, and the drift would be invisible until somebody
 * noticed the fonts were missing only when signed in.
 *
 * The import is a lazy `await import()` inside the branch rather than a top-level
 * one, which is why this function is `async`. It is the same rule the rest of the
 * Clerk work follows (see `app/api/_lib/clerk.ts`): on a self-hosted checkout with
 * no Clerk account, `@clerk/nextjs` is never evaluated, so it cannot throw for a
 * missing publishable key, cannot inject a client bundle, and cannot open a
 * connection. `docs/CONTRACT.md` §1 requires this app to work with zero network,
 * and the root layout is on the path of literally every page — including the
 * marketing pages that promise it.
 *
 * A `NEXT_PUBLIC_` variable is inlined at build time, so a build made with the
 * keys present and run with them absent would still take this branch. That is the
 * correct behaviour rather than a caveat: `clerkConfigured` also requires
 * `CLERK_SECRET_KEY`, which is a server variable read at runtime, so an image
 * built for the hosted deployment and run without its secret renders the sign-in
 * chrome and refuses every generation with a 401 — loud, and pointing at the
 * missing variable, instead of silently serving an unauthenticated site.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const document = (
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

  if (!clerkConfigured(process.env)) return document;

  // No cast and no suppression — `@clerk/nextjs` is installed, so this import is
  // checked against the SDK's own declarations. `app/api/_lib/clerk.ts` records
  // what the hand-written shim that used to stand here got wrong.
  const { ClerkProvider } = await import('@clerk/nextjs');
  return <ClerkProvider>{document}</ClerkProvider>;
}
