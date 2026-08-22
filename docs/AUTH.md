# Accounts, sessions and API keys

Everything that decides **who is asking** and **whose key pays for it**. Written so
that a human with a domain and a box can configure `inkcast.video` from this file
alone; the last section is the honest list of what is not finished.

The one sentence to take away before the details: **accounts are configuration,
not architecture.** Set no Clerk variables and this is the same anonymous,
keyless, network-free studio it has always been — `docs/CONTRACT.md` §1 requires
that, the landing page sells it, and it is tested. Set them and the same build
becomes a signed-in product.

---

## The two deployments, side by side

|                        | Self-hosted (`pnpm dev`, a laptop, a private box) | Shared (`inkcast.video`)                       |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Identity               | Signed anonymous cookie                           | Clerk account                                  |
| Generating a video     | Open                                              | Requires sign-in                               |
| `/library`             | This browser's projects                           | This account's projects                        |
| `/sign-in`, `/sign-up` | **404** — no such page here                       | Clerk's flow                                   |
| Provider keys          | `@inkcast/keyvault` (macOS keychain / vault file) | Per-account, encrypted at rest on the box      |
| `/settings`            | The BYOK panel                                    | An explanation (see "Not finished" below)      |
| Landing page copy      | "no account, no key"                              | The truth about signing in                     |
| Required secrets       | none                                              | `INKCAST_SESSION_SECRET`, `INKCAST_SECRET_KEY` |

Nothing switches these together. `INKCAST_HOSTED=1` and the Clerk pair are
independent, and all four combinations are supported — a private team box that
wants the rate limiter and server-funded keys but no accounts is
`INKCAST_HOSTED=1` with no Clerk variables, and it works.

---

## Configure inkcast.video in fifteen minutes

### 1. Two secrets, generated locally (2 min)

```sh
echo "INKCAST_SESSION_SECRET=$(openssl rand -hex 32)" >> .env
echo "INKCAST_SECRET_KEY=$(openssl rand -hex 32)"     >> .env
```

Both are mandatory once `INKCAST_HOSTED=1`, and both fail **loudly at import** when
missing rather than at the first request that needs them — `apps/web/app/api/_lib/
session.ts` and `.../secrets.ts` each end with a boot check. `docker-compose.yml`
declares them with `:?`, so `docker compose up` refuses rather than starting a box
whose API is dead. Minimum length 24 characters; `openssl rand -hex 32` gives 64.

Keep both. Losing `INKCAST_SESSION_SECRET` orphans every project on disk (owner
tags stop matching). Losing `INKCAST_SECRET_KEY` makes every stored API key
permanently unreadable.

### 2. A Clerk instance (5 min)

1. Create an application at <https://dashboard.clerk.com>. The free tier is enough.
2. Copy the two keys from **API keys**: `pk_…` and `sk_…`.
3. Add the site's origin to Clerk's allowed origins, and set the instance's
   sign-in/sign-up paths to `/sign-in` and `/sign-up` — the paths this app serves.

```sh
echo "CLERK_PUBLISHABLE_KEY=pk_live_..." >> .env   # NOT secret; also a build arg
echo "CLERK_SECRET_KEY=sk_live_..."      >> .env   # secret; runtime only
```

**Both or neither.** One alone is treated as _unconfigured_
(`clerkConfigured` in `apps/web/app/api/_lib/clerk.ts`), because secret-only is a
site that refuses everybody with no door and publishable-only is a login page whose
result the server cannot verify. Half-configured is the one state worth making
impossible.

### 3. The publishable key must ALSO be a build argument (1 min)

This is the mistake to avoid, and it is silent.

`next build` prerenders the landing page, and `signInRequired` in
`apps/web/components/marketing/site-config.ts` reads
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. So the landing copy is **frozen at build
time**. An image built without the key and run with it serves "no API keys" and
"No account, no key" on a site that requires an account — a false claim on the
highest-traffic page, shipped by the happy path.

`docker-compose.yml` already passes it in both places from one variable:

```yaml
build:
  args:
    CLERK_PUBLISHABLE_KEY: ${CLERK_PUBLISHABLE_KEY:-}
environment:
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${CLERK_PUBLISHABLE_KEY:-}
  CLERK_SECRET_KEY: ${CLERK_SECRET_KEY:-}
```

Building by hand: `docker build --build-arg CLERK_PUBLISHABLE_KEY=pk_live_… .`
`CLERK_SECRET_KEY` is deliberately **not** a build argument — build args are
readable in image history and nothing at build time needs it.

### 4. Where the variables have to live (1 min)

Only relevant when running from source rather than the image.

The repo-root `.env` is read by `apps/web/lib/store.ts`, **not by Next**.
`apps/web/proxy.ts` runs on the Edge runtime and cannot import that module
(`node:fs`), so it never sees the root `.env`. Put Clerk variables in the real
environment or in **`apps/web/.env.local`**, which Next loads itself. Putting them
only in the root `.env` gives the half-state where route handlers see Clerk
configured and the proxy does not, and `auth()` then throws on every request.

