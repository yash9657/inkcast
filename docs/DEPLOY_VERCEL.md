# Deploying Inkcast on Vercel

Inkcast on Vercel is **two Vercel projects in one team, one Blob store, no other
paid service**:

| Project          | Root directory  | What it is                                                                      |
| ---------------- | --------------- | ------------------------------------------------------------------------------- |
| `inkcast`        | `apps/web`      | The studio: Next.js on ordinary Node Functions. Never runs Chromium or a model. |
| `inkcast-render` | `.` (repo root) | The renderer: `Dockerfile.vercel`, a container that makes one film per request. |
| Blob store       | —               | Project records, progress, and finished films. Connected to both projects.      |

`docs/DEPLOY.md` (Docker / Fly / a VM) still describes the single-box deployment and
is unchanged. Everything here is behind `INKCAST_STORAGE=blob`; without it the
studio, the CLI and Docker behave exactly as before.

---

## How it works

```
browser ──POST /api/generate──▶ inkcast (Function)
   │                              │ 1. meta.json + job.json(queued) ─────────────▶ Blob
   │◀── 202 {projectId} ──────────┤
   │                              │ 2. after(): POST /run ──▶ inkcast-render (container, 4 GB)
   │                              │      held open ≤ 800 s     │ lesson → voice → visuals →
   │                              │                            │ Chromium capture → ffmpeg
   │                              │                            ├─ job.json (progress, 5 s) ─▶ Blob
   │                              │                            └─ out.mp4 + 3 small files ─▶ Blob
   │                              │ 3. final meta.json ───────────────────────────────▶ Blob
   │
   ├──GET /api/generate/<id>/stream──▶ inkcast (Function): polls job.json every 2 s,
   │                                    emits the same SSE events as the local registry
   └──GET /api/media/<id>/out.mp4────▶ inkcast (Function): owner/share check, then
                                        streams the blob (Range forwarded)
```

Why this shape:

- **Chromium and ffmpeg need a container.** A render is headless Chromium plus
  ffmpeg plus two ONNX models; the native payload is far past what a Function
  bundle should carry, and the system libraries are not in the Function runtime.
  `Dockerfile.vercel` is exactly the "custom system libraries" case Vercel's
  container runtime exists for.
- **A container lives as long as its request.** It scales to zero and is stateless,
  so the studio holds the `/run` request open for the whole film rather than
  firing and forgetting (which could let the platform freeze the instance
  mid-render). The studio does that in `after()` on `POST /api/generate`, whose
  `maxDuration` is 800 s; it costs Function memory-time, not CPU, while it waits.
- **Progress through Blob, not memory.** The request that starts a film, the
  request that streams its progress and the container that renders it are three
  different instances. The renderer writes `job.json`; the stream route polls it.
  The browser receives the same SSE events as from the in-process registry, so no
  client code changed.
- **One film per container instance.** The render service answers `503` if it is
  already rendering; the studio retries for up to three minutes, by which time
  Fluid compute has given it another instance. Two capture workers
  (`INKCAST_RENDER_WORKERS=2`, baked into the image) keep a 1080p render well
  inside 4 GB.
- **Lean storage.** Per film: `out.mp4` (the bulk), `thumbnail.png`,
  `storyboard.json`, `captions.vtt`, `meta.json`, `job.json`. Frames, per-scene
  audio and stage caches stay in the container's `/tmp` and are deleted after
  every run.
