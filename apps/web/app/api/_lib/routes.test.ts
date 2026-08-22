/**
 * Every route under `app/api`, and the identity check that guards it.
 *
 * This file is a source audit rather than a behavioural test, and that is a
 * deliberate choice with a specific defect behind it. A route handler cannot be
 * driven from `node --test` without standing up Next's request context — `auth()`
 * reads it, `NextResponse` writes it, `lib/jobs.ts` owns a live render registry —
 * so the honest options were "test nothing at this layer" or "test the one
 * property that is checkable from outside". The property is checkable, so it is
 * checked.
 *
 * ## The defect this exists to prevent, which had already happened
 *
 * Identity was migrated to `resolveIdentity` in `_lib/session.ts` — Clerk when
 * configured, the anonymous cookie when not, a 401 when configured and signed
 * out — and every one of the ten routes that reads a session kept calling
 * `readSession` instead. Both functions return a `Session` and both compile, so
 * nothing anywhere failed. The consequence was that on a Clerk deployment
 * `POST /api/generate` *minted a fresh anonymous session for a signed-out caller
 * and rendered them a film*: the sign-in requirement was satisfiable by having no
 * cookie at all. The pages showed a sign-in wall the whole time, which is exactly
 * what made it hard to see — a wall in a server component is a UX affordance and
 * every one of these endpoints is reachable with `curl`.
 *
 * That is not a bug a unit test on `session.ts` can catch, because `session.ts`
 * was correct. It is a wiring bug, and wiring is what this file reads.
 *
 * ## Why the table is exhaustive, and must stay so
 *
 * The assertion that matters most is not any single row: it is that the set of
 * route files on disk equals the set of rows here. A new route added later fails
 * this test until somebody writes down which bucket it is in — so the default for
 * a new endpoint is "the build is red", not "unauthenticated". The alternative
 * shape, a list of routes to check, would have silently ignored every route added
 * after it was written, which is the same class of defect as the one above.
 *
 * `docs/CONTRACT.md`'s rule that two catalogues of one fact drift toward the
 * permissive one applies to this file too, so it is careful to be a catalogue of
 * something else: not *who may act* (that is `requireOwner`, and only
 * `requireOwner`) but *which question each route asks first*.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/** `app/api`, from `app/api/_lib/`. */
const API_DIR = path.resolve(import.meta.dirname, '..');

/**
 * How a route establishes who is calling.
 *
 *  - `gated` — `resolveIdentity`, and a signed-out caller is refused. Every
 *    mutation, plus the two reads that would hand a stranger a project's
 *    diagnostics.
 *  - `public-read` — `resolveIdentity`, and a refusal is downgraded to the
 *    `stranger` session so `requireViewable` can answer "has this been shared".
 *    These must never 401 or every share link on the internet becomes a 404.
 *  - `account` — `accountOwner` in `app/api/keys/_account.ts`, which is
 *    `resolveIdentity` plus the encrypted-store configuration check.
 *  - `unauthenticated` — reads no identity at all, on purpose, and says so in its
 *    own header.
 */
type Guard = 'gated' | 'public-read' | 'account' | 'unauthenticated';

/**
 * The whole authorization surface of this API, one row per file.
 *
 * `mutates` is recorded because it is the column a reviewer actually scans, and
 * because it makes one rule mechanically checkable: **nothing that mutates may be
 * `public-read` or `unauthenticated`.** That is asserted below rather than left to
 * the reader.
 */
const ROUTES: Record<string, { guard: Guard; mutates: boolean; why: string }> = {
  'generate/route.ts': {
    guard: 'gated',
    mutates: true,
    why: 'creates a project and spends real money rendering it — the route the sign-in requirement exists for',
  },
  'generate/[id]/route.ts': {
    guard: 'gated',
    mutates: false,
    why: "a read, but of a job snapshot carrying the run's failure messages and paths on the box",
  },
  'generate/[id]/stream/route.ts': {
    guard: 'gated',
    mutates: false,
    why: 'live progress and error text for one run; refuses as an SSE event rather than a 401 because EventSource cannot read a non-2xx body',
  },
  'projects/route.ts': {
    guard: 'gated',
    mutates: false,
    why: "the library listing; an empty list would be a claim ('you have no projects') made to somebody who has a hundred",
  },
  'projects/[id]/route.ts': {
    guard: 'public-read',
    mutates: true,
    why: 'GET backs the public share page, which fetches it server-side with no cookie; DELETE is gated separately inside the same file',
  },
  'projects/[id]/edit/route.ts': {
    guard: 'gated',
    mutates: true,
    why: 'rewrites the storyboard',
  },
  'projects/[id]/rerender/route.ts': {
    guard: 'gated',
    mutates: true,
    why: 'starts a Chromium and an ffmpeg process',
  },
  'projects/[id]/share/route.ts': {
    guard: 'gated',
    mutates: true,
    why: 'makes a film public — the one mutation whose failure mode is a disclosure',
  },
  'media/[id]/[...path]/route.ts': {
    guard: 'public-read',
    mutates: false,
    why: 'the bytes a <video> and every range request behind it fetch, as whatever stranger is watching',
  },
  'keys/route.ts': {
    guard: 'account',
    mutates: true,
    why: "stores and deletes provider credentials; hosted requests are per-account and never reach the operator's vault",
  },
  'keys/validate/route.ts': {
    guard: 'account',
    mutates: true,
    why: "records a validation result against the caller's own record",
  },
  'providers/route.ts': {
    guard: 'unauthenticated',
    mutates: false,
    why: "the create form calls it before a session has made anything; on hosted it reports the caller's own keys and never the operator's",
  },
  'health/route.ts': {
    guard: 'unauthenticated',
    mutates: false,
    why: 'a healthcheck that needs a session is a healthcheck that cannot be scraped',
  },
};

