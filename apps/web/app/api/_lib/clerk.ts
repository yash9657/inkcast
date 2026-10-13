/**
 * Is this deployment configured with an identity provider? And nothing else.
 *
 * `inkcast.video` requires a sign-in before it will spend money on a render, and
 * Clerk is what it signs people in with. A self-hoster is a different deployment
 * with a different bargain: `docs/CONTRACT.md` §1 says the thing must work with
 * zero API keys and zero network, and the landing page sells exactly that ("no
 * account, no key" — `components/marketing/features.tsx`). A mandatory
 * third-party login service would break both the contract and the pitch, so Clerk
 * cannot be architecture here. It is configuration, and `clerkConfigured()` is
 * the whole of the switch.
 *
 * ## Why this file imports nothing
 *
 * Not a style choice — it is the file's job. Three very different callers need
 * this one predicate:
 *
 *  - `./session.ts`, which runs on the Node runtime;
 *  - `../../../proxy.ts`, which runs on the **Edge** runtime and therefore
 *    cannot reach `node:crypto`, `node:fs`, or anything that transitively does;
 *  - `app/layout.tsx` and `app/(app)/access.ts`, which are server components on
 *    the page-render path, where dragging an authentication SDK into the module
 *    graph costs bundle size for a question answered by two environment
 *    variables.
 *
 * Anything imported here would be imported into all three. So the module load of
 * `@clerk/nextjs` lives at each consumer — `session.ts` needs `auth`, the
 * middleware needs `clerkMiddleware`, the layout needs `ClerkProvider`, and those
 * are three different entry points for three different runtimes — while the one
 * *fact* they share lives here. That distinction matters: two catalogues of one
 * fact is this repo's recurring pathology (see `offOnHostedBox` in `./http.ts`,
 * written after `/settings` and `/api/keys` disagreed about whether the vault was
 * reachable), and the fact is "is Clerk configured", not "how is Clerk loaded".
 *
 * An earlier version of this file did export the loader, and it was measurably
 * wrong for exactly this reason: `app/(app)/access.ts` could not import the
 * predicate without pulling a bare `import('@clerk/nextjs/server')` into a page's
 * webpack graph, which fails the build while the package is declared-but-not-yet-
 * installed (`Module not found: Can't resolve '@clerk/nextjs/server'`, import
 * trace `./app/(app)/library/page.tsx`). It duplicated the env test instead. That
 * duplicate is now deleted — `access.ts` imports `clerkConfigured` from here.
 *
 * The `import type` below does not weaken any of that. TypeScript erases a
 * type-only import entirely, so it produces no `require`, no `import()` and no
 * edge in webpack's module graph; it is checked by `tsc` and then gone. That is
 * the same mechanism `access.ts` relies on to keep `Access` out of the client
 * bundle.
 *
 * ## Why the two variables, and why "present and non-empty"
 *
 * `CLERK_SECRET_KEY` alone would be enough to authenticate a request, and
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` alone would be enough to render a sign-in
 * button. Requiring *both* is deliberate: a deployment holding one of them is a
 * half-configured deployment, and the two failure modes it produces are the
 * worst two available. Secret-only means every request resolves to signed-out
 * with no way to sign in — a site that refuses everybody and offers no door.
 * Publishable-only means a visible, working sign-in flow whose result the server
 * cannot verify, which is a login page that authenticates nobody. Demanding the
 * pair turns both into the honest local behaviour instead: anonymous cookies,
 * exactly as today.
 *
 * "Non-empty after trimming" for the same reason `requireSessionSecret` insists
 * on it: an unset variable in a shell script becomes `CLERK_SECRET_KEY=` in the
 * environment, and a check on presence alone reads that as configured.
 */

import type { NextMiddleware } from 'next/server';

import type { auth, clerkMiddleware } from '@clerk/nextjs/server';

/** The two variables that decide it, named so a message can quote them. */
export const CLERK_SECRET_KEY_VAR = 'CLERK_SECRET_KEY';
export const CLERK_PUBLISHABLE_KEY_VAR = 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY';

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

