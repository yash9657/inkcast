# Inkcast

**Turn a document into a narrated, hand-drawn whiteboard explainer video — on your
own machine, with no API keys and no per-minute bill.**

Inkcast is a **compiler**, not a video model. Your text goes in, a storyboard is
compiled out, and that storyboard is drawn frame by frame in a headless browser
and muxed into an mp4 with ffmpeg. No proprietary video model is involved anywhere
in the pipeline, and none is needed: everything you see is vector strokes, real
text, and measured audio, generated deterministically from an intermediate
representation you can read, edit and diff.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm cast examples/gradient-descent.md
```

That writes `projects/<id>/out.mp4`. It costs **$0.00**, works offline once the
local voice model is cached, and sends nothing anywhere.

---

## Contents

- [Quickstart](#quickstart)
- [What makes the output good](#what-makes-the-output-good)
- [Architecture](#architecture)
- [The Storyboard IR](#the-storyboard-ir)
- [Editing without regenerating](#editing-without-regenerating)
- [Cost, honestly](#cost-honestly)
- [Provider matrix](#provider-matrix)
- [CLI reference](#cli-reference)
- [Self-hosting](#self-hosting)
- [Contributing](#contributing)
- [Why AGPL-3.0](#why-agpl-30)

---

## Quickstart

**Requirements:** Node 22+, pnpm 10+, and `ffmpeg` on your `PATH`
(`brew install ffmpeg` / `apt install ffmpeg`). Chromium is fetched by Playwright
in the step below. No API keys.

```bash
pnpm install                              # workspace install
pnpm exec playwright install chromium     # ~150 MB, once per machine
pnpm cast examples/gradient-descent.md    # -> projects/<id>/out.mp4
pnpm dev                                  # the studio, at localhost:3000
```

The first run also downloads the local text-to-speech weights (Kokoro-82M, about
92 MB, cached and shared across projects). After that, casting a document needs no
network at all.

Check what your machine is set up to do:

```bash
inkcast providers
```

```
STAGE    PROVIDER              WHERE  WHY
plan     heuristic             local  ANTHROPIC_API_KEY is unset
voice    kokoro/af_heart       local  ELEVENLABS_API_KEY is unset
visuals  builtin               local  no image provider key set
render   playwright + ffmpeg   local  ffmpeg found: ffmpeg version 8.1.2

  Fully local: this configuration costs $0.00 per video.
```

Then try your own material — a README, a design doc, a lecture handout, a URL, or
whatever is on your clipboard:

```bash
cast ./docs/architecture.md --aspect 9:16 --style pencil
cast https://en.wikipedia.org/wiki/Backpropagation --title "Backprop in 90 seconds"
pbpaste | cast - --palette mono --out ~/Desktop
```

---

## What makes the output good

Two structural decisions, both baked into the IR rather than bolted onto a prompt.

### One persistent canvas, not a deck of slides

Most tools in this category wipe the whiteboard between scenes. It is the quickest
way to make a video nobody can follow: the viewer assembles a mental picture and
then watches it get erased every eight seconds.

Inkcast draws on **one large canvas** and moves a _camera_ across it. Elements
default to `persist: true`, so a diagram sketched in scene two is still on the
board in scene six — which means later beats can circle it, underline it, or run
an arrow to it, and the final shot can pull back to reveal the whole argument at
once. That is the 3blue1brown-style build-up, and it falls straight out of the
data model: `Storyboard.canvas` plus `Scene.camera`.

### Every entity is drawn exactly once

`storyboard.assets[]` is an entity library keyed by a stable `id`, with a locked
`seed`. An element refers to an asset by `assetId`, so when the rover appears in
scene one and scene five, it is _the same rover_ — the same lines, the same wobble.

Regenerating a character per appearance is why competing tools produce a subtly
different mascot in every shot. It is a structural problem, and this is the
structural fix: resolve once, reference forever. It also makes re-rendering cheap,
because artwork is content-addressed and cached.

### Timing is measured, not guessed

Authors place elements at a _fraction_ of a scene (`enter.at: 0.35`). The voice
stage synthesises the narration, measures the real audio, and writes
`scene.durationSec`. The animation is then laid out against measured time — so
re-voicing in another language, at another speed, or with another provider reflows
the whole video instead of desynchronising it.

---

## Architecture

```
        ┌──────────┐   SourceDoc   ┌──────────┐  Storyboard  ┌──────────┐
 text   │          │  ───────────► │          │ ───────────► │          │
 file ─►│  ingest  │               │   plan   │              │  voice   │
 URL    │          │               │          │              │          │
 stdin  └──────────┘               └──────────┘              └──────────┘
        @inkcast/planner           @inkcast/planner           @inkcast/voice
                                   heuristic, or Claude       Kokoro locally,
                                   if a key is present        or ElevenLabs
                                                                    │
                                                     + durationSec  │
                                                     + audioPath    ▼
        ┌──────────┐                             ┌──────────┐  ┌──────────┐
  mp4 ◄─┤  render  │ ◄─────────────────────────  │ visuals  │ ◄┘
        └──────────┘        + asset.svg          └──────────┘
        @inkcast/render                          @inkcast/visuals
        Playwright frames                        icons + procedural diagrams,
        + ffmpeg mux                             or a text-to-image model
