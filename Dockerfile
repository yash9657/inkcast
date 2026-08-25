# syntax=docker/dockerfile:1.7
#
# One image that runs the Inkcast studio anywhere: a plain VM behind Caddy
# (docker-compose.yml) or a container host's free tier (fly.toml). There is
# deliberately only one, because the thing that breaks a deployment of this
# product is never the orchestrator — it is Chromium, ffmpeg and 130 MB of ONNX
# weights all having to be present and findable by a non-root user. Solving that
# twice would mean solving it differently twice.
#
# ## What this image has to contain, and why each piece is not optional
#
# A render is not a web request. `packages/render/src/render.ts` splits the frame
# range across up to four *browser contexts* (`defaultConcurrency()` at line 50:
# `min(4, cpus - 1)`) and then hands the PNG/JPEG sequence to ffmpeg. So the
# runtime needs:
#
#   - **Playwright's Chromium**, plus the ~40 shared libraries Debian slim does
#     not ship. `chromiumAvailable()` (render/src/browser.ts:22) calls
#     `chromium.executablePath()` and a missing browser surfaces as the
#     `CHROMIUM_HINT` string, i.e. a hard failure at the last stage of a run the
#     user has already waited minutes for. It is installed at build time or not
#     at all.
#   - **ffmpeg**, for the mux. Playwright vendors an ffmpeg build for video
#     recording, but the pipeline shells out to a real one.
#   - **The ONNX weights, baked.** See the `weights` stage. This is the single
#     biggest departure from a naive image and the rest of this comment explains
#     it.
#
# ## Why the weights are baked rather than fetched on first run
#
# Today they are fetched lazily, at the moment the voice stage first needs them:
# `loadKokoro()` (voice/src/providers/kokoro.ts:163) points
# transformers.js at `modelCacheDir()` and calls `from_pretrained`, which
# downloads ~92 MB from Hugging Face if the cache is cold. The word aligner does
# the same for ~43 MB (voice/src/align.ts:297).
#
# In a container that is three separate defects. The first generation after every
# deploy pays a two-minute download inside a request the user is watching a
# progress bar for; an ephemeral filesystem pays it after *every* restart; and a
# box with no egress to huggingface.co — or a Hugging Face outage — turns the
# zero-key default voice, the one thing that is supposed to always work, into an
# error. Baking them makes the container's render path need no network at all
# except for the provider APIs the operator explicitly configured.
#
# `INKCAST_OFFLINE=1` in the runtime stage is what makes that guarantee
# enforceable rather than aspirational: it sets `allowRemoteModels = false`
# (kokoro.ts:180, align.ts:310), so if this image ever ships with a cold cache
# the failure is a loud "not cached" log at build-verification time instead of a
# silent 92 MB download in production. Grep for INKCAST_OFFLINE before assuming
# it does more than that — it is read in exactly two files, both of them local
# model loaders, and it has no effect whatsoever on the Anthropic or ElevenLabs
# adapters. Setting it does not put the image in "local-only" mode.
#
# ## The pnpm workspace, which is where images like this usually die
#
# Three properties of this repo make the install layer fussier than the usual
# `COPY package.json .` incantation:
#
#   1. Nine workspace projects, each with its own manifest. `--frozen-lockfile`
#      resolves the whole graph, so *every* manifest must be present before the
#      install runs or pnpm fails with a lockfile-mismatch error that reads like
#      a corrupt lockfile. They are copied as an explicit list rather than with a
#      wildcard because a wildcard that silently matches nothing produces exactly
#      that error, and a new package should break the build here — one line to fix
#      — rather than at runtime with a missing module.
#   2. `.npmrc` carries ten `public-hoist-pattern` entries, and they are load-
#      bearing, not tuning. Its own header explains it: Next decides whether a
#      package *can* be a server external by resolving it from `apps/web`, and
#      pnpm's default isolated layout puts `onnxruntime-node` only under
#      `packages/voice/node_modules`. Unresolvable from the app root means
#      "bundle it", and webpack cannot bundle a `.node` addon. Install without
#      `.npmrc` and the image builds, then fails on the first Kokoro call.
#   3. `pnpm-workspace.yaml` holds `onlyBuiltDependencies`, the allow-list of
#      packages permitted to run install scripts, and sharp, playwright,
#      esbuild, @tailwindcss/oxide and three more are on it. Their scripts are
#      what produce a working native binary, so `--ignore-scripts` is not
#      available to us as a build accelerant.
#
#      onnxruntime-node is *not* on that list, and both install stages say so out
#      loud: `Ignored build scripts: onnxruntime-node@1.21.0, protobufjs@7.6.5`.
#      That warning is expected rather than a thing to fix. onnxruntime-node
#      ships its `.node` addons inside the published tarball under
#      `bin/napi-v6/<platform>/<arch>/`, and its install script exists to fetch
#      the *optional CUDA* build — which this image has no GPU for. The runtime
#      verification below loads the module for real rather than trusting that
#      reasoning.
#
# The host's `node_modules` is excluded by `.dockerignore` for a related reason
# worth restating: it is darwin/arm64, and a copied tree fails at the first
# `require()` of a `.node` file with an ELF-class error that reads as a code bug.