- **No Workflow, no chunking.** A typical studio film (the hosted `explainer`
  preset: ≤ 75 s, ≤ 8 beats) renders comfortably inside 800 s on a Performance
  instance — see [Measured](#measured). A single held request is the simplest
  thing that works, so that is what this is.

### Every API route, and where it runs

All studio routes are ordinary Node.js Functions (Fluid compute, Standard size).

| Route                                | On Vercel                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `POST /api/generate`                 | Function, `maxDuration = 800`. Writes records to Blob, dispatches to the render service.       |
| `GET /api/generate/[id]`             | Function. Reads `job.json`.                                                                    |
| `GET /api/generate/[id]/stream`      | Function, streams SSE for ≤ 270 s then closes; `EventSource` reconnects and is replayed.       |
| `GET/HEAD /api/media/[id]/[...path]` | Function. Streams the blob (no 4.5 MB cap on streamed responses); refuses `meta`/`job.json`.   |
| `GET /api/projects`                  | Function. Lists `meta.json` blobs, reconciling in-flight ones against `job.json`.              |
| `GET/DELETE /api/projects/[id]`      | Function. Delete removes every blob under the project.                                         |
| `POST /api/projects/[id]/share`      | Function. Same as local.                                                                       |
| `POST /api/projects/[id]/edit`       | **501** — needs the intermediate files a Blob deployment does not keep.                        |
| `POST /api/projects/[id]/rerender`   | **501** — same reason.                                                                         |
| `GET /api/providers`                 | Function. Reports providers from **this project's** env — see the env note below.              |
| `GET /api/keys`, `POST .../validate` | Function. Same as hosted.                                                                      |
| `POST/DELETE /api/keys`              | Function. With accounts on, sealed per-account keys are stored in Blob. Without accounts: 501. |
| `GET /api/health`                    | Function. Reports configuration (Blob + render service), not disk.                             |
| pages, `/share/[id]`, `proxy.ts`     | Function / Routing Middleware, unchanged.                                                      |

---

## 1. Blob store (2 min)

Vercel dashboard → **Storage** → **Create** → **Blob**. Name it `inkcast-films`,
access **Private**, region next to the projects' Function region (default `iad1`).
Then **Connect Project** → `inkcast` (Production + Preview) and again →
`inkcast-render` (Production + Preview). Connecting sets `BLOB_READ_WRITE_TOKEN`
on each project.

If the store was created **public**, set `INKCAST_BLOB_ACCESS=public` on both
projects. Films are still served only through `/api/media` (with its ownership
check), but anyone holding a raw blob URL could fetch it, so private is
recommended.

Previews and production can share the store: set `INKCAST_BLOB_PREFIX=preview` on
the `inkcast` project's **Preview** environment so preview films land under
`preview/…`. The render service takes the prefix from each request, so it needs no
prefix setting of its own.

Storage cost is roughly the MP4: 4.3 MB for the 74-second 1080p film measured
below (expect 4–15 MB). Nothing deletes old films automatically; see
[Limitations](#limitations).

## 2. Render project: `inkcast-render`

Create it from the same Git repository (`yash9657/inkcast`).

| Setting                             | Value                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Root Directory                      | `.` (repository root — where `Dockerfile.vercel` is)                                        |
| Framework Preset                    | **Other**                                                                                   |
| Build / Install / Output command    | leave empty (the image is built from `Dockerfile.vercel`) — see note below                  |
| Production Branch                   | `main` (same as the studio, so the two deploy together)                                     |
| Settings → Functions → Fluid        | on (default)                                                                                |
| Settings → Functions → Function CPU | **Performance (4 GB / 2 vCPU)**                                                             |
| Settings → Functions → Max Duration | **800**                                                                                     |
| Port                                | 80 (the image listens on `$PORT`, default 80; do not set `PORT` unless you change that)     |
| Deployment Protection               | Standard is fine if `INKCAST_RENDER_URL` is a production domain; otherwise see bypass below |

> Vercel detects `Dockerfile.vercel` and routes every request to the image. If a
> deployment log shows Vercel also attempting a Node build of the root
> `package.json`, override **Install Command** and **Build Command** with
> `echo skip`; the image build does not use them.

The image (`Dockerfile.vercel`) installs only the render service and the packages
it imports, Playwright's Chromium, ffmpeg, and the Kokoro + Whisper weights,
and checks at build time that Chromium launches and the ONNX runtime loads.

Production URL: either the project's `inkcast-render.vercel.app` or a custom
domain such as `render.inkcast.video`. That URL is the studio's
`INKCAST_RENDER_URL`.

**Deployment Protection.** If the URL you use is protected (any preview URL, or
"All Deployments" protection), create **Settings → Deployment Protection →
Protection Bypass for Automation** on `inkcast-render` and put the secret in the
studio's `INKCAST_RENDER_BYPASS_TOKEN`. The studio sends it as
`x-vercel-protection-bypass`. `/run` is additionally bearer-authenticated, so the
endpoint is never open even when protection is off.

## 3. Studio project: `inkcast` (already exists)

| Setting                             | Value                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Root Directory                      | `apps/web` (as now)                                                          |
| Include files outside root dir      | **on** (default for monorepos; the workspace packages live in `packages/`)   |
| Framework Preset                    | Next.js                                                                      |
| Install Command                     | default (`pnpm install`, detected from the root `pnpm-lock.yaml`)            |
| Build Command                       | default (`pnpm run build` → `next build --webpack`; do not drop `--webpack`) |
| Output Directory                    | default                                                                      |
| Node.js Version                     | 22.x (24.x also fine)                                                        |
| Settings → Functions → Function CPU | Standard (2 GB / 1 vCPU) — nothing heavy runs here                           |
| Settings → Functions → Max Duration | leave default; `POST /api/generate` sets `maxDuration = 800` in code         |
| Domains                             | `inkcast.video` (already attached)                                           |

Why the build works from the monorepo: the workspace packages ship TypeScript
source, and `next.config.ts` already lists all of them in `transpilePackages` and
maps `.js` imports to `.ts` via webpack's `extensionAlias` (hence `--webpack`).
With `INKCAST_STORAGE=blob` set **at build time**, `next.config.ts` also excludes
onnxruntime, Playwright, sharp, Kokoro and friends from every Function's file
trace, because no studio route runs a stage there; without the exclusion every
API route traces ~195 MB.

`ENABLE_EXPERIMENTAL_COREPACK=1` makes Vercel use exactly the `pnpm@10.33.0` pinned
in the root `package.json`.

## 4. Environment variables

"Secret" = mark as Sensitive in Vercel. Variables needed by both projects are
easiest as **team-level Shared Environment Variables** linked to both.

### `inkcast` (studio)

| Variable                                                                                                                                       | Req.        | Secret | Value / note                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INKCAST_STORAGE`                                                                                                                              | required    | no     | `blob` — **must be present at build time too** (trace exclusions)                                                                                                                                                       |
| `BLOB_READ_WRITE_TOKEN`                                                                                                                        | required    | yes    | set by connecting the Blob store                                                                                                                                                                                        |
| `INKCAST_RENDER_URL`                                                                                                                           | required    | no     | `https://inkcast-render.vercel.app` (or `https://render.inkcast.video`)                                                                                                                                                 |
| `INKCAST_RENDER_TOKEN`                                                                                                                         | required    | yes    | `openssl rand -hex 32`; same value on `inkcast-render`                                                                                                                                                                  |
| `INKCAST_HOSTED`                                                                                                                               | required    | no     | `1` — per-IP limiter, 20k-char source cap, `explainer` preset only, and **per-account keys** (see below)                                                                                                                |
| `INKCAST_SESSION_SECRET`                                                                                                                       | required    | yes    | `openssl rand -hex 32` (≥ 24 chars). Changing it orphans every film's ownership                                                                                                                                         |
| `INKCAST_SECRET_KEY`                                                                                                                           | required    | yes    | `openssl rand -hex 32`. Master key sealing every account's provider keys. Losing it makes stored keys unreadable                                                                                                        |
| `ENABLE_EXPERIMENTAL_COREPACK`                                                                                                                 | recommended | no     | `1`                                                                                                                                                                                                                     |
| `NEXT_PUBLIC_INKCAST_BASE_URL`                                                                                                                 | recommended | no     | `https://inkcast.video` (absolute Open Graph / share URLs). Build-time                                                                                                                                                  |
| `INKCAST_PUBLIC_URL`                                                                                                                           | recommended | no     | `https://inkcast.video`. The request guard on mutating routes checks `Origin` against it; unset, it compares with the request's own origin (fine on one domain, but set it if you also serve `www.` or a preview alias) |
| `INKCAST_BLOB_PREFIX`                                                                                                                          | optional    | no     | default `inkcast`; set `preview` on the Preview environment                                                                                                                                                             |
| `INKCAST_BLOB_ACCESS`                                                                                                                          | optional    | no     | `private` (default) or `public` — must match the store                                                                                                                                                                  |
| `INKCAST_RENDER_BYPASS_TOKEN`                                                                                                                  | optional    | yes    | only if `INKCAST_RENDER_URL` is behind Deployment Protection                                                                                                                                                            |
| `CLERK_SECRET_KEY`                                                                                                                             | optional    | yes    | accounts; set both Clerk keys or neither                                                                                                                                                                                |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                                                                                            | optional    | no     | accounts; build-time (the landing copy is prerendered from it)                                                                                                                                                          |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`                                                                                                                | optional    | no     | `/sign-in` (default)                                                                                                                                                                                                    |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`                                                                                                                | optional    | no     | `/sign-up` (default)                                                                                                                                                                                                    |
| `NEXT_PUBLIC_CLERK_ACCOUNT_URL`                                                                                                                | optional    | no     | `https://accounts.inkcast.video/user` — the only sign-out path                                                                                                                                                          |
| `INKCAST_BYPASS_TOKEN`                                                                                                                         | optional    | yes    | team escape hatch past the per-IP limit (`X-Inkcast-Bypass` header)                                                                                                                                                     |
| `FIREWORKS_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `FAL_KEY`, `REPLICATE_API_TOKEN`                                               | optional    | yes    | **Operator keys — used only when accounts are off** (no `INKCAST_HOSTED`, no Clerk). With accounts on, they are ignored by design: every film runs on the signed-in account's own keys or the local providers.          |
| `INKCAST_FIREWORKS_MODEL`, `INKCAST_FIREWORKS_REASONING`, `ELEVENLABS_MODEL_ID`, `INKCAST_VOICE_*`, `INKCAST_DRAW_FIX`, `INKCAST_FIGURE_MODEL` | optional    | no     | model/delivery settings; forwarded to the render service with each film                                                                                                                                                 |
| `INKCAST_LOG`                                                                                                                                  | optional    | no     | `info`                                                                                                                                                                                                                  |

Do **not** set `INKCAST_PROJECTS` here (it defaults to a `/tmp` scratch directory in
Blob mode) and do not set `INKCAST_TRUSTED_PROXY_HOPS` (the default `1` matches
Vercel's `X-Forwarded-For`).

### `inkcast-render` (render service)

| Variable                 | Req.     | Secret | Value / note                                                                                       |
| ------------------------ | -------- | ------ | -------------------------------------------------------------------------------------------------- |
| `INKCAST_RENDER_TOKEN`   | required | yes    | same value as the studio. Unset ⇒ `/run` answers 503                                               |
| `BLOB_READ_WRITE_TOKEN`  | required | yes    | set by connecting the Blob store                                                                   |
| `INKCAST_BLOB_ACCESS`    | optional | no     | must match the studio                                                                              |
| `INKCAST_RENDER_WORKERS` | optional | no     | `2` (baked default). `1` halves capture parallelism for more headroom; `3`+ is not advised on 4 GB |
| `INKCAST_LOG`            | optional | no     | `info` (baked default)                                                                             |

**No provider keys belong on the render project.** The studio resolves the
credential environment for every film (the account's keys, or the operator's when
accounts are off) and sends it with the `/run` request; the render service runs the
pipeline inside exactly that snapshot (`withProviderEnv`), strips any provider key
from its own environment first, and never writes it to Blob or logs.

Baked into the image and not to be overridden: `INKCAST_STORAGE=blob`,
`INKCAST_PROJECTS=/tmp/inkcast/projects`, `INKCAST_HOME=/tmp/inkcast/state`,
`INKCAST_MODEL_CACHE=/app/.models`, `INKCAST_OFFLINE=1`,
`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`.

### Which third-party keys a working demo needs

**None.** With no provider keys the pipeline runs the local planner, the Kokoro
voice and the built-in figure library, offline, and produces a real film (this is
what the [local measurement](#measured) used). That is also what a signed-in
account with no saved keys gets by default. Keys are quality upgrades, chosen per
film in the studio's provider controls:

- `FIREWORKS_API_KEY` (now the preferred planner) or `ANTHROPIC_API_KEY` — the one
  that matters most: the cloud lesson author, drawings and visual review.
- `ELEVENLABS_API_KEY` — nicer voice; Kokoro is acceptable.
- `FAL_KEY` / `REPLICATE_API_TOKEN` — bespoke illustrations; least important.

Clerk is optional too: without it the site uses signed anonymous cookies, and
`/sign-in` / `/sign-up` 404.

### Keys and `packages/keyvault`

Two models, decided by `accountKeys()` (`INKCAST_HOSTED=1` or Clerk configured):

- **Accounts on (the public deployment).** Each account saves its own keys in
  Settings. `apps/web/app/api/_lib/secrets.ts` seals them (AES-256-GCM envelope
  under `INKCAST_SECRET_KEY`, bound to the owner) and, with `INKCAST_STORAGE=blob`,
  stores the sealed document at `<prefix>/account-keys/<digest>.json` in the
  private Blob store instead of on disk — the Function filesystem would lose it.
  Operator keys in the environment are never used for an account's film.
- **Accounts off.** `@inkcast/keyvault`'s keychain / `~/.inkcast/vault.json` has no
  durable home on a Function, so `POST`/`DELETE /api/keys` answer 501 and the
  operator's keys come from the studio project's environment.

In both cases the studio resolves the provider environment per film and forwards
it to the render service with the request (see the render project section).

## 5. Clerk for inkcast.video (optional)

See `docs/AUTH.md` for the identity model; the Vercel-specific steps:

1. Clerk dashboard → create (or open) the application → **switch to a Production
   instance**, domain **`inkcast.video`**.
2. **Domains**: add the DNS records Clerk lists (CNAMEs for `clerk.inkcast.video`
   — the Frontend API — and `accounts.inkcast.video`, plus the email/DKIM
   records) in the DNS for `inkcast.video` (Vercel → Domains → `inkcast.video` →
   DNS Records if Vercel hosts the DNS). Wait for Clerk to verify them.
3. **Paths**: sign-in URL `/sign-in`, sign-up URL `/sign-up` (the app serves both
   pages itself); after sign-in/up redirect `/studio`.
4. Allowed origins: Clerk production instances accept only their own domain;
   `https://inkcast.video` is implied by step 1. If you also serve
   `www.inkcast.video`, add it (or redirect it to the apex in Vercel → Domains).
5. Copy `pk_live_…` → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `sk_live_…` →
   `CLERK_SECRET_KEY` on the `inkcast` project, **Production** environment, then
   redeploy (the publishable key is read at build time).
6. Previews: a production Clerk instance will not run on `*.vercel.app`. Either
   leave both Clerk variables unset for **Preview** (previews then use anonymous
   cookies), or put a **Development** instance's `pk_test_…`/`sk_test_…` there.
7. Optional: `NEXT_PUBLIC_CLERK_ACCOUNT_URL=https://accounts.inkcast.video/user`
   (the only way to sign out — see `docs/AUTH.md`).

## 6. Verify after deploying

```sh
curl -s https://inkcast-render.vercel.app/health          # {"ok":true,"service":"inkcast-render","busy":false}
curl -s https://inkcast.video/api/health                   # "storage":"blob", both "configured":true
```

Then make a film from `/studio` and watch the stage list advance. The first film
after an idle period waits a few seconds for a cold render instance.

## Measured

One film, driven end to end through the studio's own `POST /api/generate` → render
service → Blob → SSE → `/api/media`, with Blob replaced by a local emulator. Source
`examples/photosynthesis.md`, no provider keys (heuristic planner, Kokoro voice,
built-in figures), hosted `explainer` preset. The container was limited to
`--cpus 2 --memory 4g` (the Performance size) and ran under OrbStack on an
Apple-silicon Mac that was heavily loaded by unrelated work at the time (load
average 12–20), so treat the times as pessimistic for that hardware.

| Image built from `Dockerfile.vercel` | Film                            | Wall clock (request → done) | Stages                                           | Peak memory (cgroup `memory.peak`) |
| ------------------------------------ | ------------------------------- | --------------------------- | ------------------------------------------------ | ---------------------------------- |
| `linux/arm64`, native                | 74.0 s, 1080p, 8 scenes, 4.3 MB | **240 s**                   | voice 83 s · check 17 s · render 138 s · rest ~0 | **2.68 GB** of 4 GB                |
| `linux/amd64`, emulated (Rosetta)    | 73.8 s, same                    | 1257 s                      | render 549 s; the rest is emulated ONNX/x86      | 2.69 GB                            |

The emulated row is an artefact of running x86 Chromium and ONNX through Rosetta
(no AVX) and is not a prediction; it is listed because it proves the amd64 image
works end to end. The useful number is the native one.

**What to expect on Vercel.** A Performance instance's two vCPUs are slower per
core than this Mac's cores; allow 1.5–2.5× on the CPU-bound stages (voice with
Kokoro, check, render): **about 360–600 s for a no-key film**. With keys, the
lesson stage adds Claude's latency (the repository's own logs record ~145 s for a
keyed lesson) while ElevenLabs replaces most of Kokoro's 83 s — **roughly
450–650 s**. Both are under the 800 s limit, with less margin for the keyed path;
`[render-service] <id> cast finished: …` in the render project's logs prints the
per-stage seconds for every film, which is the number to watch.

