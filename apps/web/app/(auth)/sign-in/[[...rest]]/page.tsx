import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { clerkConfigured } from '@/app/api/_lib/clerk';

import { CLERK_APPEARANCE } from '../../clerk-appearance';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to draw a video on the shared Inkcast deployment.',
};

/**
 * `/sign-in` — Clerk's own flow, and a 404 on a deployment that has no accounts.
 *
 * ## Why this route exists at all
 *
 * `app/(app)/sign-in-gate.tsx` sends every signed-out visitor here, because
 * `NEXT_PUBLIC_CLERK_SIGN_IN_URL` defaults to `/sign-in` — Clerk's own convention,
 * so an operator who followed any Clerk tutorial is already configured. Until this
 * file existed those buttons 404'd, which is the one thing worse than no gate at
 * all: a wall with a door that opens onto nothing. An operator who would rather
 * use Clerk's hosted Account Portal sets that variable to the portal URL and this
 * route simply stops being linked.
 *
 * ## Why the segment is `[[...rest]]`
 *
 * Clerk's flow is multi-step and it navigates *within* the sign-in path —
 * `/sign-in/factor-one`, `/sign-in/sso-callback`, `/sign-in/reset-password` and
 * more. A plain `page.tsx` serves only `/sign-in` exactly, so every step after the
 * first would 404 and the failure would look like "sign-in is broken after I type
 * my email" rather than like a routing mistake. The optional catch-all serves the
 * root path and every step below it from this one component, which is what Clerk's
 * `routing="path"` default expects.
 *
 * ## Why it 404s without configuration
 *
 * This is the same rule the rest of the Clerk work follows and the reason it is
 * load-bearing is `docs/CONTRACT.md` §1: the thing must run with zero API keys and
 * zero network, and the landing page sells exactly that. A self-hoster has no Clerk
 * instance, so a sign-in page on their box could only ever render an error — and
 * `notFound()` reaches that conclusion *before* `@clerk/nextjs` is imported, so the
 * SDK is never evaluated, cannot complain about a missing publishable key and
 * cannot open a connection. `notFound()` rather than a redirect to `/` because
 * there is genuinely no such page on that deployment, and saying so is more useful
 * to whoever followed a stale link than a silent bounce.
 *
 * The import is therefore a lazy `await import()` inside the branch, which is why
 * this component is `async`. Same shape as `app/layout.tsx`'s `<ClerkProvider>`.
 */
export default async function SignInPage() {
  if (!clerkConfigured(process.env)) notFound();

  const { SignIn } = await import('@clerk/nextjs');
  return <SignIn appearance={CLERK_APPEARANCE} />;
}