ARG NODE_VERSION=22-bookworm-slim
# Pinned to `packageManager` in the root package.json. Corepack refuses to run a
# different version than a project pins, so these two must agree; a mismatch here
# is a build failure, which is the right outcome.
ARG PNPM_VERSION=10.33.0

# ---------------------------------------------------------------------- base --

FROM node:${NODE_VERSION} AS base

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # Next phones home on build and start otherwise. An operator running this
    # image has not agreed to that, and it is one fewer egress on a locked-down
    # box.
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# ---------------------------------------------------------------------- deps --
# Every manifest, then the install. Kept in its own stage and its own layer so
# that editing a source file does not re-resolve 900 packages: this layer is
# invalidated only by a manifest or the lockfile changing.

FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY apps/cli/package.json      apps/cli/
COPY apps/web/package.json      apps/web/
COPY packages/core/package.json     packages/core/
COPY packages/keyvault/package.json packages/keyvault/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/planner/package.json  packages/planner/
COPY packages/render/package.json   packages/render/
COPY packages/visuals/package.json  packages/visuals/
COPY packages/voice/package.json    packages/voice/

# The store cache makes a rebuild after a dependency bump minutes rather than
# tens of minutes. It is a BuildKit cache mount, so nothing of it lands in a
# layer. `--frozen-lockfile` is the point of the exercise: the image resolves to
# the same versions the repo was tested with, or it does not build.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# -------------------------------------------------------------------- source --
# The full workspace on top of the installed tree. Split from `deps` purely for
# cache behaviour; nothing is built here.

FROM deps AS source

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/
# Not incidental data. `render/src/font.ts` walks up to eight directories looking
# for `assets/fonts` and embeds the handwriting face it finds there; with no
# match it silently falls back to a system stack, so every video renders in the
# wrong hand — a quality failure that never announces itself as a failure
# (that module's own `withHand` comment says so). `assets/library` holds the
# figure and symbol SVGs the visuals stage draws from.
COPY assets/ assets/
# The board's ink personalities (plan item 7.3): one JSON file per style, loaded by
# `core/src/stylepack.ts`. Not optional and not incidental — `meta.style` is validated
# against this directory, so an image without it cannot parse a storyboard at all. That
# is deliberate: the loader throws rather than falling back to a built-in marker, so this
# COPY going missing is a first-run error naming the directory instead of every video
# quietly rendering in the wrong hand.
COPY styles/ styles/
# `examples/` is small and is the only thing the `filePath` source can point at
# (generate/route.ts confines it to the repo root), which is what makes a
# smoke test on a fresh box possible without uploading anything.
COPY examples/ examples/
# `scripts/janitor.mjs` runs *inside* this image — docker-compose.yml gives it
# its own container on a six-hour timer, and fly.toml documents the equivalent.
# Both are plain Node ESM importing nothing but `node:*`, so they need no part of
# the dependency tree.
COPY scripts/ scripts/