**Voice after the continuous-narration merge (2e2f5b7).** Kokoro now speaks one
scene paragraph per call instead of one sentence per call. Measured on an M4 Pro
with the same inputs before (a4f4fa4) and after (3114da2), this is **not slower**:
photosynthesis/explainer, voice 141 s → 132 s in the amd64 (Rosetta) image at
`--cpus 2 --memory 4g`, 50 s natively in the arm64 image; four more inputs run
natively were within ±1 s. Kokoro's cost is linear in the text (340 characters as
one call ≈ the same four sentences called separately), and Whisper still aligns
each scene once. Two things to know: a Kokoro call blocks the event loop for its
whole duration (up to ~20 s per scene in the emulated image), so progress and
heartbeat writes pause while it runs. A host starved far below two real cores can
therefore exceed the 3-minute stale threshold (`STALE_AFTER_MS`) mid-scene. If
that ever happens, `INKCAST_VOICE_UNIT=sentence` restores the old
sentence-per-call unit (shorter blocking calls, choppier delivery); `clause` and
`paragraph` are also accepted. Each scene's synthesis time is logged at `info`
(`scene 2/8: … in 10.3s (paragraph)`).

Memory: 2.7 GB peak including page cache, so two capture workers leave ~1.3 GB of
headroom on 4 GB. Do not raise `INKCAST_RENDER_WORKERS` above 2 on this size: there
are only two vCPUs to feed, and memory is the first thing a third worker spends.

