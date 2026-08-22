# HANDOFF-LAUNCH — picking up inkcast.video from a clean session

Written 2026-08-22, at `750d6c1`, by the session that built the launch surface. Everything
below was verified by running it; where something is unproven it says so, and that
distinction is the most valuable thing in this file. The domain is bought
(`inkcast.video`), the app builds, authentication works, and **no user has ever signed in**.

## Read these first, in this order

1. **This file**, to the end of "The four things only a human can do".
2. `docs/AUTH.md` (311 lines) — the accounts/keys/secrets contract, and a
   fifteen-minute runbook for configuring the real domain. It is current.
3. `docs/KEYED-GATES.md` — every gate that costs money, what it buys, and what it costs.
   Read this **before** running anything with a live key.
4. `docs/DEPLOY.md` — the Docker/Caddy/fly runbook, including the honest note about which
   free tiers cannot host a Chromium + ffmpeg render at all.
5. `docs/PLAN-LAUNCH.md` — the original plan. **Three of its items are now known to be
   wrong**; see "Where the plan is wrong" below. Do not execute A1 or A4.3 as written.
6. `docs/HANDOFF.md` §"Known defects, ranked by what a viewer notices" — still the best
   list of what is wrong with the _video_, which is the part that has moved least.

## State of the tree, with the command that proves each claim

Two commits carry the launch work: `089d3e3` (the surface: quality, hardening, brand) and
`750d6c1` (accounts). The working tree is clean.

| claim                    | command                                                                      | result                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Types are sound          | `pnpm -r typecheck`                                                          | green, 9 projects                                                                                               |
| Tests pass               | `pnpm -r test`                                                               | **917 pass, 0 fail** (web 154, planner 209, visuals 232, render 92, pipeline 77, voice 71, keyvault 56, cli 23) |
| Formatting               | `pnpm lint`                                                                  | clean (it is `prettier --check .` and it gates `docs/*.md`, including this file)                                |
| Production build         | `cd apps/web && npx next build --webpack`                                    | green, with real `@clerk/nextjs` 7.8.0 installed                                                                |
| Pinned storyboards       | `npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude`        | `b6ed04d68aaa / 4aa467530110 / a9b5b8960ed0 / 882002cbf24c`                                                     |
| …and they are now a test | `cd packages/planner && node --import tsx --test test/pinned-hashes.test.ts` | 5 pass                                                                                                          |

**One pinned hash was deliberately re-pinned** and you should know why before you distrust
it: `longitude/short` moved `c0f2ccc5024c` → `882002cbf24c` because `text.ts`'s `DANGLING`
list grew the closed word-classes it had only half enumerated, and `between` was one of the
words it was missing. The entire storyboard delta is one string — a caption that used to
read `"Longitude is a difference between"` now reads `"Longitude is a difference"`. The
reasoning, and the diff that establishes it is one line and not geometry, is written into
the header of `packages/planner/test/pinned-hashes.test.ts`. Those four hashes had been
guarded by _prose only_ until this session; a comment in `compile.ts` and a line in
`STATUS.md`. They are now asserted on every `pnpm -r test`.

### What is verified about accounts

Both configurations were probed with a real browser against a production server:

| route                   | Clerk keys present                                           | Clerk keys blank                   |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------- |
| `/studio`               | sign-in wall, **no** create form                             | real studio, 2 textareas           |
| `/sign-in`              | Clerk's form mounts (`identifier`, `password`, Google OAuth) | **404 before the SDK is imported** |
| `/library`, `/settings` | gated                                                        | open                               |
| `/share/:id`            | 200                                                          | 200                                |
| page errors             | 0                                                            | 0                                  |

The self-hoster fallback is the load-bearing constraint and it holds: `app/(app)/access.ts`
decides admission from two env vars, and every Clerk import in the tree is a lazy
`await import()` behind that test. A clone with no Clerk account and no network gets the
anonymous-session studio unchanged, which is what `docs/CONTRACT.md` §1 requires.

The try-strip → sign-in → studio funnel was verified end to end: loading
`/studio?topic=explain+photosynthesis` signed out keeps the param in the URL, echoes the
sentence back on the wall, and puts
`redirect_url=%2Fstudio%3Ftopic%3Dexplain%2Bphotosynthesis` on both buttons.

## The four things only a human can do

Nothing below can be coded around, and the first is a launch blocker.

1. **Create a Clerk _production_ instance.** The keys in `apps/web/.env.local` are a
   **development** instance — `pk_test_`/`sk_test_`, and the publishable key base64-decodes
   to `comic-boxer-7189.clerk.accounts.dev`. A dev instance renders a "Development mode"
   badge (visible in the screenshot taken this session), keeps sessions on `accounts.dev`
   rather than your domain, and carries lower limits. Production needs `pk_live_`/`sk_live_`
   plus Clerk's CNAME records at Namecheap. Same env var names, so **no code change** —
   `docs/AUTH.md` §2 has the steps.