# ------------------------------------------------------------------- weights --
# Fetch the ONNX weights into the exact on-disk layout the runtime loaders
# expect. This is the one stage that must reach the network at build time.
#
# The weights are warmed by *calling the same libraries the pipeline calls*
# rather than by curling files into a hand-built directory tree. transformers.js
# owns that layout (`<cacheDir>/<org>/<repo>/<file>`, plus its own sidecar
# bookkeeping); reproducing it by hand is a guess that would break silently on
# any upstream change, and "silently" here means a 92 MB download in production.

FROM source AS weights

# Drift guard, and the reason it earns its place: the ids and dtype below are
# duplicated from TypeScript constants, and a duplicated constant is a constant
# that will eventually disagree. If someone bumps the Kokoro repo or changes the
# default dtype, this fails the *build* with a readable message instead of
# shipping an image whose baked cache misses and whose zero-network promise
# quietly evaporates. Cheap to update: change the id in both places.
RUN <<'SH'
set -eu
fail() { echo "Dockerfile weights stage is out of date: $1" >&2; exit 1; }
grep -q "KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'" \
  packages/voice/src/providers/kokoro.ts \
  || fail "KOKORO_MODEL_ID no longer matches onnx-community/Kokoro-82M-v1.0-ONNX"
grep -q "'onnx-community/whisper-tiny.en_timestamped'" \
  packages/voice/src/align.ts \
  || fail "the English aligner id no longer matches onnx-community/whisper-tiny.en_timestamped"
grep -q "return 'q8';" packages/voice/src/providers/kokoro.ts \
  || fail "the default Kokoro dtype is no longer q8"
SH

# `INKCAST_MODEL_CACHE` wins over everything in `modelCacheDir()`
# (kokoro.ts:103), so warming and reading cannot disagree about where the cache
# is. Without it both would fall through to `repoRoot()`, which depends on where
# `pnpm-workspace.yaml` sits relative to the *module file* — true here, but a
# detail no image should rest on.
ENV INKCAST_MODEL_CACHE=/app/.models

RUN <<'SH'
set -eu
node --input-type=module -e '
  const transformers = await import("@huggingface/transformers");
  const dir = process.env.INKCAST_MODEL_CACHE;

  // Exactly what loadKokoro() and the aligner set before loading. useFSCache is
  // what makes the download land on disk instead of in memory.
  transformers.env.cacheDir = dir;
  transformers.env.useFSCache = true;
  transformers.env.allowLocalModels = true;

  const { KokoroTTS } = await import("kokoro-js");
  console.log("warming Kokoro (q8) into " + dir);
  await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "cpu",
  });

  console.log("warming the word aligner (q8)");
  await transformers.pipeline(
    "automatic-speech-recognition",
    "onnx-community/whisper-tiny.en_timestamped",
    { dtype: "q8", device: "cpu" },
  );
'
SH

# Prove the warm actually produced weights rather than an empty tree with a
# happy exit code. `alignerCached()` (align.ts:77) tests for the repo directory
# alone, so a directory containing only a stray config would read as "cached"
# and then fail at runtime with `allowRemoteModels = false`. Size is the honest
# test: the two model files are 88 MB and 29 MB, so 100 MB across the tree is
# comfortably above any partial download and far below the real 130 MB.
RUN <<'SH'
set -eu
for repo in onnx-community/Kokoro-82M-v1.0-ONNX onnx-community/whisper-tiny.en_timestamped; do
  [ -d "/app/.models/$repo" ] || { echo "weights missing: $repo" >&2; exit 1; }