Blob usage for that film: 44 writes and ~160 reads (progress polling included).
Function trace per studio route: ~19 MB (was ~195 MB before the Blob-mode trace
exclusions). Image (amd64): 0.89 GB compressed; the largest layer, Chromium and
its system libraries, is 340 MB (VCR limit: 500 MB per layer).

## Limitations

- **800 seconds per film, hard.** A film that is not finished at 800 s is killed
  with its instance; the studio marks it failed after three minutes without a
  heartbeat. The hosted path is pinned to the `explainer` preset (≤ 75 s video),
  which fits with a wide margin; `deepdive` (≤ 150 s) is not offered when
  `INKCAST_HOSTED=1`. If longer films are ever needed, the next step is splitting
  the render across invocations by segment (the renderer already segments and
  caches by segment key) or Vercel Workflow — not a bigger single request.
- **No edit or re-render.** They resume from intermediate files (per-scene audio,
  the visuals sidecar, stage caches) that a Blob deployment deliberately does not
  keep. Both routes return 501; generating again is the workaround.
- **Uploads ≤ 4 MB.** The Function request body cap is 4.5 MB. Pasted text and
  URLs are unaffected. Lifting it means Blob client uploads in the studio form.
- **Rate limiting is per instance.** The per-IP limiter keeps its buckets in
  memory, and Fluid compute runs several instances, so the effective limit is
  looser than the configured 3/day. Add a Vercel WAF rate-limit rule on
  `POST /api/generate` if that matters.
- **No queue, no ETA.** Each film gets its own container instance; under a burst,
  the platform's concurrency (and your bill) is the queue. The "#3 in line"
  estimates of the single-box studio do not appear.
- **Nothing expires films.** `scripts/janitor.mjs` is a filesystem sweeper and does
  not apply. Delete from the library, or add a cron that deletes old prefixes.
- **Cold starts.** The image is several GB; a cold render instance takes seconds
  to start, and scales to zero after 5 idle minutes.
- **Cost profile.** The studio's dispatch Function is alive for the whole render
  (billed for provisioned memory, ~no CPU); the render instance is billed for
  Active CPU at Performance size for the render's duration; Blob for storage,
  operations (measured: 44 writes and ~160 reads per film, mostly progress) and
  transfer of each view.
- **Account keys are written per instance order only.** Two saves of different
  providers by one account at the same instant on two instances can race (last
  write wins); re-saving fixes it. Same-instance saves are serialised.
- **Filesystem server paths are refused with accounts on** (`filePath` → 403,
  upstream behaviour); pasted text, URLs and uploads ≤ 4 MB work.
