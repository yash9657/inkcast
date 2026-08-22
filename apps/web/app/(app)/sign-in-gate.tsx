'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowRightIcon, LockIcon, TriangleAlertIcon, UserRoundIcon } from 'lucide-react';

import { Button } from '@/components/ui';
import { COST_LOCAL, stashTopic } from '@/components/marketing/site-config';
import { cn } from '@/lib/utils';

import type { Access, AccessLinks } from './access';

/**
 * The door: what a signed-out visitor sees, and the sign-in control in the nav.
 *
 * Both live here and both are client components for one shared reason — the only
 * link either of them can usefully offer is a link *back to this exact URL*, and
 * the current pathname and search string are browser state. A server component
 * would have to reconstruct them from a header that Next does not promise.
 *
 * ## Why nothing here is a Clerk widget
 *
 * `<SignIn />` and `<UserButton />` are iframed, self-styled surfaces, and this
 * design system is 1px ink borders, hard zero-blur offset shadows and radius 0
 * (docs/DESIGN.md §5, §11). Dropping a rounded card with its own shadow ladder
 * into it reads as a third-party bolt-on, which is exactly what it would be.
 * These are our own primitives pointed at Clerk's URLs, so the shell keeps one
 * visual language and the sign-in *page itself* is the only place Clerk's own
 * chrome appears — where it is the whole content and can be themed once.
 *
 * The consequence to be honest about: **there is no sign-out control here.**
 * Signing out of Clerk needs Clerk's client SDK; a URL cannot do it. So the
 * signed-in chip links to the account page when the deployment has published one
 * (`NEXT_PUBLIC_CLERK_ACCOUNT_URL`), where Clerk's own portal offers sign-out,
 * and renders as a plain unlinked chip when it has not. That is the same rule
 * `components/marketing/site-config.ts` states for the repository URL — every
 * link resolves or is not rendered — applied to the one link this file cannot
 * derive.
 */

/**
 * A sign-in link that comes back to where the visitor already was.
 *
 * `redirect_url` is the parameter Clerk's sign-in flow reads, and it is the
 * reason the landing page's try strip is not a trap: a visitor who typed
 * "explain photosynthesis" arrives at `/studio?topic=explain%20photosynthesis`,
 * and the whole path *including that query* is what gets handed back after the
 * round trip.
 *
 * `next` is only ever built from `usePathname()` and `useSearchParams()` — this
 * app's own URL, never a value a visitor supplied — so it cannot become an open
 * redirect. Clerk additionally refuses redirect targets outside the origins
 * configured on the instance.
 */