done
kb=$(du -sk /app/.models | cut -f1)
echo "baked weights: ${kb} KB"
[ "$kb" -ge 102400 ] || { echo "weights tree is only ${kb} KB — expected >= 100 MB" >&2; exit 1; }
find /app/.models -name '*.onnx' -size +1M -exec ls -la {} \;
SH

# --------------------------------------------------------------------- build --
# `next build --webpack`. Webpack rather than Turbopack is not a preference: the
# workspace packages are Node ESM and their relative imports carry the `.js`
# extension the spec requires, which only webpack's `extensionAlias` can map back
# onto `.ts`. next.config.ts explains it at length. The `--webpack` flag lives in
# the package script, so this just runs the script.

FROM source AS build

ENV NEXT_TELEMETRY_DISABLED=1

# Baked into the client bundle *if* a client component ever reads it, and read at
# request time by the two server components that use it today
# (app/layout.tsx:28 for `metadataBase`, app/share/[id]/page.tsx:31 for absolute
# share URLs). Passed at build as well as at run because a `NEXT_PUBLIC_` name is
# inlined at build time the moment a client component touches it, and getting a
# stale localhost into a bundle is a bug that only shows up as broken Open Graph
# previews. Empty is a legitimate value: the share page then derives its base
# from the request's own Host and X-Forwarded-Proto headers.
ARG INKCAST_PUBLIC_URL=""
ENV NEXT_PUBLIC_INKCAST_BASE_URL=${INKCAST_PUBLIC_URL}

# Optional, and omitted rather than guessed when unset — site-config.ts renders
# no source links at all instead of pointing at a URL that might 404.
ARG INKCAST_REPO_URL=""
ENV NEXT_PUBLIC_INKCAST_REPO_URL=${INKCAST_REPO_URL}

# Clerk's publishable key, needed at BUILD time and not only at run time — which
# is the whole reason this is an ARG and not just a runtime variable.
#
# `next build` prerenders the landing page (it reports `○ /` in the route table),
# and `signInRequired` in components/marketing/site-config.ts is derived from this
# variable. So the flag is frozen into the prerendered HTML at build. An image
# built without it and run with it set still serves the *self-hosted* landing
# copy — "no API keys", "No account, no key", and a comparison-table row claiming
# no account is needed — on a site that requires an account before it will render
# anything. That is the exact class of claim components/marketing/site-config.ts's
# own honesty rules forbid, and it would be shipped by the happy path.
#
# Empty is the right default and means "this image has no accounts": the landing
# page keeps the self-hosted wording, /sign-in and /sign-up 404, and identity
# falls back to the anonymous HMAC cookie. See docs/AUTH.md.
#
# CLERK_SECRET_KEY is deliberately *not* an ARG. It is a secret, a build argument
# is readable in the image history, and nothing at build time needs it — it is
# read at request time only. Set it in the runtime environment.
ARG CLERK_PUBLISHABLE_KEY=""
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}

RUN pnpm --filter @inkcast/web build

# ---------------------------------------------------------------- prod-deps --
# The same lockfile resolved with devDependencies pruned, in a throwaway stage.
#
# A separate install rather than `pnpm prune --prod` over the build tree, because
# pruning in place would mutate the very tree `next build` just validated and
# leave no way to tell a pruning bug from a build bug. This stage costs cache-warm
# minutes and saves them back on every image pull.
#
# Scripts are deliberately *not* skipped: `onlyBuiltDependencies` in
# pnpm-workspace.yaml lists sharp and onnxruntime-node, and both need their
# install script to leave behind a working native binary.

FROM deps AS prod-deps

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ------------------------------------------------------------------- runtime --

