/**
 * Clerk's middleware when Clerk is configured, and a pass-through when it is not.
 *
 * This file exists because Clerk's App Router SDK requires it. `auth()` in a
 * route handler reads request context that `clerkMiddleware()` attaches, and
 * without it Clerk throws rather than returning "signed out" — so there is no
 * version of Clerk-in-Next that does not have a middleware. What there *is* a
 * choice about is what it does, and the answer here is: as little as possible.
 *
 * ## Why this file is `proxy.ts` and not `middleware.ts`
 *
 * Because with the file named `middleware.ts` the entire Clerk integration is
 * dead, and it is dead in the most expensive possible way: it looks configured
 * and it refuses everybody.
 *
 * This was measured, not guessed, and it is worth writing down in full because
 * every symptom points somewhere other than the filename. On Next 16.2.12 a file
 * named `middleware.ts` is still found — `next build` prints `The "middleware"
 * file convention is deprecated. Please use "proxy" instead.` and then lists
 * `ƒ Proxy (Middleware)` in the route table, so it is registered. The function
 * also genuinely *runs*: instrumented to stamp a header on its own response, it
 * reported `x-inkcast-mw: ran` on both `/studio` and `/api/projects`, and
 * `clerkMiddleware()` did not throw. Every observable said the middleware was
 * working.
 *
 * What did not survive was the *request* rewrite. Clerk does not hand its auth
 * state to the app in a variable; it cannot, because the two run in different
 * runtimes. `decorateRequest` in `@clerk/nextjs/dist/esm/server/utils.js` calls
 * `setRequestHeadersOnNextResponse`, which encodes the auth state as
 * `x-middleware-override-headers` plus a set of `x-middleware-request-*` headers
 * on the middleware's response, and Next is supposed to apply those to the
 * downstream request. `auth()` then reads one of them —
 * `detectClerkMiddleware()` in `headers-utils.js` is literally
 * `Boolean(getAuthKeyFromRequest(req, 'AuthStatus'))`. Under `middleware.ts` on
 * this version of Next that override is not applied, so the header never arrives,
 * so `auth()` throws `Clerk: auth() was called but Clerk can't detect usage of
 * clerkMiddleware()` on every single request.
 *
 * The consequence, before the rename: `resolveIdentity` turned that throw into a
 * 401 (correctly — it refuses rather than downgrading to anonymous, see
 * `app/api/_lib/session.ts`), so **every** gated route 401'd, `/studio` rendered
 * the `unavailable` wall with no working door, and a signed-in user was not
 * possible. Renaming this file to `proxy.ts` and changing nothing else fixed all
 * of it in one build: `auth()` resolves, the wall renders its real signed-out
 * state, and the sign-in link comes back with `redirect_url=%2Fstudio` on it.
 *
 * Clerk's own error message accepts either name ("Your middleware or proxy file
 * exists at ./middleware.(ts|js) or proxy.(ts|js)"), and Clerk's detection is
 * name-agnostic — it only ever looks for that request header. So there is no
 * Clerk-side reason to prefer the old name, which is what the previous version of
 * this comment was weighing. There is only a Next-side reason to prefer the new
 * one, and it is decisive.
 *
 * ## It is not an authorization layer, and must not become one
 *
 * `clerkMiddleware()` is called with no arguments. It is invoked for its context
 * and its token refresh, and it protects nothing: no `auth.protect()`, no
 * `createRouteMatcher` list of guarded paths, no redirect. Every authorization
 * decision in this codebase is still made by `requireOwner` / `requireViewable`
 * in `app/api/_lib/session.ts`, against the keyed owner tag in the project's own
 * `meta.json`.
 *
 * That is a deliberate refusal of the obvious design, so here is the reasoning
 * rather than the assertion. A matcher that listed the protected routes would be
 * a second catalogue of one fact — "who may touch a project" — and this repo has
 * grown that shape before and been bitten by it every time. The nearest example
 * is documented at length in `app/api/_lib/http.ts`: `/settings` stopped
 * rendering the BYOK panel when `INKCAST_HOSTED=1` while `/api/keys` stayed live
 * and unguarded, because hiding a panel had been mistaken for closing a door, and
 * `grep -rn isHosted apps/web/app/api/keys/` returned nothing at all. Two
 * catalogues do not drift symmetrically. They drift toward the permissive one,
 * because the strict one is the one that generates bug reports.
 *
 * There is a second, sharper reason a path matcher would be wrong here. The share
 * surface depends on unauthenticated API calls succeeding:
 * `app/share/[id]/page.tsx` renders by fetching its own `GET /api/projects/<id>`
 * server-side and *does not forward the cookie*, and `<video src>` on that page
 * hits `GET /api/media/<id>/out.mp4` as whatever stranger is watching. Both are
 * answered correctly today by `requireViewable`, which says yes only for
 * `shared: true`. A middleware that redirected unauthenticated `/api/**` traffic
 * to a sign-in page would turn every share link on the internet into a 404, and
 * the 404 would look like a rendering bug rather than an auth bug. Leaving the
 * decision with `requireViewable` means the share path cannot be broken from
 * here.
 *
 * ## Inert without configuration
 *
 * Next loads this file whenever it exists, so "optional Clerk" has to be decided
 * inside it. `clerkConfigured()` is read once at module scope; when it is false
 * the request is passed straight through and `@clerk/nextjs/server` is never
 * imported — the import lives inside `loadClerkServer()`, behind the branch. That
 * matters concretely: `clerkMiddleware()` throws when it cannot find a
 * publishable key, so a self-hoster running `pnpm dev` with no Clerk account
 * would get a 500 on every route from a module they never asked for.
 *
 * The matcher cannot be conditional — Next extracts `config` statically, so it
 * cannot depend on an environment variable — which is why the pass-through
 * function is the switch instead. The cost of that on an unconfigured deployment
 * is one function call per request that returns `NextResponse.next()`.
 *
 * ## The environment footgun, written down because it will happen
 *
 * The repo-root `.env` is read by `lib/store.ts` at import time, not by Next. This
 * file cannot import `lib/store.ts` — middleware runs on the Edge runtime and that
 * module uses `node:fs` — so the Clerk variables must be in the real environment
 * or in `apps/web/.env.local`, which Next loads itself. Putting them only in the
 * repo-root `.env` produces the confusing half-state: route handlers see Clerk
 * configured, this file does not, and `auth()` therefore throws on every request
 * because no middleware attached its context. `resolveIdentity` turns that into a
 * 401 rather than a crash, but the fix is the env file, not the code.
 */

