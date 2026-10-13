# PLAN-LAUNCH — public launch in hours, executed by Opus 5 with dynamic workflows

Written 2026-08-21 against branch `visuals-morph-density`. This plan turns Inkcast from a
local single-user studio into a publicly usable product for a same-day launch with hundreds
of testers, closes the measured quality gap to Golpo, reskins the whole surface to a
lazyweb.com-derived neo-brutalist system with our own colors and a new logo, and ships a
launch landing page. It is written to be executed by parallel Workflow fan-outs; each
workstream states its gate and the command that proves it.

## Read these first, in this order

1. `docs/HANDOFF.md` — §"Known defects, ranked by what a viewer notices" (items 0–11).
2. `docs/PLAN-GOLPO-PARITY.md` — the live parity plan. Phases 0, 1, 2, 4, 5a are done;
   **Phase 3 (script economy) is the single highest-impact open item** and was blocked only
   on an out-of-credit Anthropic account.
3. `docs/STATUS.md` — latest entry 2026-08-09. Append to it; every claim backed by a command.
4. `docs/CONTRACT.md` — the build contract. One clause conflicts with this plan (see A3).

## Traps that have burned previous sessions (do not re-learn these)

- **LLM briefs are not in the cache key.** Any edit to `teachingBrief()` or `DRAW_BRIEF`
  does nothing until you bump `STAGE_CODE_VERSION.lesson` (currently 11) in
  `packages/pipeline/src/keys.ts:165-195`.
- **Two ink engines.** `packages/render/src/sketch.ts` draws `path/shape/arrow/diagram/
emphasis/text` at render time; the visuals stage's roughjs SVGs for those types are
  written and never read. A visual fix in those lanes must land in `sketch.ts` or it
  silently does not apply (defect 9, `docs/PIPELINE.md` root cause 1).
- **Silent degradation is the dominant failure mode.** Stage provenance is set before the
  call, not returned from it (`cast.ts:485`); the figure chain has failed silently four
  times. When touching any provider chain, make provenance a returned value.
- **`pnpm lint` is `prettier --check .` and gates `docs/*.md`** — run
  `pnpm exec prettier --write` on everything you touch, this file included.
- **Four pinned storyboard hashes** move if type sizes change; the naive type-scale
  unification was already attempted and reverted in `45d4ff9`.
- **`fillcheck.mts` is not trusted** (reports 4× real density). `render/src/inkstat.mts`
  or nothing.
- Density/sync gates already exist as runnable tools: `inkstat.mts`, `synccheck.mts`,
  `lanecheck.mts`, `drawcheck.mts`, `frames.mts`. Use them as workflow gates; do not
  write new metrics without checking these first.

## Human blockers — clear these before or while Workstream A runs

These cannot be coded around:

1. **Fund the Anthropic API key.** Phase 3 and every keyed lesson run is blocked on it.
2. **Buy an ElevenLabs paid tier.** The free tier has ~8,864 characters left — less than
   one video. Launch traffic at even 100 videos × ~1,000 chars needs a Creator+ plan.
   Kokoro must remain the automatic fallback, but with honest provenance (A5).
3. **Fund Replicate or fal** for figure rasters (~$0.01–0.03/figure).
4. **Decide server-funded keys for the public deploy** (env vars on the box) vs BYOK.
   For a no-paywall launch, server keys with the D6 spend guardrails are the only sane
   option; keep the BYOK keyvault path for local/self-hosted users.
5. **Provision the box and domain.** One large VM (≥16 vCPU, 64 GB, e.g. Hetzner
   AX/EC2 c7i.4xlarge), DNS, and a decision on the public hostname.
6. **Social API applications take days, not hours** (see B3). File the TikTok Content
   Posting and Instagram Graph applications today so week-one can ship them; launch-day
   posting is share-intent based.

---

## Workstream A — video quality to Golpo level (the retention lever)

The measured gap (`docs/HANDOFF-PARITY.md`, STATUS 2026-08-08/09), same lesson both tools:

| metric               | Golpo        | ours           | target  |
| -------------------- | ------------ | -------------- | ------- |
| runtime              | 59.5 s       | 174–176 s      | 60–90 s |
| words                | ~145         | 348            | ~160    |
| silence ≥0.35 s      | 3.2 s (5.4%) | 26.8 s (15.4%) | ≤8%     |
| mean ink (`inkstat`) | 14.4%        | 5.0–5.7%       | ≥12%    |
| hues                 | 6            | 1–4            | ≥4      |

Ordered by what a viewer notices. A1–A5 are the launch cut; A6–A8 ship if time remains.

### A1. Prove the figure-box fix (first action, ~$0.10, ~15 min)

`13c7fe8`/`5090421` made figures request the reserved box instead of 66.7% of it, and are
**untested**. Re-render `projects/cardiac8f` with regenerated rasters, run `inkstat.mts`,
and append the numbers to STATUS. Gate: mean ink strictly above the 5.7% baseline.
STATUS already names this "the largest single move left on `inkstat`".

### A2. Script economy — execute PLAN-GOLPO-PARITY Phase 3

The film says 2.4× too much and stalls: 348 words vs ~145, 26.8 s of silence. In-speech
rate is fine (142–151 wpm); the defect is script economy and hold inflation.

- Add an `explainer` preset to `packages/planner/src/presets.ts:79`: ≤8 beats, word budget
  stated **in words** (~160 for a 60–90 s film), `visualsPerBeat` 2, hold ceilings 0.5–0.8 s
  (cap `CADENCE.maxHold` per preset), `outroSec` 1.0.
- Tighten `teachingBrief()` accordingly and **bump `STAGE_CODE_VERSION.lesson`**.
- Make `explainer` the default preset for the hosted studio (`standard` stays for CLI).

Gate: regenerate the cardiac lesson; total words ≤ 190, silence ≤ 8% of runtime
(`synccheck.mts` + the WAV), runtime 60–100 s.

### A3. Default the wiped board for the explainer preset

`--board wipe` exists end-to-end (`803aeeb`, `45d4ff9`) and measured content fill 55.5% →
62.3%, regions 4 → 1. Make `board: 'wipe'` the `explainer` preset default.
**Documented-decision conflict:** `docs/CONTRACT.md:26-30` still forbids wiping — amend the
contract in the same commit with one paragraph: accumulation remains the default for long
lessons; the explainer preset trades the tour for per-idea framing, which is what the
measurements favor at ≤90 s.

### A4. Density and figure adoption

Four moves, all against the ≥12% ink / ≥4 hues gate on `inkstat.mts`:

1. **Make the author actually ask for figures.** On the last keyed run the lesson author
   wrote twelve `draw` intents and zero underlays. Rework `UNDERLAY_ADVICE`
   (`packages/planner/src/lesson-anthropic.ts:81-89`) so the recognizable-object case
   ("a heart, a neuron, a jet engine — yes, every time") is stated inside the `draw`
   bullet as the default choice, not a caution-wrapped alternative. Bump the lesson
   stage version. Gate with `lanecheck.mts`: on a keyed cardiac run, ≥2 of the picture
   intents are underlays. The repo's own rule applies: a capability is shipped when the
   stage that has to ask for it actually asks.
2. **Stop composing marks blind.** `underlayFor()` (`packages/planner/src/
draw-anthropic.ts:523-527`) short-circuits on `kind === 'figure'` so the mark author
   never sees the picture it annotates — observed result: enclosure loops drawn across
   the anatomy. Attach the figure raster exactly as `form` underlays already do.
3. **Fill the frame.** With wipe + full-box figures in, re-check `resolveFraming`; if the
   recap still shrinks content, clamp minimum content fill per scene at 55%.
4. **Color.** `meta.palette: 'color'` plus figure lanes should yield ≥4 hues; verify with
   `inkstat.mts` hue count, and if mono boards persist, let the draw brief assign `tone`
   semantically (one accent per role) rather than defaulting everything to ink.

### A5. Voice — calming, context-aware, and finally heard end-to-end

The prosody stack is built and has never produced a finished keyed film (the one attempt
mixed providers mid-run and misbilled). For launch:

- **One clean end-to-end ElevenLabs film** on the paid key. Engine `eleven_flash_v2_5`
  is fine for launch; A/B `eleven_v3` (per-word timestamps, better expressiveness) behind
  `ELEVENLABS_MODEL_ID` if characters allow.
- **Curate, do not enumerate.** Replace the 28-voice dropdown with 3–4 curated moods
  ("Calm", "Warm", "Bright", "Narrator"), each a pinned ElevenLabs voice id with a Kokoro
  twin for fallback. Calm = keep `stability: 0.55, style: 0`; select 2 candidate voice ids
  by listening, not by docs. The `previous_text`/`next_text` continuity and graduated
  gap logic already give context-awareness — leave them on.
- **No silent demotion at launch.** If ElevenLabs dies mid-run, fail the voice stage over
  to Kokoro **for the whole film** (re-synthesize from scene 0) so one video never mixes
  voices, surface "narrated locally" in the result UI, and bill $0. Provenance returned,
  not inferred.
- **Word-level emphasis** (defect 11): apply `EMPHASIS_SLOWDOWN`/`EXTRA_GAP` to the
  emphasized word's clause boundary nearest the word rather than the whole clause — only
  if the diff stays small; otherwise defer.

Gate: one finished film, ElevenLabs end-to-end, `pipeline.json` provider and cost honest,
sync verified by `synccheck.mts` (0 co-landing strokes).

### A6. The "professional at a glance" layer (should-ship)

**Status 2026-08-22: the first two bullets are wired, verified on pixels and
regression-tested; the third is still open.** A6 first shipped as _dead code_ — 283 lines in
`sketch.ts` with no call sites, which is how it passed review — and was then wired. Today
`render/src/compile.ts:508` calls `brandPlateItem` (→ `sketchBrandMark`, `BRAND_MARK`) and
`:1346` calls `titleUnderlinePrims` (→ `sketchUnderline`, `TITLE_UNDERLINE`). Note that
`sketchWritten` never existed: the letter-by-letter mechanics live in the browser runtime
(`render/src/page/runtime.js:30`, `WRITE_COST = 1.55`) and already applied to every text
prim, so the only missing half of "written titles" was ever the accent underline. The third
bullet, `INKCAST_DRAW_FIX=all`, is a deployment setting and nothing has been deployed.
See `docs/STATUS.md` (2026-08-22).

- **Letter-by-letter titles** (PLAN-GOLPO-PARITY Phase 5 items 2–3): a heading type role
  drawn as written text with the existing `WRITE_COST` mechanics, accent-underlined.
  STATUS calls this Golpo's single biggest at-a-glance cue. Touches `sketch.ts` too (trap
  above).
- **Brand plate**: last 1.2 s outro draws the new logo mark (C4) small in the corner —
  brand recall on every shared video, and Golpo watermarks theirs.
- **Vision critic on every drawing for launch**: set `INKCAST_DRAW_FIX=all` on the hosted
  box (correctness costs pennies against retention). The tidy-vs-correct audit gap
  (defect: benzene chords, septum leaders) has no metric yet — do not attempt one today;
  the vision pass is the available lever.

### A7. Text clipping (defer unless time)

`empty stac`, `AV nod` — three uncoordinated type catalogs (`planner/src/elements.ts`
FONT, `core/src/camera.ts` TYPE_SCALE, `visuals/src/style.ts` ROLE_SCALE). The honest fix
is measure→frame→re-measure and moves all four pinned hashes; `45d4ff9` already reverted
the naive version. Launch mitigation only: `shorten()` harder at compile so labels fit
their measured boxes; the real fix is week-one.

### A8. Captions (free win, should-ship)

Word-level timings already exist for every film. Emit `captions.srt` + `.vtt` next to
`out.mp4` at render time, add them to the export bundle (B1) and `<track>` on the share
page. For 9:16, offer burned-in captions via an ffmpeg subtitle pass (off by default).

---

## Workstream B — any format, straight to social

### B1. Export bundle

Aspects (16:9/9:16/1:1 at 1080p/30) already render. Add per-project:

- `out.mp4` (exists), `captions.srt`/`.vtt` (A8), `thumbnail.png` (exists),
  `preview.gif` (first 4 s, 480 px, ffmpeg palettegen — for chat apps and embeds).
- `GET /api/media/:id/bundle.zip` streaming these, and per-platform download names
  already handled by `downloadName()` in `apps/web/lib/api.ts:586`.

### B2. Share surface + caption writer

- `/share/:id` already has OG `video.other` + Twitter card. Restyle under C, add the
  player with `<track>` captions, a "Made with Inkcast" plate, and a **Remix this topic**
  CTA into `/studio` — the viral loop.
- **Caption writer**: one small LLM call per finished project producing platform-shaped
  copy (YouTube title+description, TikTok/Reels hook + hashtags, X post, LinkedIn post),
  cached into `pipeline.json`. Result view: caption per platform with a copy button.

### B3. Posting — honest tiering

- **Launch day (no external approvals):** Web Share API with the video file on mobile
  (`navigator.share({files})` covers TikTok/IG/YT intents on phones); on desktop, a
  per-platform "Post" button that downloads the right rendition, copies the generated
  caption, and opens the platform's upload page (`youtube.com/upload`,
  `tiktok.com/tiktokstudio/upload`). Honest label: "we prep everything; you hit post."
- **Week one:** YouTube Data API resumable upload behind Google OAuth (works immediately
  in testing mode for up to 100 testers; file for verification now).
- **After app review:** TikTok Content Posting API and Instagram Graph reels publishing —
  applications filed on launch day (human blocker 6). Do not fake these in the UI; show
  "connect (coming this week)" only if the application is actually filed.

---

## Workstream C — brand, UI/UX, and landing page (lazyweb-derived, ours)

lazyweb.com's shipped system, decoded from their CSS: Space Grotesk (headings 500–700) /
Inter (body) / JetBrains Mono (mono labels); paper `#fffefb`–`#ffffff` with a 1 px dot
grid every 24 px; pure-black ink text with tight negative tracking (−0.02 to −0.04 em);
one hot accent (`#FF6B00`) with `-soft` (8% alpha) and `-border` (25% alpha) derivatives;
1 px solid black borders; **hard zero-blur offset shadows** (`6px 6px 0`, `10px 10px 0`,
sometimes in the accent); radius 0 with occasional 999px pills; dashed borders as accents.
We take the system, not their colors or logo.

### C1. Token swap — keep the architecture, replace the values

`apps/web/app/globals.css` is the design system and its rules stand: semantic tokens
only, OKLCH, both themes at the token layer, no `dark:` in components, no
`tailwind.config.js`. Replace values:

- **Paper**: `--background: oklch(0.995 0.004 95)` (≈`#FFFEFB`) with the dot grid as a
  `body` background-image (`radial-gradient(circle, dot 1px, transparent 1px)`,
  24 px grid, dot ≈ `oklch(0.88 0.005 95)`). Keep `surface-grain` if it composes.
- **Ink**: text ≈ `oklch(0.17 0.01 285)` (near-black), secondary/muted grays as today
  but colder.
- **Accent — "cast violet"**: keep the existing brand hue 275–277 but punch it for
  brutalism: `--accent: oklch(0.51 0.23 277)` (≈`#5B45E0`), with `--accent-soft` (8%
  alpha) and `--accent-border` (28% alpha) exactly as lazyweb derives theirs. This keeps
  brand continuity with the whiteboard's `--ink-violet` so chips still match strokes.
  Secondary hand accent: highlighter yellow ≈ `oklch(0.9 0.16 95)` for `ink.tsx`
  underlines only.
- **Elevation**: replace the 5-step soft ladder with the brutalist pair —
  `--shadow-card: 6px 6px 0 oklch(0 0 0 / 0.12)` and `--shadow-pop: 10px 10px 0
var(--accent)`; `--elevation-inset` survives for wells.
- **Radius ladder → 0** (keep one pill token for tags/badges). **Borders**: 1 px solid
  ink on every card/input; 1 px dashed for the dropzone (already the pattern).