2. **Sign in once, and look.** `auth()` returned a null `userId` for every automated check
   in this session, so **the signed-in branch has never rendered**. Nobody has seen the
   account chip, the admitted studio, or a project owned by a real user id. This is the
   single largest untested surface in the product.
3. **Rename the Clerk application.** The sign-in form currently says "Sign in to **My
   Application**".
4. **Back up `INKCAST_SECRET_KEY`.** It envelope-encrypts every stored user API key. Lose
   it and every key becomes permanently undecryptable. It is in `apps/web/.env.local`
   (mode 600, gitignored via `.gitignore:33`).

## Outstanding engineering, in the order I would do it

### 1. Gate generation on a stored provider key — decided, specified, not built

The owner's decision: **users bring their own keys, and are never charged**. A user with no
key must not be able to generate. Right now there is **no gate at all** — `grep` for
`requireKey|hasProviderKey|missingKey` across `app/api/generate/route.ts` and
`app/(app)/access.ts` returns nothing.

What makes this urgent is _why_ it silently works today. `plannerProvider()`
(`packages/pipeline/src/providers.ts:37`) does not fail without a key; it returns
`{ name: 'heuristic', cloud: false, why: 'ANTHROPIC_API_KEY is unset' }`. So a keyless user
gets a complete video authored by the pre-LLM heuristic planner — free, and markedly worse.
The gate exists to protect the product's first impression, **not** to protect a bill.

Which keys are actually required — this was measured, not assumed:

- **`ANTHROPIC_API_KEY` — required.** It decides whether the lesson teaches.
- **`ELEVENLABS_API_KEY` — optional.** No key falls to Kokoro, which is local, free and
  genuinely decent; `voiceProvider()` at `providers.ts:66` does this already. Requiring it
  would cost users for no quality gain.
- **`REPLICATE_API_TOKEN` / `FAL_KEY` — optional.** Without them figure rasters are skipped
  and the drawing lanes still compose marks locally.

So: block generation unless the account has an Anthropic key, and make `/settings` state
per provider exactly what each key unlocks and what happens without it. Server-side
enforcement belongs in `app/api/generate/route.ts` (a 4xx with copy that names the missing
key), and the UI belongs in `components/studio/create-form.tsx` plus the settings panel.
Enforce on the **server** as well as the UI — `app/api/_lib/http.ts` documents at length the
last time this repo hid a panel and left the door open (`/settings` stopped rendering the
BYOK panel under `INKCAST_HOSTED=1` while `/api/keys` stayed live and unguarded).

### 2. Re-key the rate limiter per user, not per IP

`app/api/_lib/ratelimit.ts:454` still buckets on `clientKey(headers)`. That was written when
generations spent _your_ money; under BYOK they spend the user's, so the only thing left to
protect is **render capacity** — Chromium + ffmpeg gate at 2 concurrent
(`apps/web/lib/jobs.ts`, `CLASS_LIMIT { lesson: 4, voice: 4, render: 2 }`). Per-IP now
punishes several users behind one office NAT and does nothing useful. Bucket on the owner
digest for signed-in requests, keep per-IP only for the unauthenticated surface, and rewrite
the comment so the _reason_ is capacity rather than cost. The existing tests are good — keep
the spoofed-`x-forwarded-for` case passing.

### 3. The spend ledger is not wired

`docs/KEYED-GATES.md` Gate 6 says so plainly. `packages/pipeline/src/spend.ts` exists and is
tested, but nothing calls it. Under BYOK this is lower stakes than it was — decide whether
it is still worth wiring, or delete it and say why. Do not leave a tested module that nothing
calls; that is the exact shape of the A6 failure described below.

### 4. The `math` mark is unreachable

`docs/KEYED-GATES.md` Gate 3a. The TeX typesetting path exists
(`packages/visuals/src/equation.ts`) and a mark kind was added, but the lesson author is
never _told_ it can ask for maths, so it never appears. Closing it needs brief text plus a
`STAGE_CODE_VERSION` bump in `packages/pipeline/src/keys.ts`. This is the biggest capability
gap against Golpo — `docs/HANDOFF.md` defect 4 calls it "the one thing Golpo is best at and
we cannot do at all".

### 5. Two visible cosmetic defects on the landing page

- **The hero `ink-demo` board is clipped on its left edge** — it renders `radient descent`,
  the `g` cut off, in both themes. The camera transform is `ink-demo.tsx:74`:
  `translate(VIEW.w/2 - x*zoom, VIEW.h/2 - y*zoom) scale(zoom)`. The title's clip box is
  `{ x: 78, y: 86, w: 470, h: 78 }`, and centring on it pushes content past the frame's left
  edge. This is the centrepiece of the page.