/**
 * True when this deployment has an identity provider, false when identity is the
 * anonymous cookie in `./session.ts`.
 *
 * Takes an injectable `env` for the same reason every export in `./session.ts`
 * does: both branches have to be exercisable in one test process, without
 * mutating globals and hoping the module cache cooperates.
 *
 * A note for whoever debugs "I set the keys and it still says signed out": the
 * repo-root `.env` is read by `lib/store.ts`, not by Next, and middleware never
 * imports `lib/store.ts` (it cannot — `node:fs`). So the Clerk variables have to
 * be in the real environment or in `apps/web/.env.local`, which Next itself
 * loads, or the middleware will see them missing while a route handler sees them
 * set. That split is exactly the kind of half-configuration the two-variable
 * rule above is meant to make loud rather than subtle.
 */
export function clerkConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return present(env[CLERK_SECRET_KEY_VAR]) && present(env[CLERK_PUBLISHABLE_KEY_VAR]);
}

/**
 * The slice of `@clerk/nextjs/server` this app calls, and no more.
 *
 * Two exports out of the fourteen the module has. That narrowness is the point:
 * it is a written-down statement of scope, and `grep -n ClerkServerModule
 * apps/web` is the list of everything this codebase asks Clerk to do. In
 * particular `auth().protect()` is not in it — the authorization arbiter here is
 * `requireOwner` in `./session.ts`, comparing a keyed digest of an identity
 * against the project's own `meta.json`, and a second mechanism that could also
 * decide "may this caller act" is the exact shape of defect `./http.ts`'s
 * `offOnHostedBox` was written after.
 *
 * ## These are the SDK's real types, and that took an install to become possible
 *
 * The first version of this block hand-wrote both signatures, because
 * `docs/CONTRACT.md` §4 forbids running `pnpm add` while other agents hold the
 * lockfile: `@clerk/nextjs` was *declared* (pinned to 7.8.0) and not on disk, and
 * `tsc` cannot resolve a package that is not there. The hand-written shapes were
 * then wrong in a way that only the install could reveal — `clerkMiddleware` was
 * typed `() => Handler`, but the real export is an overloaded interface whose
 * first call signature *requires* a handler argument, so `mod as
 * ClerkServerModule` became `error TS2352: … neither type sufficiently overlaps`
 * the moment the package landed. A guessed type that compiles is not a checked
 * type; it is an unchecked one with a `@ts-ignore`-shaped hole next to it.
 *
 * So the three suppressions this replaces (`session.ts`'s `clerkUserId`,
 * `proxy.ts`'s `clerkHandler`, `app/layout.tsx`) are gone rather than
 * relocated. `typeof auth` and `typeof clerkMiddleware` cannot drift from the
 * SDK by construction, and an ambient `declare module '@clerk/nextjs/server'`
 * would have been the worst of the three options available: it compiles before
 * *and* after installation, which means it would have permanently shadowed the
 * real package's types with the guessed ones and nobody would have found out.
 */
export type ClerkServerModule = {
  auth: typeof auth;
  clerkMiddleware: typeof clerkMiddleware;
};

/**
 * What `clerkMiddleware()` returns when it is called with no arguments.
 *
 * Written as Next's own `NextMiddleware` and deliberately *not* as
 * `ReturnType<typeof clerkMiddleware>`. `clerkMiddleware` is a four-overload
 * interface, and `ReturnType` reads the last overload — which is the "used
 * directly as the middleware" form `(request, event) => NextMiddlewareReturn`, so
 * that alias resolves to a *response*, not to a function. Measured: `error
 * TS2349: This expression is not callable. No constituent of type
 * 'NextResponse<unknown> | Response' is callable`. The overload this app actually
 * calls is `(options?) => NextMiddleware`, so that is the type named here.
 */
export type ClerkMiddlewareHandler = NextMiddleware;