### 5. The rest (3 min)

```sh
INKCAST_HOSTED=1
INKCAST_PUBLIC_URL=https://inkcast.video   # also a build arg; empty is legal
INKCAST_PROJECTS=/data/projects            # must be a persistent volume
```

`INKCAST_PUBLIC_URL` is what `metadataBase` and absolute share URLs use. Empty is
a working value — `/share/<id>` then derives its base from `Host` and
`X-Forwarded-Proto`, which the Caddyfile sets — but Open Graph images need an
absolute URL, so set it.

Optional, all with sane defaults:

| Variable                        | Default                   | What it does                                          |
| ------------------------------- | ------------------------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in`                | Where the wall's first button points                  |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up`                | Where its second button points                        |
| `NEXT_PUBLIC_CLERK_ACCOUNT_URL` | _unset_                   | Clerk's Account Portal — **the only way to sign out** |
| `INKCAST_SECRETS_DIR`           | `$INKCAST_PROJECTS/.keys` | Where encrypted per-account keys live                 |

`NEXT_PUBLIC_CLERK_ACCOUNT_URL` deserves a note. Signing out needs Clerk's client
SDK; a link cannot do it, and this app renders no Clerk widgets in its shell (see
`apps/web/app/(app)/sign-in-gate.tsx` for why). With this unset the nav shows an
unlinked "Signed in" chip — following the repo's "every link resolves or is not
rendered" rule — and **there is no sign-out control in the app at all.** Set it to
your instance's Account Portal URL (`https://accounts.<your-domain>/user`).

### 6. Verify (2 min)

```sh
curl -s https://inkcast.video/api/health                    # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://inkcast.video/api/generate   # 401
curl -s -o /dev/null -w '%{http_code}\n' https://inkcast.video/sign-in               # 200
```

Then open `/studio` signed out. You should see the sign-in wall with two working
buttons. If instead it says _"Clerk is configured but could not read the
request"_, the proxy is not running for that route — see the next section.

---

## `proxy.ts`, and why the filename matters

`apps/web/proxy.ts` is Clerk's request hook. It calls `clerkMiddleware()` with no
arguments and **authorizes nothing** — no `auth.protect()`, no matcher list of
guarded paths, no redirect. Every authorization decision is made by `requireOwner`
/ `requireViewable` in `apps/web/app/api/_lib/session.ts` against the keyed owner
tag in each project's own `meta.json`.

That refusal is deliberate: a path matcher would be a second catalogue of "who may
touch a project", and it would break the share surface, because
`app/share/[id]/page.tsx` renders by fetching its own `GET /api/projects/<id>`
server-side **without forwarding the cookie**, and `<video src>` hits
`/api/media/<id>/out.mp4` as whatever stranger is watching. A middleware that
redirected unauthenticated `/api/**` would turn every published share link into a
404 that looked like a rendering bug.

**Do not rename this file to `middleware.ts`.** On Next 16.2.12 a legacy
`middleware.ts` is still discovered and still runs, but its
`x-middleware-override-headers` request rewrite is not applied — and that rewrite
is the only channel Clerk has for handing auth state to the app. The result is
`auth()` throwing `Clerk can't detect usage of clerkMiddleware()` on every
request, so every gated route 401s and `/studio` renders the "could not read the
request" wall while the deployment looks perfectly configured. This was measured,
and `apps/web/app/api/_lib/routes.test.ts` now fails if the file moves back.

---

## Identity, end to end

One function decides: `resolveIdentity` in `apps/web/app/api/_lib/session.ts`.

- **Clerk unconfigured** → the signed anonymous cookie (`readSession`). Nothing in
  `@clerk/nextjs` is imported, let alone called.
- **Clerk configured, signed in** → session id `clerk:<userId>`.
- **Clerk configured, signed out** → **401**. Not a fall-through to the cookie: the
  sign-in requirement must not be satisfiable by clearing one, and a fall-through
  would also give each person two half-libraries that swap places when they sign
  out.
- **Clerk configured, broken** (SDK missing, proxy not reached, Clerk unreachable)
  → also 401. Never a downgrade to anonymous. An authentication check that becomes
  a no-op when its dependency fails is the worst available failure mode.

**No raw identity ever reaches disk.** `meta.json` stores
`ownerTagFor(session)` — `HMAC-SHA256(INKCAST_SESSION_SECRET, "inkcast.owner.v1:" +
id)`, base64url. The `clerk:` prefix is load-bearing: anonymous ids match
`/^[A-Za-z0-9_-]{16,64}$/` and cannot contain a colon, so the two id spaces are
provably disjoint and no Clerk user id can be spelled as a cookie id.

Two routes never 401, and this is load-bearing rather than an oversight:
`GET /api/projects/<id>` and `GET|HEAD /api/media/<id>/<path…>`. A signed-out
caller there is downgraded to a _stranger_ session that matches nothing, and
`requireViewable` answers the only question a stranger can ask — has the owner
shared this. Break either and every share link dies.

---

## Per-account API keys

