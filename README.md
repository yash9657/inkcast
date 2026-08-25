# Inkcast

**Say what you want to understand. Get a hand-drawn whiteboard lesson that actually
teaches it.**

```bash
inkcast keys set anthropic          # the step that makes it good
inkcast teach "gradient descent"    # -> projects/<id>/out.mp4
```

Inkcast is a **compiler**, not a video model. A topic goes in; a lesson is designed;
that lesson is compiled into a storyboard of curves, drawn ink and moving objects on
one persistent canvas; the storyboard is drawn frame by frame in a headless browser
and muxed with ffmpeg. Everything you see is vector strokes, real text and measured
audio, generated deterministically from an intermediate representation you can read,
edit and diff. No proprietary video model is involved anywhere.

It runs with no API keys at all. That is worth keeping and it is **not** the
recommended way to use it — see [What we claim](#what-we-claim-and-what-we-do-not),
which is the most important section in this file.

---

## Contents

- [Set up your key first](#set-up-your-key-first)
- [Quickstart](#quickstart)
- [What we claim, and what we do not](#what-we-claim-and-what-we-do-not)
- [The lesson stage: why summarising was the wrong model](#the-lesson-stage-why-summarising-was-the-wrong-model)
- [What the board can draw: plot, path, motion](#what-the-board-can-draw-plot-path-motion)
- [Vertical shorts are a first-class output](#vertical-shorts-are-a-first-class-output)
- [Architecture](#architecture)
- [The Storyboard IR](#the-storyboard-ir)
- [Editing: the lesson, then the drawing](#editing-the-lesson-then-the-drawing)
- [Cost, honestly](#cost-honestly)
- [Provider matrix](#provider-matrix)
- [CLI reference](#cli-reference)
- [Self-hosting](#self-hosting)
- [Contributing](#contributing)
- [Why AGPL-3.0](#why-agpl-30)

---

## Set up your key first

This is step one, before the quickstart, because it is the difference between a
video that teaches and a video that recites.

```bash
inkcast keys set anthropic        # prompted, hidden, never echoed or logged
inkcast keys list                 # masked previews and where each key lives
inkcast keys validate             # one cheap live call per configured provider
inkcast keys delete anthropic     # forget it
```

Keys are stored in your **macOS keychain**, or in an AES-256-GCM vault file
(`~/.inkcast/vault.json`, `0600`) on other platforms. The CLI and the studio share
one store, so you set a key once. An exported `ANTHROPIC_API_KEY` always wins over a
stored one — `inkcast keys list` tells you which is winning, because a shadowed
credential you cannot see is worse than no credential.

Bring your own key: Inkcast has no account, no proxy and no telemetry. Your key goes
to Anthropic and nowhere else, and your source material never leaves the machine
unless you set a cloud key.

Two other keys are optional upgrades: `elevenlabs` for a publishable narrator, and
`replicate` or `fal` for illustrated objects and characters. Neither changes whether
the lesson is any good.

---

## Quickstart

**Requirements:** Node 22+, pnpm 10+, and `ffmpeg` on your `PATH`
(`brew install ffmpeg` / `apt install ffmpeg`). Chromium is fetched by Playwright.

```bash
pnpm install
pnpm exec playwright install chromium     # ~150 MB, once per machine
inkcast keys set anthropic                # see above
inkcast teach "gradient descent"          # -> projects/<id>/out.mp4
pnpm dev                                  # the studio, at localhost:3000
```

The first run also downloads the local text-to-speech weights (Kokoro-82M, ~92 MB,
cached and shared across projects).

```bash
# a 45-second vertical short, one idea, one visual, one payoff
inkcast teach "why neural nets need a non-linearity" --short --depth quick

# teach from material you already have
cast ./docs/architecture.md --depth deep
cast https://en.wikipedia.org/wiki/Backpropagation --short

# read the lesson before you trust the video, then edit it and re-run
inkcast lesson last

# render a hand-authored lesson: no model, no key, fully deterministic
cast examples/lessons/gradient-descent.lesson.json
```

Check what your machine will actually do, and what it is giving up:

```bash
inkcast providers
```

```
STAGE       PROVIDER              WHERE  WHY
lesson      anthropic/claude-…    cloud  ANTHROPIC_API_KEY is set
storyboard  local compiler        local  plots, ink, regions and camera are computation
voice       kokoro/af_heart       local  ELEVENLABS_API_KEY is unset
visuals     builtin               local  no image provider key set
render      playwright + ffmpeg   local  ffmpeg found: ffmpeg version 8.1.2
```

---

## What we claim, and what we do not

The first version of this README headlined **$0.00 per minute** while shipping
something that taught nothing. Optimising for the free provider was the wrong
variable, and we are not going to make that mistake twice. So, plainly:

**With an Anthropic key**, Claude writes the lesson: a hook that is a concrete
question rather than a definition, an everyday anchor the abstraction maps onto, one
new idea per beat with a reason instead of an assertion, a worked example with real
numbers, and the specific misconception a learner forms — then the plan has to
survive a structural critique, and problems are fed back for a revision pass before
anything is drawn. This is the product. It costs a few cents per video.

**With no key**, the lesson is _derived_ from the structure of what you gave it. It
is real, it renders, and it is much weaker: it can only reorganise what the source
already says. No invented anchor, no worked example, no named misconception. On a
bare topic with no document it has almost nothing to work from. The CLI says so
before it starts, and tells you the one command that fixes it:

```
degraded lesson — no Anthropic key. the lesson is derived from structure rather than
         taught from first principles — no invented anchor, no worked example, no
         named misconception. This is the biggest single quality difference in Inkcast.
         fix: inkcast keys set anthropic
```

The zero-key path exists so the renderer can be tested, so a contributor can work
without spending money, and so nothing about Inkcast is gated behind a payment. It
is a floor, not the ceiling.

**Also honest about the gaps**, because "teaches literally any concept" would be a
lie today:

- Maths, CS, ML, physics, economics and statistics are well served: they are mostly
  curves, and curves are what the IR is now best at.
- Narrative subjects — the Odyssey, the French Revolution — need drawn characters
  who stay the same person across poses. The IR can represent them and cache them by
  id, but identity across poses is not solved, needs an image key, and has no
  zero-key fallback worth the name. See `docs/LESSON-ENGINE.md`.
- The honest quality bar we hold ourselves to is one question, and it is in that
  document: after watching the gradient-descent video, can a learner who does not
  know calculus explain why the update has a minus sign?

---

## The lesson stage: why summarising was the wrong model

The MVP went straight from document to storyboard. That made the planner a
**summariser**: it chopped prose into beats and read them aloud. Summarising and
teaching are different algorithms, and no amount of visual polish rescues a video
that never builds an idea. A learner watched our gradient-descent output and learned
nothing.

So there is now a stage whose only job is deciding what to teach, and it runs before
anything is drawn:

```
ingest → lesson → storyboard → voice → visuals → render
```

A `Lesson` (`packages/core/src/lesson.ts`) is deliberately **not** a document
outline. Its shape is the pedagogy:

| Field           | What it is                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `objective`     | What the learner must be able to _do_ afterwards. The acceptance test.                                                                          |
| `hook`          | A concrete question or surprise in the first five seconds. Never a definition, never "in this video we will".                                   |
| `anchor`        | An everyday situation the learner already understands — hiking downhill in fog — that every later abstraction maps back onto.                   |
| `steps[]`       | One new idea each, ordered so nothing forward-references. Each carries the idea, **why it must be true**, and the visual that makes it obvious. |
| `worked`        | A walkthrough with real numbers. Where understanding consolidates.                                                                              |
| `misconception` | The specific wrong belief formed here, named and refuted. For gradient descent: that it finds _the_ minimum.                                    |
| `recap`         | The chain retraced against the finished board.                                                                                                  |
| `jargonBudget`  | Terms that must be earned before they are used.                                                                                                 |

`critiqueLesson()` rejects the predictable failures — a beat that asserts without
justifying, a hook that opens with a preamble, jargon used before it is earned, a
beat with nothing to look at, a plan that overruns its target. With a key, the
critique is fed back for one revision pass; either way the problems are printed
rather than hidden.

**The lesson is an artefact you own.** It is written to `projects/<id>/lesson.json`.

```bash
inkcast lesson last          # print it: every beat, its reason, its visual, the critique
$EDITOR projects/<id>/lesson.json
inkcast teach "gradient descent" --project <id>   # your edits survive; the board rebuilds
```

Re-running keeps your edited lesson (its cache key is unchanged), recompiles the
board because the storyboard's key follows the lesson's _content_, re-voices only
the beats whose words changed, and re-renders. Editing the storyboard changes the
drawing; editing the lesson changes the teaching, which is usually what you meant.

`examples/lessons/*.lesson.json` are hand-authored lessons. `cast
some.lesson.json` renders one with no planner, no model and no key — useful as a
fixture, and as a demonstration of the ceiling.

---

## What the board can draw: plot, path, motion

The old vocabulary was text, icons, rectangles, arrows and box-and-line diagrams. It
could not express a curve, a tangent, a bowl, or anything moving — which is why
every "explain a concept" video collapsed into captions in boxes. The planner was
never the binding constraint; the vocabulary was.

Three additions do most of the work, and all three are **local, free and
deterministic**:

- **`plot`** — a cartesian frame with hand-drawn axes, curves (explicit samples or a
  named function: `parabola`, `sigmoid`, `gaussian`, `doubleWell`, `exp`, `log`, …)
  and overlays that serve an argument rather than decorate it: a marked `point`, a
  `tangent` at x (this is how you show slope, and therefore the whole intuition
  behind a gradient), a `dropline` for reading a value off an axis, `shade` between
  curves, `steps` for a descent, and `annotate` with a leader line. Gradient
  descent, learning rate, overfitting, compound interest and supply/demand are each
  _one_ `plot`.
- **`path`** — a freeform hand-drawn stroke from points or SVG path data, roughened
  to match the ink. The escape hatch for whatever the vocabulary lacks: a hillside,
  a bowl, a container, a brace, a squiggle.
- **`motion`** — any element moving along a path over a time window, with easing and
  an optional dotted trail. The ball descending the loss curve teaches more than any
  caption about it, and before this nothing on the board could move.

Named functions exist so the planner can ask for "a bowl" without emitting a hundred
coordinates — and so there is never an expression evaluator in the pipeline: no
`eval`, no injection surface, identical output every run.

`illustration` assets (drawn objects and characters, resolved through
text-to-image → vectorise → roughen, cached by id so a reused entity is
pixel-identical) need an image key. Without one, that lane falls back to the
built-in icon set and says so.

Two older properties still hold and are the reason the board reads as an argument
rather than a slideshow:

- **One persistent canvas.** Elements default to `persist: true`, scenes move a
  _camera_ over one large board, and consecutive beats share a `region` so the
  camera frames the growing union of what has been drawn. The accumulated board at
  the end _is_ the summary — that is the entire reason to use a whiteboard instead
  of slides.
- **Silence is modelled.** `Scene.hold` is real silence rendered into the clip, so a
  beat can land before the next idea arrives and a question can hang long enough for
  the learner to attempt an answer. Narration is paced for teaching (140–160 wpm),
  and beats never split a sentence.

---

## Vertical shorts are a first-class output

`--short` is not a cropped 16:9 video. Short-form vertical is the highest-leverage
way to distribute teaching, and the constraint improves the product: 45–60 seconds
forces one idea, one visual, one payoff.

```bash
inkcast teach "why the sky is blue" --short --depth quick --out shorts/
```

The `short` preset changes the _lesson_, not just the frame: fewer beats survive,
each may speak fewer words (trimmed only ever at a sentence boundary — the MVP cut
mid-sentence and produced fragments like "under you gets gentler"), each beat draws
exactly one visual, type is larger, and the camera walks down a tall canvas rather
than panning across a wide one. `--depth quick|standard|deep` scales the runtime
target on top of that, and `--seconds <n>` sets a hard one for platforms that cut
you off.

---

## Architecture

```
              ┌────────┐  SourceDoc  ┌────────┐  Lesson  ┌────────────┐
  topic ─────►│        │ ──────────► │        │ ───────► │            │
  file  ─────►│ ingest │             │ lesson │          │ storyboard │
  URL   ─────►│        │             │        │          │            │
  lesson.json─┴────────┘             └────────┘          └────────────┘
              @inkcast/planner       Claude, or a         one scene per beat:
              (skipped for a         local derivation     plots, ink, regions,
               bare topic)           + critique + revise  cues, camera
                                                                │
                                                     Storyboard │
                                                                ▼
   ┌────────┐            ┌─────────┐                       ┌────────┐
   │ render │ ◄───────── │ visuals │ ◄──────────────────────┤ voice  │
   └────────┘  + strokes └─────────┘  + durationSec         └────────┘
   @inkcast/render       @inkcast/visuals   + resolved cues  @inkcast/voice
   Playwright frames     plots, paths, ink, icons,           Kokoro locally,
   + ffmpeg mux          or a text-to-image model            or ElevenLabs
```

**Voice runs before visuals and render, and that ordering is load-bearing.** The
voice stage synthesises narration in phrases, measures the real audio into
`scene.durationSec`, and resolves every `Enter.cue` — a verbatim phrase of the
narration — into the fraction of the scene where those words are actually spoken.
The MVP was sample-accurate at the _beat_ level and still felt misaligned, because
element timing was a fraction the planner guessed; a diagram arriving two seconds
before the sentence that names it is experienced as drift. Nothing may be drawn or
rendered against unresolved timing.

Every stage **only enriches the storyboard**. That single property buys three
things:

- **Resumability.** Artefacts are saved after every stage and each stage's inputs are
  hashed into `cache.json`. Crash during render and you re-render; everything before
  it is already done. Cast the same thing twice and the second run does nothing.
  Cache keys include a **code version** for the pipeline and for each stage, because
  hashing only the inputs meant a shipped fix kept serving the old artefact and
  looked like it had not worked. That bug cost us a day; it cannot recur.
- **Editability.** An edit is a patch to JSON — to the lesson for teaching, to the
  storyboard for drawing — and a re-render is a pure function of it.
- **Progress you can trust.** Stages report their own 0–100; the pipeline squashes
  them into one monotonic number weighted by real wall-clock share (render is 48% of
  it, the lesson stage 10%), which is what the CLI bar and the studio's SSE stream
  both display.

```
packages/core        the Storyboard IR, the Lesson IR + critique, logging, cache
packages/planner     ingest + teachLesson + compileLesson
packages/keyvault    BYOK credential storage, shared by the CLI and the studio
packages/voice       narrate — synthesis, measurement, cue resolution
packages/visuals     resolveVisuals — plots, paths, ink, motion, assets
packages/render      render — Playwright + ffmpeg
packages/pipeline    the orchestrator: teach / cast / designLesson / rerender
apps/cli             inkcast / cast
apps/web             the studio (Next.js)
examples/            source documents, hand-authored lessons, a hand-written storyboard
projects/<id>/       one directory per video (gitignored)
```

A project directory is the whole state of a video — no database:

```
projects/8f2ac1d0b3e4/
├── lesson.json        what it teaches. Edit this one.
├── storyboard.json    the IR, after the last stage that touched it
├── source.json        the ingested document (absent for a bare topic)
├── audio/scene-*.wav  one clip per scene, plus measured phrase timings
├── frames/            transient capture space
├── preview.html       the deterministic page the frames came from
├── cache.json         input + code-version hashes per stage
├── pipeline.json      title, timings, cost, provider choices, lesson summary
└── out.mp4            the video
```

Copy that directory to another machine and it still renders. `inkcast list` rebuilds
the library from disk on every call, so a finished video cannot be lost.

Programmatic use:

```ts
import { teach, cast, designLesson, rerender } from '@inkcast/pipeline';

// The normal case.
const { videoPath, lesson, problems } = await teach('gradient descent', {
  objective: 'explain why the update has a minus sign',
  preset: 'short',
  onProgress: (p) => console.log(p.stage, `${p.pct}%`, p.note ?? ''),
});

// Review the teaching before paying for a render (one model call, no frames).
const design = await designLesson({ filePath: 'paper.pdf', depth: 'deep' });

// A hand-authored lesson: no planner, no key.
await cast({ lesson: 'examples/lessons/gradient-descent.lesson.json' });

await rerender(design.projectId);
```

---

## The Storyboard IR

`packages/core/src/storyboard.ts` is the one contract every stage agrees on. It is a
zod schema, so it validates at every boundary.

```jsonc
{
  "version": 1,
  "title": "Gradient descent",
  "meta": { "aspect": "9:16", "style": "marker", "voice": "af_heart", "fps": 30 },
  "canvas": { "x": 0, "y": 0, "w": 1080, "h": 3600 }, // ONE board; the camera tours it
  "assets": [],
  "scenes": [
    {
      "id": "beat-003",
      "role": "step", // the pedagogical job this beat does
      "region": "slope", // consecutive beats share a region, so the board accumulates
      "narration": "Lay a straight edge against the curve where you are standing.",
      "hold": 0.8, // real silence after the words, so the idea lands
      "camera": { "x": 540, "y": 1400, "zoom": 1.4, "transition": 0.9 },
      "elements": [
        {
          "id": "loss",
          "type": "plot",
          "at": { "x": 80, "y": 1150, "w": 920, "h": 620 },
          "xDomain": [-4, 4],
          "yDomain": [0, 16],
          "xLabel": "one dial",
          "yLabel": "how wrong we are",
          "curves": [{ "id": "bowl", "fn": { "name": "parabola", "params": [1] } }],
          "overlays": [
            { "kind": "point", "curveId": "bowl", "x": 3, "at": 0.1 },
            { "kind": "tangent", "curveId": "bowl", "x": 3, "span": 1.5, "at": 0.55 },
          ],
          "enter": { "cue": "straight edge", "style": "draw" }, // resolved by the voice stage
        },
      ],
    },
  ],
}
```

| Concept       | What it is                                                       | Why it is shaped that way                                                 |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `canvas`      | One coordinate space for the whole video                         | Scenes tour it with a camera instead of clearing it                       |
| `region`      | Which patch of board a beat draws into                           | Consecutive beats share one, so the camera frames a growing union         |
| `role`        | hook / anchor / step / worked / misconception / recap            | The lesson's structure survives into the drawing                          |
| `hold`        | Seconds of deliberate silence after the narration                | A breath before the next idea; otherwise every gap is unintended dead air |
| `elements`    | text, asset, shape, arrow, diagram, emphasis, **plot**, **path** | `emphasis` targets an element drawn earlier by id                         |
| `motion`      | Optional on any element: waypoints, window, easing, trail        | Movement is most of what makes an explanation legible                     |
| `persist`     | Defaults to `true`                                               | The board accumulates; that is the whole point                            |
| `enter.cue`   | A verbatim phrase of this beat's narration                       | The element lands on the words that introduce it                          |
| `enter.at`    | Fraction of the scene, 0–1; the fallback when a cue is absent    | Survives re-voicing in another language or voice                          |
| `assets[]`    | Entity library, `id` + `seed`                                    | One entity, one look, forever                                             |
| `durationSec` | Written by the voice stage                                       | Measured, never estimated                                                 |

`examples/storyboard-handwritten.json` is a complete storyboard written by hand —
the fastest way to exercise voice, visuals and render with no planner in the loop:

```bash
mkdir -p projects/handwritten
cp examples/storyboard-handwritten.json projects/handwritten/storyboard.json
inkcast rerender handwritten && inkcast preview handwritten
```

---

## Editing: the lesson, then the drawing

Two levels, and picking the right one saves you a fight:

```bash
# the teaching — edit projects/<id>/lesson.json, then re-cast
inkcast lesson last
inkcast teach "gradient descent" --project <id>

# the drawing — plain-English patches to the storyboard
inkcast edit last "scene 3 narration: slow down and give a concrete example"
inkcast edit last "make it vertical; use pencil; voice: am_puck"
inkcast rerender last
```

With a key, Claude maps free-form instructions onto a small list of typed edit
operations. **With no key, editing still works**: instructions are matched locally
against documented patterns (title, narration, insert / delete / move scene, zoom,
voice, language, style, palette, aspect, fps, outro, pacing, element text). Either
path ends in the same deterministic applier with the zod schema as its gate, and
`inkcast edit` prints the patterns it understands if it cannot parse yours.

Editing narration clears that scene's measured audio; changing the voice or language
clears all of it — so the cache can never serve a duration belonging to a clip you
no longer have.

---

## Cost, honestly

Quality first, price second — that ordering is the correction. What a run costs:

| Stage      | Local default                         | Cloud upgrade                  | Published list price       |
| ---------- | ------------------------------------- | ------------------------------ | -------------------------- |
| lesson     | derived from structure (much weaker)  | `claude-opus-5`                | ~$0.03–0.15 per video      |
| storyboard | the compiler — always local           | —                              | —                          |
| voice      | Kokoro-82M via `kokoro-js`            | ElevenLabs, Creator tier       | ~$0.19 per finished minute |
| visuals    | built-in icons + procedural plots/ink | FLUX-class on Replicate / fal  | ~$0.003 per image          |
| render     | Playwright + ffmpeg, your CPU         | — (there is no cloud renderer) | —                          |

The configuration we recommend — **Anthropic for the lesson, everything else local**
— costs a few cents per video and nothing per minute of runtime. Adding a cloud
voice puts you in the region of **$0.20 per finished minute**, which is where the
per-minute figure actually comes from. A fully local run costs exactly $0.00 and is
the weakest output Inkcast produces; that is a floor for development and CI, not a
recommendation.

The CLI prints the arithmetic after every run:

```
  cost       ~$0.06 (estimated · lesson anthropic/claude-opus-5 $0.0612 · $0.041/min)
  cost       $0.00 — nothing left this machine
```

Cloud figures are **estimates from observed quantities** (characters sent, lesson
JSON produced, characters spoken, images generated) times published list prices —
not an invoice. A supplied lesson is never charged for, even with a key set, because
the model never ran.

For context, commercial whiteboard-video tools publish $1.25–$8.00 per finished
minute (Golpo AI: $2.00, from its own API pricing, researched 2026-07-28 — see
`docs/research/golpo-ux.md`). Those are their list prices, not our measurements, and
volume bundles beat them. The point is not the multiple: it is that subscription
tiers _gate capability_ — colour, length, script editing, voice cloning, frame edits
each behind a different price point. Inkcast has no tiers.

---

## Provider matrix

| Stage      | Runs local & free                                            | Key                  | What the key buys                                                                         | Missing key behaviour                           |
| ---------- | ------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| ingest     | ✅ always                                                    | —                    | —                                                                                         | —                                               |
| lesson     | ⚠️ derived from structure                                    | `anthropic`          | **The teaching itself**: anchor, derivation, worked example, misconception, revision pass | Derived lesson, and the CLI names the cost      |
| storyboard | ✅ always — plots, ink, regions, cues, camera                | —                    | —                                                                                         | —                                               |
| voice      | ✅ Kokoro-82M (28 voices; macOS `say` only as a build check) | `elevenlabs`         | More natural prosody, more languages, cloning                                             | Kokoro, which is genuinely listenable           |
| visuals    | ✅ plots, paths, procedural diagrams, built-in icons         | `replicate` or `fal` | Illustrated objects and characters                                                        | Icon fallback, stated plainly rather than faked |
| render     | ✅ Playwright + ffmpeg                                       | —                    | —                                                                                         | —                                               |

Set keys with `inkcast keys set <provider>`, or export the environment variable
(`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `REPLICATE_API_TOKEN`, `FAL_KEY`) — see
[`.env.example`](.env.example). Rules the whole project keeps: **local is always
available**, a cloud provider is used only when its key is present, a missing or
rejected key degrades with a clear line naming the fix — never a crash — and no
degradation is ever silent.

The one caveat to "works offline": the local voice needs a one-time ~92 MB model
download. If it fails, the voice stage says so and falls back rather than failing.

---

## CLI reference

```
inkcast teach <topic> [options]        design a lesson and render it
cast <file|url|topic|lesson.json|->    same pipeline, from material you have
inkcast lesson <id>                    print what a project teaches, and how to edit it
inkcast keys [list|set|validate|delete] manage API keys (shared with the studio)
inkcast list                           list projects on disk
inkcast open <id>                      open a project's video
inkcast edit <id> "<instruction>"      patch the storyboard in plain English
inkcast rerender <id>                  rebuild the video from the storyboard
inkcast preview <id> [--port 4321]     serve a preview page on localhost
inkcast providers                      what each stage will use, and what it gives up
```

Lesson options: `--depth quick|standard|deep`, `--objective`, `--audience`,
`--brief`, `--seconds <n>`, `--lesson <path>`.
Format options: `--short`, `--aspect 16:9|9:16|1:1`, `--preset standard|short|square`,
`--title`, `--voice`, `--lang`, `--style <id>` (the ids in `styles/`: `marker`,
`pencil`, `chalk`, `ink`, plus any you add), `--palette mono|color`.
Run options: `--out`, `--project`, `--force`, `--open`, `--json`, `--verbose`,
`--quiet`, `--via lesson|document`.

`<id>` accepts a unique prefix or `last`. Progress is a live bar on a TTY and plain
per-stage lines when piped. Exit codes: **0** success, **1** handled failure, **2**
bad usage. `--json` prints one machine-readable object and nothing else, which is
the supported way to script Inkcast.

`--via document` skips the lesson stage and summarises the source instead. It is the
renderer's zero-key test fixture, kept because the frame compiler needs something
stable to be tested against. It is not a route to a video worth watching, and the
CLI labels its output accordingly.

Failures name the stage that broke, keep the original cause, and suggest the fix:

```
✗ render stage failed
  ffmpeg exited with code 1
  → Install ffmpeg (macOS: `brew install ffmpeg`, Debian: `apt install ffmpeg`)
  Nothing is lost: re-run the same command to resume project f7e2cc6cc59d.
```

---

## Self-hosting

Inkcast is local-first, so "self-hosting" is just running it somewhere else. No
database, no queue, no object store — a project is a directory.

```bash
git clone <your fork> && cd inkcast
pnpm install
pnpm exec playwright install --with-deps chromium   # --with-deps on Linux
pnpm build
pnpm --filter @inkcast/web build
pnpm --filter @inkcast/web start                    # put your proxy in front of it
```

Notes for a real deployment:

- **Keys.** On a headless box the keyvault uses its encrypted file backend and needs
  `INKCAST_VAULT_PASSPHRASE` (or `INKCAST_VAULT_PASSPHRASE_FILE`); exporting
  `ANTHROPIC_API_KEY` directly also works and takes precedence. Keys stay
  server-side: nothing in the pipeline needs one in the browser.
- **Disk, not CPU, is the surprise.** Frames are transient but audio, artwork and
  mp4s accumulate under `projects/`. Point `INKCAST_PROJECTS` at a volume you can
  grow, and prune with `rm -rf`.
- **Rendering is CPU-bound.** `INKCAST_RENDER_WORKERS` trades RAM for wall-clock;
  each worker is a Chromium page.
- **Any gate must be enforced by the endpoint that serves the file**, never by
  hiding a button.
- **The AGPL applies to network use.** If you offer a modified Inkcast to users over
  a network, publish your modifications.

---

## Contributing

Contributions are welcome, and the bar is concrete rather than ceremonial.

1. **Read [`docs/CONTRACT.md`](docs/CONTRACT.md) and
   [`docs/LESSON-ENGINE.md`](docs/LESSON-ENGINE.md) first.** The first is the build
   contract: package boundaries, stage signatures, the rules that keep parallel work
   from colliding. The second is the diagnosis of why the MVP taught nothing and the
   plan that follows from it. Both are binding.
2. **The Storyboard IR and the Lesson IR are the contracts.** Do not reshape them.
   New fields are `.optional()` and must come with a reason.
3. **Judge changes by whether a learner understands afterwards**, not by whether the
   output looks busier. The benchmark is in `docs/LESSON-ENGINE.md`.
4. **The zero-key path must keep working** — and must keep saying that it is the
   lesser path. Every feature needs a local default; cloud providers are opt-in
   adapters; a missing key degrades with a clear line naming the fix, never a crash.
5. **No placeholders.** No `TODO: implement`, no function that throws "not
   implemented", no mock data standing in for logic.
6. **Before opening a PR:** `pnpm typecheck`, `pnpm lint`, and the tests for the
   packages you touched (`pnpm --filter @inkcast/pipeline test`). New provider
   adapters should state, in the PR, what happens when the key is absent.
7. **Renderer stays Playwright + ffmpeg.** Remotion is deliberately excluded — it
   requires a paid company licence above three employees, which is incompatible with
   what this project is for.

Good first contributions: a hand-authored lesson in `examples/lessons/` for a topic
you know well (no key needed, and the most useful thing you can add), a new named
curve function, **an ink style — a JSON file in `styles/` and no TypeScript at all**,
another local voice engine, a document format for `ingest`, or better `--json` output
for scripting.

---

## Why AGPL-3.0

Inkcast exists because this category is priced as if generating a whiteboard video
were expensive. It is not — it is a compiler, and compilers should be free. The
[AGPL-3.0](LICENSE) is what keeps it that way:

- **Improvements come back.** Anyone may use, study, modify and redistribute
  Inkcast. If they distribute it, or **run a modified version as a network
  service**, they publish their changes under the same licence. The plain GPL leaves
  that hosting loophole open; the AGPL closes it.
- **You are not restricted as a user.** Run it on your laptop, run it inside your
  company, teach a thousand internal training videos — the AGPL asks nothing of you
  until you distribute the software or offer it to others as a service.
- **Your videos are yours.** The licence covers this software, not its output.
  Inkcast makes no claim on the mp4s you produce or the documents you feed it.
- **Your keys are yours.** Bring your own key, stored in your own keychain. There is
  no Inkcast account, no proxy in front of the model, and no telemetry.

Copyright the Inkcast contributors. Licensed under the GNU Affero General Public
License v3.0 — the full text is in [`LICENSE`](LICENSE). Third-party components keep
their own licences, including Kokoro (Apache-2.0), Lucide icons (ISC) and rough.js
(MIT).
