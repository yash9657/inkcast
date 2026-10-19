'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowRightIcon, LockIcon, UserRoundIcon } from 'lucide-react';

import { Button, Callout } from '@/components/ui';
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
    <section className="mx-auto max-w-lg py-6 text-center sm:py-16">
      <span
        className="mx-auto mb-6 grid size-12 place-items-center rounded-pill bg-muted text-foreground"
        aria-hidden
      >
        <LockIcon className="size-4" />
      </span>

      <h1 className="display-md">{heading}</h1>
      <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
        {lead}
      </p>

      {topic ? (
        <div className="mt-8 rounded-xl border border-border bg-card px-5 py-4 text-left">
          <p className="eyebrow">Your idea is saved</p>
          <p className="mt-1.5 font-hand text-lg text-foreground">{topic}</p>
        </div>
      ) : null}

      {unavailable ? (
        <Callout
          role="alert"
          tone="warning"
          title="Sign-in isn’t available"
          className="mt-8 text-left"
        >
          {unavailable}
        </Callout>
      ) : (
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
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

      <p className="mx-auto mt-10 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Prefer to run it yourself? The open-source studio works on your own machine without an
        account.
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
      <Button size="sm" render={<Link href={withRedirect(links.signInUrl, next)} />}>
        Sign in
      </Button>
    );
  }

  // Signed in. A chip, not a menu: the only item a menu could hold is sign-out,
  // which needs Clerk's client SDK and is therefore on the account page.
  const chip = cn(
    'focus-ring inline-flex h-9 items-center gap-2 rounded-pill border border-border bg-transparent px-3',
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
      className={cn(chip, 'transition-colors duration-fast ease-out hover:bg-accent/60')}
    >
      <UserRoundIcon className="size-4" aria-hidden />
      <span className="max-sm:sr-only">Account</span>
    </a>
  );
}