- **Dark theme**: invert — ink paper `oklch(0.16 0.01 285)`, light text, dot grid at
  ~6% white, accent lifted to `oklch(0.68 0.19 277)`, shadows become
  `6px 6px 0 oklch(0 0 0 / 0.5)`.

### C2. Fonts

Vendor (all OFL, zero-network builds rule in `apps/web/lib/fonts.ts` stands):
**Space Grotesk** 500/600/700 → display + headings, tracking −0.02 to −0.035 em;
**Inter** 400/500/600 → body/UI (replaces Geist); **JetBrains Mono** 400/500 →
timecodes, figures, kbd (replaces Geist Mono). **Keep Shantell Sans** as the hand accent
— that is ours, and it ties the chrome to the board; Instrument Serif retires. Update
`--font-*` tokens and the four-weight rule (400/500/600/700 now).

### C3. Component sweep

`apps/web/components/ui/` (25 primitives): buttons become bordered blocks — primary =
accent fill, ink border, `--shadow-pop` collapsing to 0 offset on `:active`
(translate 2px); secondary = paper fill, ink border, `--shadow-card`. Cards, dialogs,
tabs, selects follow. `mini-board.tsx`, `generation-view.tsx`, `video-player.tsx`,
`result-view.tsx` restyle by token inheritance; hand-check each. Gate: Playwright
screenshots of `/`, `/studio`, generation in progress, result, `/library`, `/share/:id`
in both themes, reviewed side-by-side against lazyweb.com.

### C4. Logo

New mark, pure SVG (`components/marketing/logo.tsx`, dedupe the copy in
`app/(app)/layout.tsx:28-42`):

- **Mark**: a square ink-bordered tile on paper (not filled), 2 px border, with a single
  confident marker stroke drawn corner-to-corner rising right — the "cast" — ending in a
  solid triangular nib that doubles as a play button; stroke in cast violet, tile shadow
  `4px 4px 0` accent. Reads at 16 px (favicon) and 512 px (OG).
- **Wordmark**: `inkcast` lowercase, Space Grotesk 700, −0.03 em, ink; the `k`
  underlined by a Shantell-style hand stroke in highlighter yellow.
- Deliverables: logo component, `favicon.svg`/`.ico`, `apple-touch-icon`, OG image
  (1200×630, dot grid + mark + tagline), and the video brand plate (A6).

### C5. Landing page

Keep the honesty rules in `site-config.ts` (no invented logos/testimonials, every link
resolves). Structure, lazyweb-shaped:

1. **Nav**: mark + wordmark, `How it works · Examples · FAQ`, pill CTA "Make one free".
2. **Hero** on the dot grid: H1 in Space Grotesk ~72 px, tight — "Type a topic. Watch it
   get drawn." Sub: "Hand-drawn explainer videos with a voice that actually teaches —
   any topic, any format, free." CTA pair (accent block + ghost). Right: the existing
   `ink-demo.tsx` self-drawing board inside an ink-bordered, hard-shadowed frame — it is
   already the best asset on the page; restyle, don't rebuild.
3. **Try strip**: a single input ("explain photosynthesis…") that deep-links into
   `/studio` prefilled — zero-friction first hook.
4. **Format row**: three hard-shadow cards — Landscape/YouTube, Vertical/Reels·TikTok·
   Shorts, Square — each with a looping muted `preview.gif`.
5. **How it works** (exists — restyle): source → lesson → voice → drawn in sync.
6. **Cost comparison** (exists, keep the receipts).
7. **FAQ** (exists) + closing CTA block with `--shadow-pop`.

Gate: Lighthouse ≥90 performance on the landing route; hero readable at 360 px.

---

## Workstream D — launch hardening (hundreds of users, one box)

Today: no auth, in-process job Map, single-file index with a lost-update race, renders
(Chromium ×4 contexts + ffmpeg ×4) inside the Next process, zero rate limiting, no
deployment artifact. Minimum viable hardening, in order:

### D1. Admission control and a visible queue

Global render semaphore of **2 concurrent renders** with a FIFO queue in `lib/jobs.ts`
(it already buffers/replays SSE history — add a `queued` state with live position:
"You're #4 — about 6 minutes"). Voice + lesson stages may run at concurrency 4 while
renders gate at 2. Cap hosted generations to the `explainer` preset (≤100 s video) for
launch; the honest wait math is part of the UX, not an apology.

