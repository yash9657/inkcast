/**
 * Who is asking, for the four pages of the studio shell.
 *
 * `/studio`, `/library` and `/settings` are the pages that spend money, list
 * somebody's work, or describe how the box is configured. On the hosted
 * deployment they need an account behind them. On a self-hoster's laptop they
 * must behave exactly as they did before this file existed, because that is the
 * whole pitch (`docs/CONTRACT.md` §1: zero API keys, zero network) and a
 * mandatory third-party login service would break it.
 *
 * So this module answers one question — *is this visitor admitted?* — and its
 * first answer is `open`, meaning "there is no gate here at all".
 *
 * ## The gate is armed by configuration, not by code
 *
 * Two variables, both non-empty: `CLERK_SECRET_KEY` and
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. That test is `clerkConfigured` in
 * `app/api/_lib/clerk.ts` and is imported from there, which is worth a note only
 * because for one commit it was not. While `@clerk/nextjs` was declared in
 * `apps/web/package.json` but not yet on disk (`docs/CONTRACT.md` §4 forbids an
 * install while other agents hold the lockfile), importing `clerk.ts` from a page
 * pulled a bare `import('@clerk/nextjs/server')` into that page's webpack graph
 * and failed the build: `Module not found: Can't resolve '@clerk/nextjs/server'`,
 * import trace `./app/(app)/library/page.tsx`. So the predicate was copied here
 * and the copy was reported as debt in the same breath. The install has landed,
 * `clerk.ts` now holds only a type-only import of the SDK — erased by `tsc`,
 * invisible to webpack — and the duplicate is deleted. Two catalogues of one fact
 * is this repo's recurring pathology and this one lasted exactly as long as the
 * mechanical reason for it.
 *
 * ## Why a failure to load Clerk is not "signed out"
 *
 * A deployment that set both variables asked for accounts. If the SDK is missing
 * or `auth()` throws because `clerkMiddleware()` never ran, the honest answer is
 * `unavailable` — the gate is armed and there is no working door — not
 * `signed-out`, which would invite the visitor to press a sign-in button that
 * cannot work, and certainly not `open`, which would silently downgrade a site's
 * authentication because of a dependency error. `docs/PLAN-LAUNCH.md` names
 * silent degradation as this repo's dominant failure mode; this is the version of
 * it that would matter most.
 *
 * ## What this module is not
 *
 * It is not authorization. Every mutating route already runs `requireOwner`
 * against a keyed digest in `meta.json` (`app/api/_lib/session.ts`), and that
 * stays the arbiter. This decides what a *page* renders, which is a UX question:
 * a signed-out visitor should meet a sign-in prompt instead of a form that
 * POSTs into a 401. Nothing here can grant access to anything.
 */

import {
  CLERK_PUBLISHABLE_KEY_VAR,
  CLERK_SECRET_KEY_VAR,
  clerkConfigured,
} from '@/app/api/_lib/clerk';
import type { ClerkServerModule } from '@/app/api/_lib/clerk';

/**
 * Where the sign-in and sign-up pages live.
 *
 * Clerk's own variable names, and Clerk's own defaults, so an operator who has
 * followed any Clerk + Next tutorial is already configured. A deployment that
 * puts the flows somewhere else — or uses Clerk's hosted Account Portal, which
 * is an absolute URL on a different origin — overrides them here and every link
 * in the shell moves with it.
 */
const SIGN_IN_URL_VAR = 'NEXT_PUBLIC_CLERK_SIGN_IN_URL';
const SIGN_UP_URL_VAR = 'NEXT_PUBLIC_CLERK_SIGN_UP_URL';

/**
 * The account page, and the one link in the shell that is omitted rather than
 * guessed.
 *
 * There is no way to derive it: Clerk manages the profile inside its own
 * `<UserButton />` widget, and the hosted Account Portal lives on a per-instance
 * subdomain this app cannot know. `components/marketing/site-config.ts` states
 * the rule this follows — "every link resolves or is not rendered" — so when
 * this is unset the shell shows that you are signed in and offers no link,
 * rather than pointing at a 404.
 */