FROM node:${NODE_VERSION} AS runtime

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    # Browsers outside any home directory, so the runtime user's `$HOME` is not
    # part of the contract. Playwright resolves this before `~/.cache`, and both
    # the install below and `chromium.executablePath()` at runtime read it — they
    # must agree or the render stage reports "Chromium is not installed" in an
    # image that plainly has it.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # See the header. Two local model loaders honour these; no provider adapter
    # reads either.
    INKCAST_MODEL_CACHE=/app/.models \
    INKCAST_OFFLINE=1 \
    # Both of these must be on the volume. `INKCAST_PROJECTS` holds the films
    # (~33 MB each, measured across the 26 projects in this repo);
    # `INKCAST_HOME` holds `stateDir()`, whose `cache/` subtree is the
    # cross-project asset cache that makes the tenth video cheaper than the
    # first (core/src/project.ts:36). Pointing the latter at the container
    # filesystem would work and would throw that saving away on every restart.
    INKCAST_PROJECTS=/data/projects \
    INKCAST_HOME=/data/state \
    # The rate limiter reads the *rightmost* X-Forwarded-For entry and trusts
    # exactly this many appending hops (ratelimit.ts:trustedProxyHops). One is
    # correct for `client → Caddy → app`. Raise it by one per additional
    # appending proxy; too high fails closed, too low trusts the client.
    INKCAST_TRUSTED_PROXY_HOPS=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# ffmpeg for the mux; ca-certificates so the provider HTTPS calls have a trust
# store; tini because a Chromium render leaves the app as pid 1 with a dozen
# children, and pid 1 in a container does not reap orphans — without an init the
# image slowly fills with zombie renderer processes across a few hundred
# generations. `--no-install-recommends` and the list cleanup keep this from
# dragging in a third of Debian.
RUN --mount=type=cache,id=apt-runtime,target=/var/cache/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The production dependency tree, then Chromium. This order matters: the
# `playwright install` CLI is *in* that tree, and running it via `pnpm exec`
# guarantees the browser revision matches the `playwright` version the lockfile
# pinned (1.62.0 today). A globally installed playwright would download a
# revision the library then refuses to use.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/cli/node_modules      ./apps/cli/node_modules
COPY --from=prod-deps /app/apps/web/node_modules      ./apps/web/node_modules
COPY --from=prod-deps /app/packages/core/node_modules     ./packages/core/node_modules
COPY --from=prod-deps /app/packages/keyvault/node_modules ./packages/keyvault/node_modules
COPY --from=prod-deps /app/packages/pipeline/node_modules ./packages/pipeline/node_modules
COPY --from=prod-deps /app/packages/planner/node_modules  ./packages/planner/node_modules
COPY --from=prod-deps /app/packages/render/node_modules   ./packages/render/node_modules
COPY --from=prod-deps /app/packages/visuals/node_modules  ./packages/visuals/node_modules
COPY --from=prod-deps /app/packages/voice/node_modules    ./packages/voice/node_modules

# The root manifests, and they have to land *before* the `pnpm exec` below rather
# than with the rest of the sources. This is not tidiness — it is a build failure
# that was in this file until it was first built:
#
#     #45 [runtime 15/24] RUN pnpm exec playwright install --with-deps chromium
#     ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE  No package found in this workspace
#
# `pnpm exec` resolves the bin from the *project* it is standing in, and with
# node_modules present but no package.json, /app is not a project. The error names
# workspaces and recursion, which sends you looking at pnpm-workspace.yaml; the
# actual missing file is package.json. Copying it here costs nothing — these five
# files change about as often as the lockfile, which is the layer above.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json tsconfig.base.json ./

# `--with-deps` is the half that cannot be skipped: it apt-installs the ~40
# shared libraries (libnss3, libatk, libgbm, pango, …) that a Debian slim image
# does not carry and that Chromium refuses to start without. The failure without
# them is a launch error deep in a render, minutes into a run.
RUN --mount=type=cache,id=apt-playwright,target=/var/cache/apt,sharing=locked \
    pnpm exec playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