### D2. Abuse control without a paywall

Per-IP token bucket: 3 generations/day, 10 total/day burst-capped, `429` with friendly
copy. One shared secret env `INKCAST_BYPASS_TOKEN` for the team. Body caps exist (32 MB);
add a 20 k-char cap on hosted source text (keeps lesson-stage cost bounded).

### D3. Sessions and ownership

Anonymous signed cookie (`iron-session` or an HMAC'd id — no user accounts today).
Project ids stay unguessable; scope `/library`, `DELETE`, `/edit`, `/rerender` to the
owning session. `/share/:id` stays public **only after** the owner clicks Share (add a
`shared: true` flag in project meta; default off).

### D4. Kill the index race

`projects/index.json` single-file rewrite is a lost-update race under concurrency.
Fastest correct fix: per-project `meta.json` as truth (the header already says the index
is "a cache, never the source of truth") + an async-mutex around index rebuilds.

### D5. Deployment artifact

Dockerfile: `node:22` + ffmpeg + `playwright install --with-deps chromium` + `.models/`
ONNX weights baked in; `NEXT_TELEMETRY_DISABLED`; healthcheck route (`/api/health`
returning queue depth + disk free). Caddy for TLS. Disk janitor (cron in-process): delete
project dirs older than 48 h unless `shared: true`. Server keys via env
(`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `REPLICATE_API_TOKEN`) — verify each provider
reads env before keyvault on the hosted path, and hide `/settings` BYOK UI when
`INKCAST_HOSTED=1`.

### D6. Spend guardrails and honest fallback

Daily spend counter (the cost plumbing from `b829d98` already tallies per-provider
chars): past a configurable ceiling, new generations fall back to Kokoro + no-figure
mode **with a banner saying so** — never silently. Log provider provenance per project.

### D7. Load proof

A script that fires 25 concurrent `POST /api/generate` (small topic, explainer preset):
gate = zero lost jobs, queue positions monotone, no OOM (watch RSS), index intact,
p95 time-to-video under 12 min at depth 10. Run it on the launch box, not a laptop.

---

## Sequencing and cut lines

Run A, C, D as three parallel workflows immediately; B after A5 lands (it consumes the
export bundle). Within A, A1 is first (15 min, proves two committed fixes), then A2–A5
in parallel where files don't collide.

- **Must ship at T-0**: A1–A5, all of C, D1–D6, B1–B2, B3 launch-day tier.
- **Should ship**: A6 (titles + brand plate), A8 (captions), D7 run twice.
- **Explicitly deferred** (say so in the UI where relevant): OAuth posting (B3 later
  tiers), the text-clip fixed-point fix (A7), 4K/60 fps, music/SFX, StylePack
  (`docs/STYLES.md`), mascot (Phase 6), correctness metric for drawings.

## Orchestration notes for the executing model

- One workflow per workstream; inside A, one agent per item with file-collision awareness
  (`lesson-anthropic.ts` is touched by A2 and A4 — serialize those two).
- Every quality change is proven by a rendered film + the named `.mts` gate, and the
  numbers appended to `docs/STATUS.md` with the command that produced them. No gate, no
  merge.
- Every UI change is proven by Playwright screenshots in both themes.
- Anything touching briefs bumps `STAGE_CODE_VERSION`; anything touching
  `path/shape/arrow/diagram/emphasis/text` visuals lands in `render/src/sketch.ts`.
- `pnpm -r typecheck && pnpm -r test && pnpm lint` green before any merge to `main`.

## Launch runbook (last hour)

1. Merge to `main`; tag. 2. Build the Docker image; run D7 on the box. 3. Set env keys,
   `INKCAST_HOSTED=1`, spend ceiling. 4. Render three showcase films (one per aspect)
   with the paid voice; put them on the landing format row and pin them in `/library`.
2. Verify `/share/:id` unfurls on X/Slack/iMessage. 6. Point DNS, watch `/api/health`,
   keep the Kokoro fallback banner tested and ready.