On `INKCAST_HOSTED=1`, `/api/keys` stores each account's provider credentials in
`$INKCAST_PROJECTS/.keys/<sha256(ownerTag)>.json` (dir `0700`, files `0600`,
atomic write). Envelope encryption, `node:crypto` only, no new dependency: a fresh
random 32-byte data key seals the credential with AES-256-GCM, and
`INKCAST_SECRET_KEY` seals the data key. Both layers bind AAD built from the owner
**the caller asked for**, so a record moved between accounts, moved between
providers, or sealed under a different master key fails authentication with one
indistinguishable error.

Nothing ever reads a key back out over the wire. `GET` unseals nothing — the mask,
length and timestamps are cleartext metadata stored beside the ciphertext.

Locally none of this is used: `pnpm dev` keeps using `@inkcast/keyvault` (the macOS
keychain, or an encrypted `~/.inkcast/vault.json`). The two stores are never both
reachable — on a hosted box `apps/web/app/api/keys/_store.ts` is not even imported,
so "a stranger's request cannot reach the operator's keychain" is a property of the
module graph rather than of an `if`.

`.keys` lives inside the projects directory on purpose: it is the one volume a
hosted deploy must already persist. Two consequences worth knowing:

- The leading dot is a guard. Project ids must start with an alphanumeric, so
  `.keys` can never appear in the library index and `/api/media` can never serve a
  byte of it.
- The disk janitor skips it. `scripts/janitor.mjs` selects directories by an
  **allow-list** of the project-id pattern; it used to use a deny-list, which would
  have `rm -rf`'d `.keys` 48 hours after launch and destroyed every stored
  credential on the box.

### Rotating the encryption key

Not a one-line change, because the **filename** is derived from the key as well as
the contents. Rotating `INKCAST_SECRET_KEY` requires, for every record: unseal the
data key under the old master key, re-seal it under the new one, and rename the
file to the digest the new key produces. There is no script for this yet.

Until one exists, the supported rotation is destructive and honest: change the key,
delete `$INKCAST_PROJECTS/.keys/`, and tell users to paste their keys again. The
UI already distinguishes this case — a record that exists and will not open reports
`unreadable` ("paste it again"), not "not configured".

Envelope encryption is what makes the non-destructive version cheap when it is
written: 32 bytes to re-wrap per record, rather than decrypting every user's
credential.

---

## What happens to projects made before accounts were switched on

Nothing is migrated, and the reason is arithmetic: an anonymous project carries
`HMAC(owner-domain : <random cookie id>)` and the same person signed in carries
`HMAC(owner-domain : clerk:<user id>)`. The tags do not match and are not meant to.

So on a box that switches Clerk on, pre-existing projects:

- **leave `/library`**,
- **403 on** `DELETE`, `/edit`, `/rerender`, `/share`,
- **stay reachable through any share link already published** — `requireViewable`
  consults `shared`, not ownership.

Nothing is deleted and nothing is exposed.

**`inkcast.video` is unaffected**: it starts with an empty disk, so there is
nothing there to orphan. This only matters to a self-hoster who adds accounts to a
box that has been running.

The way out is written and tested but not exposed as a route. `cookieSession` in
`session.ts` returns the anonymous session a browser's cookie still proves — the
cookie lasts a year, so the old identity is still being presented on every request
— and its docstring carries the runnable claim flow, exercised end to end by the
test _"an account can claim what its browser already owned"_. `requireOwner` is the
authorization and `upsertProject({ ownerSession })` is the transfer, so it needs no
store change and no second notion of ownership. What is missing is only
`POST /api/projects/[id]/claim` and a button.

---

## Not finished — read this before launch

- **A per-account key is stored but not yet spent.** Every provider adapter reads
  `process.env` directly (~12 sites across `packages/pipeline`, `planner`, `voice`,
  `visuals`) and `CastOptions` has no credential field, so a render on the hosted
  box bills the **operator's** server keys regardless of what a user has saved.
  This is why `/settings` still shows an explanation instead of the BYOK panel on
  a hosted box: a form that accepts credentials it never uses is a credential sink,
  and the endpoint's own success message deliberately does not claim the next
  render will use the key. The fix is a `credentials` resolver threaded from the
  route through `cast()` into each stage adapter. It must **not** be done by
  injecting into `process.env`: that is process-global and two renders run
  concurrently, so user A's key would bill user B's job.
- **No real signed-in pass has been done.** The signed-out path, the refusal path,
  the proxy wiring and Clerk's sign-in widget mounting are all verified against a
  live Clerk dev instance. Creating an actual session needs the owner's Clerk
  credentials. Sign in once by hand and confirm: `/library` lists your films,
  `/studio` renders, a generation completes, and a second account cannot see the
  first's projects.
- **There is no sign-out control** unless `NEXT_PUBLIC_CLERK_ACCOUNT_URL` is set.
- **No claim route**, per the section above.
- **`GET /api/providers` still reports the pipeline's capability from
  `process.env`** — i.e. what the operator has configured — because that describes
  the film a visitor is about to get. It no longer reports the operator's masked
  key material, which it used to do on a public endpoint.