# Sources, the compiled Next output, the fonts and figures, and the weights.
#
# These trees carry the *build* stage's `packages/*/node_modules` and
# `apps/web/node_modules` with them, and COPY merges into a directory rather than
# replacing it, so the dev-dependency symlinks land on top of the pruned trees
# copied above. Harmless at runtime and deliberately left alone: the links point
# into `/app/node_modules/.pnpm`, which is prod-only, so a prod dependency
# resolves (same lockfile, same path) and a dev dependency is a dangling link
# nothing on the serving path ever reads. Worth knowing before running
# `pnpm --filter … test` inside this image, where those links are the reason it
# will not work.
COPY --from=build /app/packages ./packages
COPY --from=build /app/assets   ./assets
COPY --from=build /app/styles   ./styles
COPY --from=build /app/examples ./examples
COPY --from=build /app/apps/cli ./apps/cli
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/scripts ./scripts
COPY --from=weights /app/.models ./.models

# Non-root, and a fixed uid rather than a name so that a bind-mounted host
# directory can be chowned to a number the host also understands — the usual way
# a compose deployment ends up with an unwritable projects volume.
RUN groupadd --system --gid 10001 inkcast \
 && useradd --system --uid 10001 --gid inkcast --home-dir /home/inkcast --create-home inkcast \
 # Created here, and owned, so that the container starts even with no volume
 # attached. It will happily write films onto the container filesystem and lose
 # them on the next deploy — which is the documented free-tier failure mode in
 # docs/DEPLOY.md, not something to crash on at boot.
 && mkdir -p /data/projects /data/state \
 && chown -R inkcast:inkcast /data /app/.models \
 # Read+execute for everyone: the browsers were installed as root and the app
 # runs as uid 10001.
 && chmod -R a+rX /ms-playwright

USER inkcast

# The one verification this image cannot do without, and it runs *after* `USER`
# on purpose.
#
# Every failure mode this stage guards against is silent until the last minute of
# a render the user has already been watching a progress bar for: Chromium
# missing or unreadable by uid 10001 (`chromiumAvailable()` in
# render/src/browser.ts:22 returns the CHROMIUM_HINT string rather than
# throwing), the onnxruntime `.node` addon absent so the zero-key Kokoro voice
# cannot load, ffmpeg not on PATH so the mux fails, or a weights tree the
# non-root user cannot read. Each of those is a five-second check here and a
# four-minute waste there.
#
# It runs as `inkcast` because permissions are the interesting half. `chmod a+rX
# /ms-playwright` above is what makes the browser readable to a user that did not
# install it, and a root-only check would pass with that line deleted.
RUN <<'SH'
set -eu
node --input-type=module -e '
  import { existsSync, accessSync, constants } from "node:fs";
  const { chromium } = await import("playwright");
  const exe = chromium.executablePath();
  if (!existsSync(exe)) throw new Error("Chromium is not at " + exe);
  accessSync(exe, constants.X_OK);
  console.log("chromium: executable at " + exe);

  const ort = await import("onnxruntime-node");
  if (typeof (ort.InferenceSession ?? ort.default?.InferenceSession) !== "function") {
    throw new Error("onnxruntime-node loaded but exposes no InferenceSession");
  }
  console.log("onnxruntime-node: native binding loaded");

  const cache = process.env.INKCAST_MODEL_CACHE;
  for (const repo of [
    "onnx-community/Kokoro-82M-v1.0-ONNX",
    "onnx-community/whisper-tiny.en_timestamped",
  ]) {
    accessSync(cache + "/" + repo, constants.R_OK);
  }
  console.log("weights: readable as " + process.getuid());
'
ffmpeg -version | head -1
SH

EXPOSE 3000

# `--start-period` is the number that matters. This image spends its first
# seconds starting Next, and an unhealthy verdict during startup gets the
# container killed and restarted forever. 40 s is comfortably past a cold start
# and still fast enough to catch a genuinely wedged process.
#
# `/api/health` answers 200 for both `ok` and `degraded` on purpose — its own
# header explains that restarting a container does not create disk space and does
# kill every render in flight. Only an unreadable projects volume answers 503, so
# a failing healthcheck here means something a restart can actually fix.
#
# node's own fetch, so the image needs neither curl nor wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "--filter", "@inkcast/web", "start"]