```

Every stage **only enriches the storyboard** — none of them reshape it. That single
property buys three things:

- **Resumability.** The storyboard is saved after every stage and each stage's
  inputs are hashed into `cache.json`. Crash during render and you re-render;
  everything before it is already done. Cast the same document twice and the
  second run does nothing at all, in well under a second.
- **Editability.** A natural-language edit is a patch to this JSON, and a
  re-render is a pure function of it.
- **Progress you can trust.** Stages report their own 0–100; the pipeline squashes
  them into one monotonic number weighted by real wall-clock share (render is 45%
  of it), which is what the CLI bar and the studio's SSE stream both display.

```
packages/core        the Storyboard IR, logging, project dirs, cache        (no deps but zod)
packages/planner     ingest + plan
packages/voice       narrate
packages/visuals     resolveVisuals
packages/render      render — Playwright + ffmpeg
packages/pipeline    the orchestrator: cast / rerender / editStoryboard
apps/cli             inkcast / cast
apps/web             the studio (Next.js)
examples/            source documents and a hand-written storyboard
projects/<id>/       one directory per video (gitignored)
```

A project directory is the whole state of a video — no database:

```
projects/8f2ac1d0b3e4/
├── storyboard.json    the IR, after the last stage that touched it
├── source.json        the ingested document
├── audio/scene-*.wav  one clip per scene
├── frames/            transient capture space
├── preview.html       the deterministic page the frames came from
├── cache.json         input hashes per stage — what makes a re-run free
├── pipeline.json      title, timings, cost, provider choices
└── out.mp4            the video
```

Copy that directory to another machine and it still renders. Delete it and the
video is gone. `inkcast list` rebuilds the library from disk on every call, so a
finished video cannot be lost by a page refresh.

Programmatic use is the same three calls the CLI and the studio make:

```ts
import { cast, editStoryboard, rerender } from '@inkcast/pipeline';

const { projectId, videoPath, storyboard } = await cast(
  { filePath: 'examples/gradient-descent.md', meta: { aspect: '9:16', style: 'pencil' } },
  { onProgress: (p) => console.log(p.stage, `${p.pct}%`, p.note ?? '') },
);