- **The three format-row cards have uneven tops**, because each preview has a different
  aspect and the grid aligns to content.
- Related: `preview.gif` assets do not exist, so the format cards render hand-drawn SVG
  placeholders from `components/marketing/board-sketch.tsx`. That is a deliberate graceful
  fallback, not a bug, but they are placeholders and it should be a conscious decision to
  launch with them.

### 6. The brand plate is wired but has never been seen

A6 _was_ dead code and is now wired: `packages/render/src/compile.ts:63` imports
`BRAND_MARK` and lines 794–797 draw the cast stroke and the nib. Nobody has looked at a
frame containing it. Verify cheaply, with no spend:

```sh
cp -R projects/cardiac8f /tmp/scratch/projects/
ANTHROPIC_API_KEY=disabled-no-spend ELEVENLABS_API_KEY=disabled-no-spend \
FAL_KEY=disabled-no-spend REPLICATE_API_TOKEN=disabled-no-spend \
  INKCAST_PROJECTS=/tmp/scratch/projects node apps/cli/bin/inkcast.mjs rerender cardiac8f
npx tsx packages/render/src/frames.mts /tmp/scratch/projects/cardiac8f /tmp/scratch/frames 90 175.5
# then actually open the PNGs
```

### 7. The video is still the weak part, and the plan's density items are wrong

This is where the product is furthest from where it wants to be, and it needs a funded key.
Measured on `projects/cardiac8f`: **mean ink 5.7%** against a ≥12% target, **3–4 hues**
against ≥4, **24% mean content fill**, 176s runtime against a 60–90s target. A frame from
the outro shows the real problem, and it is not framing: text collides with pictures
repeatedly (`"spark starts here"` written across the anatomy, `"3 AV node (slow doorway)"`
on top of the drawn heart, `"non-conducting ring"` over hatching), and whole thirds of the
canvas are empty paper.

**The single most valuable unproven thing in the repo** is the `explainer` preset. It exists
(`packages/planner/src/presets.ts`, 16:9, `maxBeats: 8`, ~165 words, `maxHold`,
`board: 'wipe'`), the hosted path enforces it (`hostedFormat()` is imported at
`app/api/generate/route.ts:50` and spread into the cast input), and **it has never authored a
lesson**, because that needs a funded Anthropic key. Its gate — words ≤ 190, silence ≤ 8% of
runtime, runtime 60–100s — is Gate 1 in `docs/KEYED-GATES.md`. Run it first; it is the whole
script-economy thesis.

## Where the plan is wrong

`docs/PLAN-LAUNCH.md` was written before anything was measured. Three of its items are now
known to be unachievable as specified. Do not spend a day rediscovering this.

- **A1's gate cannot pass.** "Mean ink strictly above the 5.7% baseline" — the figure-box fix
  moves mean ink by _less than reporting precision_ (5.7% → 5.7%) and _costs a hue_ (4 → 3).
  Enlarging a mostly-white raster buys nothing on `inkstat`, because its thresholds
  (`DARK_ENOUGH=225`, `SATURATED_ENOUGH=30`, `inkstat.mts:35-36`) do not count a pale card as
  ink. **The real density lever is killing the pale white card behind each generated figure**,
  which enlarging made _more_ visible.
- **A4.3's 55% minimum-fill clamp is arithmetically impossible.** Fill is the product of how
  much frame the camera holds (capped by the 76.5% safe area, which is a broadcast margin,
  not slack) and how much of that rect the ink covers (measured 30–76%). 55% needs coverage
  above 72% and the corpus never reaches it; the honest ceiling is 34.2%, which is what
  `wipe` already delivers. The long derivation is in the header of
  `packages/core/src/camera.ts`. What the measurement _did_ buy is a real bug fix:
  `contentFill` counted ink that was off-screen, so a walked shot scored **100% at the exact
  moment it showed least of the board**.
- **A5's "no free tier" assumption inverted.** The owner has since decided BYOK is mandatory
  and users are never charged, so there is no server-funded inference and no open-weight/GPU
  tier to build. Ignore the plan's spend-guardrail framing.

## Traps that have already cost this project time

Every one of these has been paid for at least once. The first two are the expensive ones.

- **A tested module that nothing calls is not shipped.** A6 landed as 283 lines in
  `packages/render/src/sketch.ts` — written titles, title underline, brand plate — with
  passing tests and **zero call sites outside its own file**. It typechecked, its tests were
  green, and a rendered outro frame contained no plate. `packages/render/src/compile.ts` is
  what turns elements into geometry; if your work is not imported there, it does not run.
  Before claiming any render feature works, `grep` for a call site outside its own module.