/** Every `route.ts` under `app/api`, as a path relative to it. */
function discoverRoutes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...discoverRoutes(full, prefix ? `${prefix}/${entry}` : entry));
    } else if (entry === 'route.ts') {
      out.push(prefix ? `${prefix}/${entry}` : entry);
    }
  }
  return out;
}

function source(relative: string): string {
  return readFileSync(path.join(API_DIR, relative), 'utf8');
}

/**
 * Source with comments stripped, so a sentence *about* `readSession` in a
 * docstring is not mistaken for a call to it. Four of these files now explain in
 * prose why they no longer call it, and a naive `includes` would fail on exactly
 * the files that got the fix right.
 */
function code(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

test('every route on disk is classified here, and nothing here is stale', () => {
  const onDisk = discoverRoutes(API_DIR).sort();
  const declared = Object.keys(ROUTES).sort();

  // Reported as two directed differences rather than a set comparison, because
  // "you added a route" and "you deleted a route" need different sentences and a
  // failed `deepEqual` on two long arrays says neither.
  const undeclared = onDisk.filter((r) => !declared.includes(r));
  const missing = declared.filter((r) => !onDisk.includes(r));

  assert.deepEqual(
    undeclared,
    [],
    `new route(s) with no declared identity check. Add a row to ROUTES in this file saying which guard applies and why. Do not default to 'unauthenticated' to make this pass: ${undeclared.join(', ')}`,
  );
  assert.deepEqual(
    missing,
    [],
    `ROUTES names route file(s) that no longer exist: ${missing.join(', ')}`,
  );
});

test('no route reads the raw cookie session directly', () => {
  // `readSession` mints a fresh anonymous session for a caller with no cookie.
  // That is correct on a laptop and is precisely the hole on a deployment with
  // accounts, so the only module allowed to call it is `resolveIdentity` in
  // `_lib/session.ts` — which is outside `app/api/*/route.ts` and so outside this
  // walk.
  for (const relative of Object.keys(ROUTES)) {
    assert.ok(
      !/\breadSession\s*\(/.test(code(relative)),
      `${relative} calls readSession(). Use resolveIdentity() instead: readSession mints an anonymous identity for a caller who has none, so a signed-out visitor on a Clerk deployment would be handed one.`,
    );
  }
});

test('nothing that mutates is reachable without an identity check', () => {
  for (const [relative, row] of Object.entries(ROUTES)) {
    if (!row.mutates) continue;
    assert.notEqual(
      row.guard,
      'unauthenticated',
      `${relative} mutates and is declared unauthenticated. There is no version of that which is correct.`,
    );
  }
});

test('gated routes resolve identity and refuse a signed-out caller', () => {
  for (const [relative, row] of Object.entries(ROUTES)) {
    if (row.guard !== 'gated') continue;
    const body = code(relative);
    assert.ok(
      /resolveIdentity\s*\(/.test(body),
      `${relative} is declared gated but never calls resolveIdentity()`,
    );
    // The refusal, in either of the two shapes the API uses: `fail(...)` for a
    // JSON route, `oneShot(...)` for the SSE stream, which cannot use a 4xx
    // because EventSource discards the body of one.
    assert.ok(
      /if\s*\(\s*!who\.ok\s*\)\s*return\s+(fail|oneShot)\s*\(/.test(body),
      `${relative} calls resolveIdentity() but does not refuse on !who.ok — a resolved identity that is never checked is not a gate`,
    );
    assert.ok(
      !/who\.stranger/.test(body),
      `${relative} is gated but falls back to who.stranger. That downgrade belongs only to the two public read paths.`,
    );
  }
});

test('gated routes still ask requireOwner, not just who is calling', () => {
  // Identity is not authorization. `resolveIdentity` answers "is there somebody
  // there"; `requireOwner` answers "may this somebody touch this project". A
  // route that did the first and skipped the second would let any signed-in
  // account act on any project id.
  for (const [relative, row] of Object.entries(ROUTES)) {
    if (row.guard !== 'gated') continue;
    const body = code(relative);
    assert.ok(
      /requireOwner\s*\(|ownedProjectsFilter\s*\(/.test(body),
      `${relative} resolves an identity but never scopes anything to it — no requireOwner() and no ownedProjectsFilter()`,
    );
  }
});

test('the two public read paths degrade to a stranger instead of refusing', () => {
  // The property that keeps every published share link alive. `app/share/[id]/
  // page.tsx` fetches `GET /api/projects/<id>` server-side without forwarding the
  // cookie, and `<video src>` hits `/api/media/<id>/out.mp4` as whatever stranger
  // is watching. A 401 on either turns the whole share surface into 404s, and it
  // would look like a rendering bug.
  const publicReads = Object.entries(ROUTES)
    .filter(([, row]) => row.guard === 'public-read')
    .map(([relative]) => relative);

  assert.deepEqual(
    publicReads.sort(),
    ['media/[id]/[...path]/route.ts', 'projects/[id]/route.ts'],
    'the set of routes that must answer an anonymous stranger changed. That set is load-bearing for every share link; change it deliberately or not at all.',
  );

  for (const relative of publicReads) {
    const body = code(relative);
    assert.ok(
      /who\.ok\s*\?\s*who\.session\s*:\s*who\.stranger/.test(body),
      `${relative} must downgrade a refusal to who.stranger, or every share link 404s`,
    );
    assert.ok(
      /requireViewable\s*\(/.test(body),
      `${relative} serves a stranger but never calls requireViewable() — that is the only thing standing between a stranger and an unshared project`,
    );
  }
});

test('the Clerk request hook is named proxy.ts, not middleware.ts', () => {
  // The single most expensive filename in this repository, and the failure it
  // guards is silent in every observable except the one that matters.
  //
  // On Next 16.2.12 a `middleware.ts` is still discovered (`next build` lists
  // `ƒ Proxy (Middleware)`) and the function still runs — instrumented, it stamped
  // its own response header on every request and `clerkMiddleware()` never threw.
  // What is *not* applied from a legacy `middleware.ts` is the
  // `x-middleware-override-headers` request rewrite, which is the only channel
  // Clerk has for handing its auth state to the app: `detectClerkMiddleware()` is
  // `Boolean(getAuthKeyFromRequest(req, 'AuthStatus'))` and that header never
  // arrived. So `auth()` threw on every request, `resolveIdentity` correctly
  // refused rather than downgrading, and the result was a site that 401'd
  // everybody while looking perfectly configured. Renaming the file was the entire
  // fix.
  //
  // Asserted here because nothing else would catch it. It typechecks either way,
  // it builds either way, and it only misbehaves on a deployment that has Clerk
  // configured — which is exactly the deployment nobody runs locally.
  const webRoot = path.resolve(API_DIR, '..', '..');
  assert.ok(
    existsSync(path.join(webRoot, 'proxy.ts')),
    'apps/web/proxy.ts is missing. Clerk needs a request hook and Next 16 only applies the request-header override from `proxy`, so without this file every request on a Clerk deployment is a 401.',
  );
  assert.ok(
    !existsSync(path.join(webRoot, 'middleware.ts')),
    'apps/web/middleware.ts exists. Next 16.2.12 runs it but does not apply its request-header override, so Clerk auth state never reaches the app and every gated route 401s. Rename it to proxy.ts.',
  );
});

test('the hosted key path never imports the operator vault at module scope', () => {
  // `_store.ts` is `@inkcast/keyvault` — the macOS keychain, the operator's own
  // credentials, the ones paying for every visitor's film. On a hosted box no
  // request may reach it, and the way that is guaranteed is that the module is
  // absent from the graph: every import of it sits inside a local-only branch.
  // A top-level `import … from './_store.js'` would make it present again while
  // every `isHosted()` check still read correctly, which is the shape of the
  // failure recorded in `_lib/http.ts`.
  for (const relative of ['keys/route.ts', 'keys/validate/route.ts', 'providers/route.ts']) {
    const body = code(relative);
    const topLevel = /^\s*import\s+(?!type\b)[^;]*from\s+'[^']*_store\.js'/m.test(body);
    assert.ok(
      !topLevel,
      `${relative} imports keys/_store.js at module scope. Load it with a dynamic import inside the local branch so a hosted request cannot reach the operator's keychain.`,
    );
  }
});
