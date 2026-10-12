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
| `/settings`            | The local BYOK panel                              | Per-account BYOK panel                         |
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

## Per-account API keys and video choices

`/settings` accepts Fireworks and ElevenLabs keys, with Anthropic and image providers
available as additional choices. `/studio` selects planning, narration and illustrations
independently. A Fireworks lesson can use ElevenLabs speech, including the River voice
and the existing Multilingual v2 delivery defaults. Users can explicitly choose local
planning, Kokoro speech and built-in artwork without any paid provider credentials.

**Account storage is selected when `INKCAST_HOSTED=1` OR either Clerk variable is
present.** A partial Clerk configuration refuses credential access with 503. It never
opens the operator's keychain. Account storage requires `INKCAST_SECRET_KEY` even on a
Clerk-enabled development server with hosted mode off. Local key management is available
only via a loopback hostname when neither hosted mode nor Clerk is enabled.

Account keys live in `$INKCAST_PROJECTS/.keys/`, or `INKCAST_SECRETS_DIR`. Filenames
are keyed digests of owner tags. The directory is `0700`, files `0600`; replacement
writes are atomic and serialized per account in the single server process. A random
32-byte data key encrypts each credential with AES-256-GCM; a key derived from
`INKCAST_SECRET_KEY` wraps that data key. Both layers authenticate the caller's owner
and provider. New v2 records also authenticate the mask, length and creation/update
timestamps. Existing v1 records remain readable and become v2 when replaced.

Only masked status is returned. Status checks verify decryptability, then discard the
plaintext. Corrupt files fail closed instead of looking empty or being overwritten.
A late validation response cannot mark a newly replaced key as checked. A metadata
check confirms that request only: it cannot guarantee model access, credits or synthesis
permissions. Rate limits and missing metadata permissions produce an unknown result,
not a claim that a key works. ElevenLabs metadata checks need User read permission;
speech and voice lookup need their respective permissions.

The server must decrypt a key to call its provider. Anyone with the server's encryption
secret and stored records can also decrypt it; encryption is not protection from the
server operator. Keep encryption secrets in runtime secret management, out of Git, build
arguments, images and logs. Back up the secrets directory and encryption secret separately.

### Job isolation

`apps/web/lib/keys.ts` resolves the owner's selected credentials at job admission.
`withProviderEnv()` in core carries an immutable snapshot through `AsyncLocalStorage`.
Planner, drawing, voice, image and review adapters read that snapshot. No web route
hydrates `process.env`; account jobs never fall back to operator environment keys or the
operator's keychain. Non-secret model/delivery configuration is explicitly allow-listed.
The CLI retains its environment and local-vault behavior.

Only public provider choices are saved in project metadata. Edits and rerenders reuse
those choices with the current owner's current keys. Missing or unreadable selected keys
produce an actionable failure. Deleting a key prevents queued jobs from loading it; a
job already running may finish with the credential it loaded. Revoke at the provider to
stop all use. Saving a replacement does not mutate credentials in a running job.

Exact credential redaction is scoped to the request/job, including encoded forms, logs,
progress and failure messages. Customer keys are not retained in the global redaction
registry, included in command arguments, or copied into project metadata.

Generated drawing and illustration caches for account jobs are stored beneath
`INKCAST_PROJECTS/.account-cache/<owner-tag>/`, separate from other accounts and
from the local machine cache. Model weights and built-in assets remain shared.

### Request and project boundaries

Local mode is for a single-user server bound to loopback. Hostname checks are
defense in depth, not network authentication; use account mode for shared servers.

Browser mutations require a matching Origin or same-origin Fetch Metadata. API clients
without Origin must send `X-Inkcast-Request: 1`. Cross-site and same-site-but-cross-origin
requests are refused before credential reads or work. Behind a proxy, set
`INKCAST_PUBLIC_URL` to the browser's canonical origin; forwarded Host values are not
trusted. Credential bodies must be JSON and are streamed with a 16 KiB cap.

Project identifiers derived from source now include the owner and provider choices.
Explicit IDs have an atomic ownership check before uploads or job registration. Clerk
installations cannot adopt unowned CLI projects merely by turning hosted mode off.
Shared video links expose playback media, not raw uploads, private metadata, caches or
diagnostics. Existing ownership checks still protect edits, rerenders, deletion, job
status and progress streams.

Account deployments reject server `filePath` sources. URL ingestion checks all DNS
answers and pins a public address to the socket; redirects are independently checked,
with a timeout, redirect limit and 8 MiB body cap. Private, loopback and metadata addresses
are refused. Local CLI ingestion retains its existing behavior.

### Rotation and operating limits

Keep `INKCAST_SESSION_SECRET` stable: changing it changes owner tags. Keep
`INKCAST_SECRET_KEY` stable: changing it changes both ciphertext wrapping and filenames.
There is no in-place rotation tool. A supported destructive reset is to back up the old
state, change the secret and ask users to save their provider keys again. A missing old
filename appears unconfigured; a record whose ciphertext cannot open appears unreadable.
Never describe a master-key change as an automatic migration.

This filesystem store and in-memory job queue target one Next server process per projects
volume. Multiple writers or replicas require a shared transactional store and scheduler.
The `.keys` directory remains outside project discovery, media routing and the janitor.

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

- **No real signed-in pass has been done.** The signed-out path, the refusal path,
  the proxy wiring and Clerk's sign-in widget mounting are all verified against a
  live Clerk dev instance. Creating an actual session needs the owner's Clerk
  credentials. Sign in once by hand and confirm: `/library` lists your films,
  `/studio` renders, a generation completes, and a second account cannot see the
  first's projects.
- **There is no sign-out control** unless `NEXT_PUBLIC_CLERK_ACCOUNT_URL` is set.
- **No claim route**, per the section above.
- **Authenticated Clerk browser acceptance remains with the separate login work.**
  BYOK tests use synthetic identities, two independent browser cookie accounts, and
  intercepted provider responses; they do not certify a real Clerk sign-in or paid video.