- **API keys are live on this machine and inject themselves.** `inkcast keys` reports
  anthropic, elevenlabs and fal keys in the macOS keychain, and `hydrateKeys()`
  (`packages/keyvault/src/hydrate.ts:57`) silently copies them into `process.env` for every
  CLI command except `keys`/`help`/`list`. Pointing `INKCAST_HOME` at an empty dir does
  **not** isolate them. Before any pipeline command, set the provider vars to invalid
  **non-empty** strings — `hydrate.ts:77-82` treats a present value as authoritative:
  `ANTHROPIC_API_KEY=disabled-no-spend ELEVENLABS_API_KEY=disabled-no-spend FAL_KEY=disabled-no-spend REPLICATE_API_TOKEN=disabled-no-spend`
- **Brief edits do nothing until `STAGE_CODE_VERSION` is bumped** in
  `packages/pipeline/src/keys.ts`. `lesson` is at 12. An unbumped brief edit is a silent
  no-op and has wasted a whole keyed run before.
- **Two ink engines.** `packages/render/src/sketch.ts` draws
  `path/shape/arrow/diagram/emphasis/text` at render time; the visuals stage's roughjs SVGs
  for those types are written and never read. A visual fix in those lanes must land in
  `sketch.ts`.
- **`fillcheck.mts` is not trusted** (reports ~4× real density). Use `inkstat.mts`, and note
  it takes a **video file**, not a project dir. None of the `.mts` gates are wired into a
  `package.json` script — run them from the repo root with `npx tsx <path>`.
- **`scripts/screens.mjs` defaults to production mode; run it that way.** It was once run
  with `SCREENS_MODE=dev`, and a dev server where React never hydrated produced a set of
  screenshots showing a **completely blank landing page** plus a `setAttribute` TypeError on
  every route. Both were artifacts. In production all 39 `Reveal` wrappers fire and there are
  zero page errors. If you ever see a blank marketing page, check `report.json`'s `mode`
  before believing it.
- **`next dev` refuses a second server in the same directory.** If a dev server is already
  running you will get "Another next dev server is already running" and your port will
  silently not be used.
- **Do not run two `pnpm` installs at once.** Installing `@clerk/nextjs` took ~10 minutes;
  a concurrent install fights over the lockfile and store.
- **`middleware.ts` is `proxy.ts` here.** Next 16 renamed it. The matcher must keep
  `'/__clerk/:path*'` after `'/(api|trpc)(.*)'` — Clerk's handshake traffic has to reach
  `clerkMiddleware()` or sessions fail to establish _silently_, with every individual piece
  looking correctly configured.
- **`app/share/[id]/page.tsx:43` server-fetches its own `GET /api/projects/:id` without
  forwarding the cookie.** It works today because `proxy.ts` is a pass-through rather than a
  path matcher. If you ever protect `/api/**` broadly, every share link will render
  `notFound()`.
- **The machine sleeping kills long agent runs.** Ten parallel agents were lost to
  `API Error: Your computer went to sleep mid-response`. `caffeinate -dimsu -t 14400 &`
  before any long run.

## Commands you will want

```sh
# The full gate, all offline, all free
pnpm -r typecheck && pnpm -r test && pnpm lint
cd apps/web && npx next build --webpack

# Run the real thing (production, not dev — dev hydration has bitten us)
cd apps/web && npx next start --port 3000     # reads apps/web/.env.local

# Pinned storyboards
npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude

# Density / sync / lanes on a rendered project
npx tsx packages/render/src/inkstat.mts projects/cardiac8f/out.mp4
npx tsx packages/pipeline/src/synccheck.mts projects/cardiac8f
npx tsx packages/planner/src/lanecheck.mts projects/cardiac8f

# Screenshots of every route in both themes (production mode is the default — keep it)
node scripts/screens.mjs

# Health of a running box
curl -s localhost:3000/api/health
```

Three ready projects exist for clicking through: `f70a4904eb30` (gradient descent, 131s),
`1d80720ea373` (lithium-ion battery, 110s), `d8347cbd20b5` (a 36s smoke test).

## The honest summary

The **platform** is in good shape: accounts work in both configurations, ownership is
enforced at one chokepoint with a keyed digest on disk, user API keys are envelope-encrypted
with the owner bound into the AEAD, the index race is gone, renders admit through a semaphore
with a live queue position, and there is a Docker image, a Caddyfile, a load-test script and a
disk janitor. 917 tests pass.

The **video** is the weak part, and it is where the next real day of work belongs. It is 176
seconds long when it should be 75, it is 5.7% ink when it should be 12%, and its labels
collide with its pictures. The `explainer` preset was built to fix the first of those and has
never run. That, and killing the pale card behind the figures, is the work that changes
whether anyone watches to the end.