function withRedirect(url: string, next: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}redirect_url=${encodeURIComponent(next)}`;
}

/** The current URL, query included, as a same-origin path. */
function useCurrentPath(): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return search ? `${pathname}?${search}` : pathname;
}

export type SignInWallProps = {
  heading: string;
  lead: React.ReactNode;
  links: AccessLinks;
  /**
   * Set when the gate is armed and the door is broken. Replaces the buttons,
   * because offering a control that cannot work is worse than saying so.
   */
  unavailable?: string;
  /**
   * The topic this visitor arrived with, if any. Shown back to them and stashed
   * for the far side of the sign-in, so the sentence they typed is visibly not
   * lost rather than merely probably not lost.
   */
  topic?: string;
};

export function SignInWall({ heading, lead, links, unavailable, topic }: SignInWallProps) {
  const next = useCurrentPath();

  // The third of four ways the sentence survives the round trip. The first is
  // that this page does not redirect, so the topic stays in the URL bar; the
  // second is `redirect_url` on the buttons below; this one covers the sign-up
  // that finishes in a different tab, where the query string never comes back.
  React.useEffect(() => {
    if (topic) stashTopic(topic);
  }, [topic]);

  return (
    <section className="max-w-2xl border border-border bg-card p-6 shadow-card sm:p-8">
      {/* The same bordered accent square the marketing sections use for a step
          marker. A fill without an edge reads as a smudge in this system
          (docs/DESIGN.md §5), and a lock with no edge on bare paper reads as a
          disabled state rather than as a door. */}
      <span
        className="mb-5 grid size-10 place-items-center border border-accent-border bg-accent-soft text-accent-strong"
        aria-hidden
      >
        <LockIcon className="size-4" />
      </span>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {heading}
      </h1>
      <p className="mt-3 text-md leading-relaxed text-muted-foreground">{lead}</p>

      {topic ? (
        <div className="mt-6 border border-border-subtle bg-muted px-4 py-3">
          <p className="font-mono text-2xs uppercase text-muted-foreground">
            Waiting for you on the other side
          </p>
          {/* The hand face, because this is the visitor's own sentence rather
              than our copy — the same distinction `Badge variant="ink"` draws
              between the board's vocabulary and the chrome's. */}
          <p className="mt-1 font-hand text-lg text-foreground">{topic}</p>
        </div>
      ) : null}

      {unavailable ? (
        <p
          role="alert"
          className="mt-6 flex gap-3 border border-warning/35 bg-warning/14 px-4 py-3 text-sm text-warning"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{unavailable}</span>
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            size="lg"
            className="w-full sm:w-auto"
            render={<Link href={withRedirect(links.signInUrl, next)} />}
          >
            Sign in
            <ArrowRightIcon aria-hidden />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full sm:w-auto"
            render={<Link href={withRedirect(links.signUpUrl, next)} />}
          >
            Create an account
          </Button>
        </div>
      )}

      <p className="mt-8 border-t border-border-subtle pt-6 text-sm text-muted-foreground">
        This is the shared deployment, and a render costs real compute on somebody else&rsquo;s
        machine, so it has an owner. Inkcast itself has no accounts: clone it and the studio runs on
        your laptop with no sign-in, no key and no network, for {COST_LOCAL} a minute.
      </p>
    </section>
  );
}

/**
 * The nav's identity affordance: one control, or nothing at all.
 *
 * Nothing at all is the important case. When the deployment has no Clerk
 * configuration this renders `null`, so a self-hoster's header is byte-for-byte
 * the header they had before accounts existed — no empty slot, no disabled
 * button, no hint that a feature is missing, because on their box it is not.
 *
 * One control rather than two, because the row is already carrying a logo, two
 * nav links and a theme toggle at 360px and the wall is where both doors are
 * offered side by side. A header that has to choose offers the one that also
 * works for somebody who already has an account.
 */
export function AuthControls({ access, links }: { access: Access; links: AccessLinks }) {
  const next = useCurrentPath();

  if (access.mode === 'open') return null;

  // The gate is armed and the door is broken. The pages say so in words; a
  // header button that could not work would just be a second symptom.
  if (access.mode === 'unavailable') return null;

  if (access.mode === 'signed-out') {
    return (
      <Button
        size="sm"
        shape="pill"
        className="px-4 shadow-card"
        render={<Link href={withRedirect(links.signInUrl, next)} />}
      >
        Sign in
      </Button>
    );
  }

  // Signed in. A chip, not a menu: the only item a menu could hold is sign-out,
  // which needs Clerk's client SDK and is therefore on the account page.
  const chip = cn(
    'focus-ring inline-flex h-8 items-center gap-2 border border-input bg-transparent px-3',
    'text-sm font-medium text-muted-foreground',
  );

  if (!links.accountUrl) {
    return (
      <span className={chip}>
        <UserRoundIcon className="size-4" aria-hidden />
        <span className="max-sm:sr-only">Signed in</span>
      </span>
    );
  }

  return (
    <a
      href={links.accountUrl}
      className={cn(chip, 'shadow-card transition-colors duration-fast ease-out hover:bg-accent')}
    >
      <UserRoundIcon className="size-4" aria-hidden />
      <span className="max-sm:sr-only">Account</span>
    </a>
  );
}
