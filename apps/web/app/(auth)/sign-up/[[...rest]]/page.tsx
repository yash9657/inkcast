import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { clerkConfigured } from '@/app/api/_lib/clerk';

import { CLERK_APPEARANCE } from '../../clerk-appearance';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create an account to draw a video on the shared Inkcast deployment.',
};

/**
 * `/sign-up` — the second door the wall offers, and a 404 without accounts.
 *
 * Everything in `../../sign-in/[[...rest]]/page.tsx` applies here for the same
 * reasons: the optional catch-all because Clerk's sign-up navigates within its own
 * path (`/sign-up/verify-email-address`, `/sign-up/continue`,
 * `/sign-up/sso-callback`), the `notFound()` before any Clerk import because
 * `docs/CONTRACT.md` §1 forbids a build that needs a login service, and the lazy
 * import so the SDK is never evaluated on a checkout that has no Clerk instance.
 *
 * The one thing worth saying separately is why the sign-up flow matters more than
 * usual here. `app/(app)/studio/page.tsx` is reached from the landing page's try
 * strip carrying `?topic=…`, and a sign-up finishes in whatever tab the
 * verification email was opened in — where the query string never comes back. That
 * is the case `stashTopic` in `components/marketing/site-config.ts` exists for, and
 * it is set before the visitor ever arrives here, so nothing on this page has to
 * carry it.
 */
export default async function SignUpPage() {
  if (!clerkConfigured(process.env)) notFound();

  const { SignUp } = await import('@clerk/nextjs');
  return <SignUp appearance={CLERK_APPEARANCE} />;
}