import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

import { clerkConfigured } from '@/app/api/_lib/clerk';
import type { ClerkMiddlewareHandler } from '@/app/api/_lib/clerk';

/**
 * Read once, at module scope. A per-request read would let a deployment change
 * identity providers halfway through serving a page, and the variables are set
 * before the process starts in every deployment that has them.
 */
const CONFIGURED = clerkConfigured(process.env);

/**
 * Built once and memoised. `clerkMiddleware()` sets up its own state, so calling
 * it per request would be both wasteful and a different object each time.
 *
 * The module load lives here rather than in `_lib/clerk.ts` on purpose: that file
 * is imported by server components and by the Node-runtime session module, and a
 * bare `import('@clerk/nextjs/server')` sitting in it would drag an
 * authentication SDK into every one of their bundles. See its header, which also
 * records why this call no longer needs a cast: `ClerkServerModule` is now built
 * from the SDK's own `typeof clerkMiddleware`, and the hand-written shape it
 * replaced was wrong about this exact expression.
 */
let handler: Promise<ClerkMiddlewareHandler> | undefined;

function clerkHandler(): Promise<ClerkMiddlewareHandler> {
  return (handler ??= import('@clerk/nextjs/server').then((mod) => mod.clerkMiddleware()));
}

export default async function middleware(
  request: NextRequest,
  event: NextFetchEvent,
): Promise<Response> {
  if (!CONFIGURED) return NextResponse.next();
  const result = await (await clerkHandler())(request, event);
  // Clerk returns a response for every request it handles, but the middleware
  // contract permits nothing at all, and `undefined` reaching Next as a return
  // value is a 500 rather than a pass-through. Normalising here costs one `??`.
  return result ?? NextResponse.next();
}

export const config = {
  /**
   * Clerk's published matcher: everything except Next's own internals and
   * anything that looks like a static file.
   *
   * Broad, and safe to be broad *because* of the no-protection rule above — the
   * handler attaches context and answers nothing. It has to be broad: identity is
   * read in `/api/media/<id>/<path…>` (an owner watching their own unshared film)
   * and in `/api/projects/<id>`, so excluding `/api/**` would make `auth()` throw
   * on exactly the routes that need it.
   *
   * The one behaviour that could still surprise is Clerk's handshake redirect,
   * which exists to re-issue a session token. It is gated on the request being a
   * document navigation (`Sec-Fetch-Dest: document`, or an `Accept` that includes
   * `text/html`), so the subresource traffic that would be broken by a redirect —
   * `<video>` ranges, `<img>` thumbnails, `fetch` calls — is not eligible for it.
   * If a share page ever starts redirecting media requests, this is the first
   * place to look.
   */
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    /*
     * Clerk's auto-proxy path, and it has to be listed even though the first
     * pattern above already appears to cover it.
     *
     * `/__clerk/*` is where the SDK serves its own handshake and token-refresh
     * traffic when it proxies the Frontend API through this origin rather than
     * through `clerk.<domain>`. Those requests must reach `clerkMiddleware()` or
     * the handshake never completes, and the symptom is not an error — it is a
     * session that silently fails to establish, which is the most expensive kind
     * of bug to chase because every individual piece looks configured. Clerk's
     * own setup instructions call for this entry explicitly and place it after the
     * API/TRPC matcher, so it is written the way they publish it rather than
     * folded into the negative lookahead above, where a future edit to that
     * regex could drop it without anybody noticing.
     */
    '/__clerk/:path*',
  ],
};