await editStoryboard(projectId, 'scene 3 narration: slow down and give an example');
await rerender(projectId); // re-voices only what changed, then rebuilds the mp4
```

---

## The Storyboard IR

`packages/core/src/storyboard.ts` is the one contract every stage agrees on. It is
a zod schema, so it validates at every boundary, and it is small enough to read in
one sitting.

```jsonc
{
  "version": 1,
  "title": "Why caches make code fast",
  "meta": {
    "aspect": "16:9",
    "style": "marker",
    "palette": "color",
    "voice": "af_heart",
    "fps": 30,
  },
  "canvas": { "x": 0, "y": 0, "w": 2600, "h": 1400 }, // ONE board, wider than a frame
  "assets": [{ "id": "cpu", "kind": "icon", "prompt": "a CPU chip", "seed": 1337 }],
  "scenes": [
    {
      "id": "scene-001",
      "narration": "Your processor can do a few billion things a second.",
      "camera": { "x": 640, "y": 420, "zoom": 1.8, "transition": 0 },
      "elements": [
        {
          "id": "t-title",
          "type": "text",
          "text": "Why caches make code fast",
          "role": "title",
          "at": { "x": 120, "y": 150, "w": 1040, "h": 120 },
          "enter": { "at": 0, "duration": 1.1, "style": "write" },
        },
        {
          "id": "a-cpu",
          "type": "asset",
          "assetId": "cpu",
          "at": { "x": 220, "y": 360, "w": 220, "h": 220 },
          "enter": { "at": 0.4 },
        },
      ],
    },
  ],
}
```

| Concept       | What it is                                   | Why it is shaped that way                           |
| ------------- | -------------------------------------------- | --------------------------------------------------- |
| `canvas`      | One coordinate space for the whole video     | Scenes tour it with a camera instead of clearing it |
| `camera`      | Centre, zoom and transition per scene        | A pan and a zoom are cheap; a wipe destroys context |
| `elements`    | text, asset, shape, arrow, diagram, emphasis | `emphasis` targets an element drawn earlier by id   |
| `persist`     | Defaults to `true`                           | The board accumulates; that is the whole point      |
| `enter.at`    | Fraction of the scene, 0–1                   | Survives re-voicing in another language or voice    |
| `assets[]`    | Entity library, `id` + `seed`                | One entity, one look, forever                       |
| `durationSec` | Written by the voice stage                   | Measured, never estimated                           |

Element types are a discriminated union, `enter.style` is one of
`draw | write | fade | pop | grow`, and the whole thing parses with
`parseStoryboard()`. `examples/storyboard-handwritten.json` is a complete
four-scene storyboard written by hand — the fastest way to exercise the voice,
visuals and render stages with no planner in the loop:

```bash
mkdir -p projects/handwritten
cp examples/storyboard-handwritten.json projects/handwritten/storyboard.json
inkcast rerender handwritten && inkcast preview handwritten
```

---

## Editing without regenerating

Say what you want in plain English. The instruction is turned into a small list of
typed edit operations, applied to the JSON, and validated — then only the affected
scenes are re-voiced.

```bash
inkcast edit last "scene 3 narration: slow down and give a concrete example"
inkcast edit last "make it vertical; use pencil; voice: am_puck"
inkcast rerender last
```

With `ANTHROPIC_API_KEY` set, Claude maps free-form instructions onto those
operations. **With no key, editing still works**: instructions are matched locally
against documented patterns (title, narration, insert / delete / move scene,
zoom, voice, language, style, palette, aspect, fps, outro, element text). Either
path ends in the same deterministic applier, so the risky part — mutating the IR —
is one code path with the zod schema as its gate. `inkcast edit` prints the
patterns it understands if it cannot parse yours.

Editing narration clears that scene's measured audio, and changing the language or
voice clears all of it — so the cache can never serve a duration that belongs to a
clip you no longer have.

---

## Cost, honestly

The default path is **local and free**, and that is not a trial tier — it is the
architecture. There is no metered inference in it, so there is nothing to bill.

| Stage   | Local default                            | Cost      | Cloud upgrade                  | Published list price               |
| ------- | ---------------------------------------- | --------- | ------------------------------ | ---------------------------------- |
| plan    | heuristic planner                        | **$0.00** | `claude-sonnet-5`              | ~$0.10 per video (≈1k-word source) |
| voice   | Kokoro-82M via `kokoro-js`               | **$0.00** | ElevenLabs, Creator tier       | ~$0.19 per finished minute         |
| visuals | 2000+ stroke icons + procedural diagrams | **$0.00** | FLUX-class on Replicate / fal  | ~$0.003 per image                  |
| render  | Playwright + ffmpeg, your CPU            | **$0.00** | — (there is no cloud renderer) | —                                  |

**Fully local: $0.00 per minute.** A cloud-upgraded run is dominated by
text-to-speech — roughly 850 spoken characters per finished minute — so the mix
matters. Upgrading only the planner and keeping local voice lands at a few cents
_per video_; upgrading the voice as well puts you in the region of **$0.20 per
finished minute**, and cheaper ElevenLabs tiers or a cheaper planner model bring it
under. The CLI prints the arithmetic after every run:

```
  cost       $0.00 — nothing left this machine
  cost       ~$0.07 (estimated · plan anthropic/claude-opus-5 $0.0281,
                     voice elevenlabs/Rachel $0.0416 · $0.303/min)