const ACCOUNT_URL_VAR = 'NEXT_PUBLIC_CLERK_ACCOUNT_URL';

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

function setting(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value ? value : fallback;
}

/**
 * `open` — no gate on this deployment; every page behaves as it always has.
 * `signed-in` — the gate is armed and this visitor is through it.
 * `signed-out` — the gate is armed and there is a working door to offer.
 * `unavailable` — the gate is armed and the door is broken. Operator error,
 *                 reported in words rather than hidden behind a dead button.
 */
export type Access =
  | { mode: 'open' }
  | { mode: 'signed-in' }
  | { mode: 'signed-out' }
  | { mode: 'unavailable'; reason: string };

/** Where the shell should send somebody, and whether it can link to a profile. */
export type AccessLinks = {
  signInUrl: string;
  signUpUrl: string;
  accountUrl: string | null;
};

export function accessLinks(env: NodeJS.ProcessEnv = process.env): AccessLinks {
  return {
    signInUrl: setting(env, SIGN_IN_URL_VAR, '/sign-in'),
    signUpUrl: setting(env, SIGN_UP_URL_VAR, '/sign-up'),
    accountUrl: present(env[ACCOUNT_URL_VAR]) ? env[ACCOUNT_URL_VAR]!.trim() : null,
  };
}

/** True when the page may render its real contents. */
export function admitted(access: Access): boolean {
  return access.mode === 'open' || access.mode === 'signed-in';
}

/**
 * Whether this visitor may use the studio.
 *
 * Called from a server component per request. It never throws: a page that
 * cannot work out who you are must still render something you can read.
 */
export async function readAccess(env: NodeJS.ProcessEnv = process.env): Promise<Access> {
  if (!clerkConfigured(env)) return { mode: 'open' };

  let clerk: ClerkServerModule;
  try {
    // A plain dynamic import, resolved by webpack. It used to carry
    // `webpackIgnore: true` so the build could succeed while `@clerk/nextjs` was
    // declared but not installed; keeping that comment now would be actively
    // worse than removing it, because a `webpackIgnore`d specifier is left as a
    // bare runtime `import()` that has to find the package in `node_modules` by
    // itself — which is exactly the layout `output: standalone` rewrites. Letting
    // webpack own the resolution is what makes this work in the Docker image.
    //
    // This is a server component, so the SDK lands in the server bundle only.
    // Nothing here is reachable from a client chunk: `sign-in-gate.tsx` imports
    // `Access` and `AccessLinks` with `import type`, which is erased.
    clerk = await import('@clerk/nextjs/server');
  } catch {
    return {
      mode: 'unavailable',
      reason: `This deployment sets ${CLERK_SECRET_KEY_VAR} and ${CLERK_PUBLISHABLE_KEY_VAR}, so it wants accounts, but the @clerk/nextjs package is not installed on the server.`,
    };
  }

  try {
    const { userId } = await clerk.auth();
    return userId ? { mode: 'signed-in' } : { mode: 'signed-out' };
  } catch {
    // `auth()` reaches for request context that only exists once
    // `clerkMiddleware()` has run. The usual cause is a `proxy.ts` whose
    // matcher does not cover this route, and the usual symptom before this
    // branch existed was a 500 on a page that had nothing wrong with it.
    return {
      mode: 'unavailable',
      reason:
        'Clerk is configured but could not read the request. The Clerk middleware is not running for this route, so no sign-in can be verified here.',
    };
  }
}

/*
 * There is deliberately no `withRedirect()` here. Building the "come back to
 * where I was" link needs the current pathname and search, which only the
 * browser-side hooks have, so it lives in `./sign-in-gate.tsx` next to its only
 * callers. Keeping it out of this module keeps this module out of the client
 * bundle: the `import('@clerk/nextjs/server')` above is meaningless in a browser
 * chunk, and the way to guarantee it never ends up in one is for no client
 * component to import a value from here. The `Access` and `AccessLinks` types
 * are imported with `import type`, which is erased.
 */
