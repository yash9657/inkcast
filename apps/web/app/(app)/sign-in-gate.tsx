'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowRightIcon, LockIcon, TriangleAlertIcon, UserRoundIcon } from 'lucide-react';

import { Button } from '@/components/ui';
import { COST_LOCAL, stashTopic } from '@/components/marketing/site-config';
import { cn } from '@/lib/utils';

import type { Access, AccessLinks } from './access';

function withRedirect(url: string, next: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}redirect_url=${encodeURIComponent(next)}`;
}

function useCurrentPath(): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return search ? `${pathname}?${search}` : pathname;
}

export type SignInWallProps = {
  heading: string;
  lead: React.ReactNode;
  links: AccessLinks;

  unavailable?: string;

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
    <section className="mx-auto my-6 max-w-xl rounded-xl border border-border bg-card p-6 sm:my-12 sm:p-10">
      {}
      <span
        className="mb-5 grid size-12 place-items-center rounded-xl border border-accent-border bg-accent-soft text-accent-strong"
        aria-hidden
      >
        <LockIcon className="size-4" />
      </span>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {heading}
      </h1>
      <p className="mt-3 text-md leading-relaxed text-muted-foreground">{lead}</p>

      {topic ? (
        <div className="mt-6 rounded-lg border border-border-subtle bg-muted px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Your saved idea</p>
          {}
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
        Your projects stay connected to your account. Prefer to run Inkcast yourself? The
        open-source studio also works locally without an account.
      </p>
    </section>
  );
}

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
    'focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3',
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