```

Cloud figures are **estimates from observed quantities** (characters sent,
characters spoken, images generated) multiplied by published list prices — not an
invoice. A fully local run is not an estimate: it is exactly zero.

### Compared with commercial whiteboard-video tools

|                                                                       | Price per finished minute |
| --------------------------------------------------------------------- | ------------------------- |
| **Inkcast, local**                                                    | **$0.00**                 |
| **Inkcast, cloud-upgraded**                                           | **~$0.20 or less**        |
| Golpo AI, published API pricing (`$1 = 1 credit`, `2 credits/minute`) | $2.00                     |
| Category range recorded in [`docs/CONTRACT.md`](docs/CONTRACT.md)     | $1.25 – $8.00             |

Those competitor numbers are **the vendors' own published list prices** as
researched on 2026-07-28 (see [`docs/research/golpo-ux.md`](docs/research/golpo-ux.md)),
not our measurements, and volume credit bundles will beat them. The relevant point
is not the exact multiple: it is that subscription tiers also _gate_ capability —
colour output, longer videos, script editing, voice cloning and frame-level edits
each sit behind a different price point. Inkcast has no tiers, so every capability
it has is available to everyone on day one.

---

## Provider matrix

| Stage   | Runs local & free                                              | Needs a key                        | What the key buys                                                     | Missing key behaviour               |
| ------- | -------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| ingest  | ✅ always                                                      | —                                  | —                                                                     | —                                   |
| plan    | ✅ heuristic planner                                           | `ANTHROPIC_API_KEY`                | Tighter scripts on long or messy sources; free-form edit instructions | Heuristic planner, one warning line |
| voice   | ✅ Kokoro-82M (English, 28 voices; macOS `say` as last resort) | `ELEVENLABS_API_KEY`               | More natural prosody, more languages, voice cloning                   | Kokoro, one warning line            |
| visuals | ✅ built-in icons + procedural diagrams                        | `REPLICATE_API_TOKEN` or `FAL_KEY` | Bespoke illustrations, vectorised before drawing                      | Built-in library, one warning line  |
| render  | ✅ Playwright + ffmpeg                                         | —                                  | —                                                                     | —                                   |

Selection is by environment variable only, documented in
[`.env.example`](.env.example), and every choice is printed by
`inkcast providers`. Rules the whole project keeps: **local is the default**, a
cloud provider is used only when its key is present _and_ selected, and a missing
or rejected key degrades with a clear log line — never a crash.

The one caveat to "works offline": the local voice needs a one-time ~92 MB model
download. If that download fails, the voice stage says so and falls back rather
than failing the run.

---

## CLI reference

```
cast <file|url|-> [options]          make a video
inkcast list                        list projects on disk
inkcast open <id>                   print a project and open its video
inkcast edit <id> "<instruction>"    patch the storyboard in plain English
inkcast rerender <id>                rebuild the video from the storyboard
inkcast preview <id> [--port 4321]   serve the project on localhost
inkcast providers                    show which provider each stage will use
```

Options: `--title`, `--aspect 16:9|9:16|1:1`, `--lang`, `--voice`, `--style
marker|pencil|chalk|ink`, `--palette mono|color`, `--out <path>`, `--project
<id>`, `--force`, `--open`, `--json`, `--verbose`, `--quiet`.

`<id>` accepts a unique id prefix, or `last`. Progress is a live bar on a TTY and
plain per-stage lines when piped or in CI. Exit codes: **0** success, **1** handled
failure, **2** bad usage. `--json` prints a single machine-readable object on
stdout and nothing else, which is the supported way to script Inkcast.

Failures name the stage that broke, keep the original cause, and suggest the fix:

```
✗ render stage failed
  ffmpeg exited with code 1
  → Install ffmpeg (macOS: `brew install ffmpeg`, Debian: `apt install ffmpeg`)
  Nothing is lost: re-run the same command to resume project f7e2cc6cc59d.
```

---

## Self-hosting

Inkcast is local-first, so "self-hosting" is just running it somewhere else. There
is no database, no queue and no object store — a project is a directory.

```bash
git clone <your fork> && cd inkcast
pnpm install
pnpm exec playwright install --with-deps chromium   # --with-deps on Linux
cp .env.example .env                                # optional; empty works
pnpm build                                          # the packages
pnpm --filter @inkcast/web build                    # the studio is a Next.js app
pnpm --filter @inkcast/web start                    # put your proxy in front of it
```

The CLI alone needs none of that: `pnpm cast <file>` works from a bare checkout.

Notes for a real deployment:

- **Disk, not CPU, is the surprise.** Frames are transient but audio, artwork and
  mp4s accumulate under `projects/`. Point `INKCAST_PROJECTS` at a volume you can
  grow, and prune old projects with `rm -rf`.
- **Rendering is CPU-bound.** `INKCAST_RENDER_WORKERS` trades RAM for wall-clock;
  each worker is a Chromium page.
- **Keys stay server-side.** Nothing in the pipeline needs a key in the browser,
  and no stage sends your source document anywhere unless you set a cloud key.
- **Any gate must be enforced by the endpoint that serves the file**, never by
  hiding a button — a client-side download gate is not a gate.
- **The AGPL applies to network use.** If you offer a modified Inkcast to users
  over a network, publish your modifications (see below).

---

## Contributing

Contributions are welcome, and the bar is concrete rather than ceremonial.

1. **Read [`docs/CONTRACT.md`](docs/CONTRACT.md) first.** It is short and binding:
   package boundaries, stage signatures, and the rules that keep parallel work
   from colliding.
2. **The Storyboard IR is the contract.** Do not reshape it. New fields are
   `.optional()` and must come with a reason.
3. **The zero-key path must keep working.** Every feature needs a local default.
   Cloud providers are opt-in adapters behind an env var; a missing key degrades
   with a warning, never a crash. `pnpm cast examples/gradient-descent.md` with no
   `.env` is the smoke test.
4. **No placeholders.** No `TODO: implement`, no function that throws "not
   implemented", no mock data standing in for logic. A smaller surface that
   genuinely runs beats a large one that is stubbed.
5. **Before opening a PR:** `pnpm typecheck` and `pnpm lint` (Prettier config is
   in `.prettierrc`, editor defaults in `.editorconfig`). New provider adapters
   should also state, in the PR, what happens when the key is absent.
6. **Renderer stays Playwright + ffmpeg.** Remotion is deliberately excluded — it
   requires a paid company licence above three employees, which is incompatible
   with what this project is for.

Good first contributions: a new ink style, another local voice engine, a document
format for `ingest`, a diagram layout, or better `--json` output for scripting.

---

## Why AGPL-3.0

Inkcast exists because this category is priced as if generating a whiteboard video
were expensive. It is not — it is a compiler, and compilers should be free. The
[AGPL-3.0](LICENSE) is what keeps it that way:

- **Improvements come back.** Anyone may use, study, modify and redistribute
  Inkcast. If they distribute it, or **run a modified version as a network
  service**, they publish their changes under the same licence. The plain GPL
  leaves that hosting loophole open; the AGPL closes it.
- **You are not restricted as a user.** Run it on your laptop, run it inside your
  company, cast a thousand internal training videos — the AGPL asks nothing of you
  until you distribute the software or offer it to others as a service.
- **Your videos are yours.** The licence covers this software, not its output.
  Inkcast makes no claim on the mp4s you produce or the documents you feed it.
- **It is the honest licence for the promise.** "Free alternative" only stays true
  if a hosted fork cannot take it private.

Copyright the Inkcast contributors. Licensed under the GNU Affero General Public
License v3.0 — the full text is in [`LICENSE`](LICENSE). Third-party components
keep their own licences, including Kokoro (Apache-2.0), Lucide icons (ISC) and
rough.js (MIT).
