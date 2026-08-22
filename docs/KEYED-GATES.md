# KEYED-GATES — the gates that cost money, and what each one buys

Written 2026-08-22 by the integration pass over `docs/PLAN-LAUNCH.md`. Every gate that can
run for free was run; their results are in `docs/STATUS.md` under the same date. This file
is the other half: the gates that need a funded provider key or a deployed box, so that
nothing on the list is silently skipped and later reported as passing.

**Read `## Before you run anything` first.** This repo has live keys in the macOS keychain
and `hydrateKeys()` copies them into `process.env` for almost every CLI command. It is
easier to spend money here by accident than on purpose.

## Before you run anything

`inkcast keys` reports live `anthropic`, `elevenlabs` and `fal` keys.
`packages/keyvault/src/hydrate.ts:57` copies them into `process.env` for every CLI command
except `keys`, `help` and `list`. `INKCAST_HOME` does **not** isolate them.

To run any _free_ gate without risk of a paid call, set all four provider variables to an
invalid but **non-empty** string — `hydrate.ts:77-82` treats a present value as
authoritative and will not overwrite it:

```sh
export ANTHROPIC_API_KEY=disabled-no-spend
export ELEVENLABS_API_KEY=disabled-no-spend
export FAL_KEY=disabled-no-spend
export REPLICATE_API_TOKEN=disabled-no-spend
```

An empty string is not enough. Unsetting is not enough. Every command in this file that is
marked FREE was run with exactly those four values set.

Never render into the real `projects/` directory. Copy the project you want to a scratch
dir and point `INKCAST_PROJECTS` at it. A keyed run rewrites `pipeline.json`, and the 22
recorded projects in `projects/` are the corpus every cost measurement in `docs/STATUS.md`
is derived from.

### Do not invoke the CLI through `pnpm cast --`

Measured, twice, by accident, while writing this file. `pnpm` mangles the arguments after
`--`, and the CLI never sees the flags you typed:

```sh
$ pnpm --filter @inkcast/cli exec node -e "console.log(process.argv.slice(2))" -- --preset explainer
[ 'explainer' ]                      # the flag name is gone; the value became a positional
```

Two consequences, both of which happened here:

- `pnpm cast -- <file> --preset explainer --json` dropped `--preset` and rendered at
  `standard`, reporting success. A flag that is silently discarded is worse than one that
  is rejected, and this is why the `explainer` mirror bug survived so long — the obvious way
  to test it cannot test it.
- `pnpm cast -- --version` dropped `--version` too, and the CLI read the leftover token as
  a **topic**. It authored and rendered a full four-beat lesson about "--version". That is a
  14-minute render and, with keys funded, a real bill for a typo.

Invoke the binary directly instead. Flags arrive intact:

```sh
npx tsx apps/cli/src/index.ts teach "gradient descent" --preset explainer
```

## What a full keyed run actually costs

Measured, not estimated — from `projects/cardiac8/pipeline.json`, a 174.1s film:

| stage     | cost        | provider                | basis                                         |
| --------- | ----------- | ----------------------- | --------------------------------------------- |
| lesson    | $0.279      | anthropic/claude-opus-5 | ~2,057 in + ~10,750 out tokens at $5/$25 MTok |
| voice     | $0.4286     | elevenlabs              | 1,948 chars at $0.00022/char (Creator list)   |
| visuals   | $0.003      | fal                     | 1 image at $0.003 each                        |
| **total** | **$0.7106** |                         |                                               |

Across the 22 recorded projects, a full keyed cast of a cardiac-sized lesson lands between
**$0.45 and $0.77**. The spread is almost entirely the lesson stage (output tokens vary
with beat count) and whether the voice stage reused cached audio.

Two things that make a run cheaper than the table, and are worth knowing before you budget
a gate:

- **Voice dominates.** At $0.00022/char, narration is 60% of a full run. A gate that only
  needs to see _pictures_ should never let the voice stage run — cast the lesson once, then
  use the drawing-lane gates below, which are a thousandth of the price.
- **A second run of the same project is nearly free.** Every stage is cached and keyed on
  its own material. `projects/cardiac8f` records $0.003 total because only one image was
  new. This is also the trap: see `## The phantom lesson cost` below.

---

## Gate 1 — the end-to-end film (the only gate that proves the product)

**Needs** `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `FAL_KEY`.
**Cost** ~$0.45–$0.77 per lesson. **Time** ~14 minutes for a 175s film.

```sh
mkdir -p /tmp/inkcast-gate && cp -R projects/cardiac8f /tmp/inkcast-gate/
INKCAST_PROJECTS=/tmp/inkcast-gate \
  npx tsx apps/cli/src/index.ts teach "the cardiac conduction system" --force
```

**Pass criterion.** Not "it completed". Five things, in this order, because each one can
pass while the next fails:

1. `pipeline.json` has a `cost.lines` entry for every stage its `skipped` array does _not_
   name, and none for any stage it does. See `## The phantom lesson cost`.
2. `providers.lesson` names the author that actually wrote it. **This field currently
   cannot be trusted and the gate must check it by hand** — see
   `## Provenance is still set before the call`. Read `lesson.objective`: if it matches the
   template at `packages/planner/src/lesson-derive.ts:464` ("explain in your own words how
   X works, and why each step of it is needed") then the local heuristic author wrote it,
   whatever `providers.lesson` says, and the lesson cost line is a phantom.
3. `providers.voice` names the engine that actually spoke, and `voice.observed` is `true`.
   If `voice.problems` is non-empty, the run was demoted and the film is Kokoro — which is
   fine, but it must say so. This one _is_ trustworthy: the voice lane returns its
   provenance rather than assuming it.
4. `npx tsx packages/render/src/inkstat.mts /tmp/inkcast-gate/cardiac8f/out.mp4` — mean ink
   coverage. **This tool takes a video file, not a project dir.** Do not use
   `fillcheck.mts`; it reports roughly 4× real density and its own header says so.
5. Open the last frame and look at it. The outro is the frame people screenshot. See
   `## Gate 4` for what is currently wrong with it.

**Do not run this to check a code change.** A change to the planner or the render lane is
provable for free — `sbhash.mts` for the storyboard, `frames.mts` for pixels. Spend this
gate on the _provider chain_, which is the only thing it can see that they cannot.

## Gate 2 — the drawing lane, without the film

**Needs** `FAL_KEY` only. **Cost** ~$0.003 per image. **Time** seconds.

This is the gate to actually use. `drawcheck.mts` resolves the visuals stage alone over a
storyboard already on disk, hydrating the vault the same way the CLI does, so the
illustration lane really generates and the drawings can be looked at — without the
four-minute keyed `cast` that every other pixel tool needs upstream of it.

```sh
npx tsx packages/pipeline/src/drawcheck.mts /tmp/inkcast-gate/cardiac8f
```

**Pass criterion.** The generated figure is recognisable as the thing that was asked for,
and — the specific defect this lane has failed on four times — the _fallback did not fire
silently_. Check what the tool reports about which provider answered, not which key was
set. `figuresheet.mts` and `underlaysheet.mts` hydrate the vault the same way and cost the
same, for the figure and underlay lanes specifically.

## Gate 3 — the lesson author, without voice or pictures

**Needs** `ANTHROPIC_API_KEY` only. **Cost** ~$0.28 per lesson at Opus pricing.

The gate for any edit to `teachingBrief()` or `DRAW_BRIEF`. **The brief is not in the cache
key** — this repo's trap #1 — so before running it, confirm `STAGE_CODE_VERSION.lesson` (or
`.draw`) in `packages/pipeline/src/keys.ts` was bumped in the same commit as the brief edit.
An unbumped brief edit is a silent no-op: the gate will cheerfully re-serve a cached lesson
authored under the old brief and report success.

```sh
grep -n 'lesson:\|draw:' packages/pipeline/src/keys.ts   # confirm the bump first
npx tsx packages/pipeline/src/lessonjson.mts <lesson-or-source>
```

**Pass criterion.** The word budget was honoured (`PLAN-GOLPO-PARITY` Phase 3: ~145 words
for a short film, not 348), and the beats ask for pictures the drawing lane can actually
draw — check with `npx tsx packages/planner/src/lanecheck.mts <lesson.json>`, which is FREE
and answers "did each beat that asked for a picture get its own?".

### Gate 3a — the `math` mark, which is currently unreachable

`packages/planner/src/drawing.ts` has a `math` builder, `packages/visuals/src/equation.ts`
has a `texError` guard, and both are tested and green. `DRAW_BRIEF` in
`packages/planner/src/draw-anthropic.ts` has **no `math` bullet**, so the capability cannot
be requested and is dead code — typeset mathematics is still drawn as handwriting, with the
caret as a literal caret.

This was deliberately not landed by the integration pass, and the reason is a spend
decision rather than a technical one: adding the bullet requires bumping
`STAGE_CODE_VERSION.draw`, which invalidates **every cached lesson in the corpus**, and the
next keyed run of each then pays the full lesson price again. That is a bill the repo's
owner should choose, not one an agent should impose on the way past. The exact bullet text
is recorded in `docs/STATUS.md` (2026-08-22).

**Pass criterion, when it is landed.** A lesson whose source contains a fraction or an
integral comes back with a `math` mark rather than a `label`, and the rendered frame shows
a set fraction rather than `\frac{a}{b}` in a handwriting font.

## Gate 4 — the outro frame, and the density question

**FREE**, and listed here only because the plan files it under a keyed gate it does not
need. `frames.mts` walks the same three calls `render()` makes and seeks a CDP capturer to
each timestamp, so it costs no encode and no key:

```sh
npx tsx packages/render/src/frames.mts /tmp/inkcast-gate/cardiac8f 175.9 176.2
```

**What is known to be wrong, and is still open.** A real outro frame shows text colliding
with pictures repeatedly — "spark starts here" written across the anatomy, "3 AV node (slow
doorway)" on top of the drawn heart, "non-conducting ring" over hatching — on a board only
24% full, with whole thirds of the canvas empty. That is a layout defect, it is free to
reproduce, and no key will help.

**What is settled and should not be re-attempted.** A4.3's 55% minimum-fill clamp is
arithmetically impossible and A1's ink gate cannot pass. Fill is the product of how much
frame the camera holds — capped by the 76.5% safe area — and how much of that the ink
covers, measured at 30–76% across the corpus, so 55% needs a coverage the corpus never
reaches. Enlarging figures moved mean ink by less than reporting precision and cost a hue.
The real lever is **killing the pale white card behind each generated figure**, which is a
free change to the render lane. Do not spend a keyed run on the clamp.

## Gate 5 — the deployed box (no key, but a real host)

**Needs** a deployed instance. **Cost** hosting only. All of this is blocked on the same
thing: nothing has ever been deployed.

`docker build` now completes as far as the workspace install and the runtime verification
step, and `docs/DEPLOY.md` is the 20-minute runbook. What cannot be checked from a laptop:

```sh
# On the box, after `docker compose up -d`:
curl -s https://<host>/api/health | jq .        # queue depth, disk bavail, limiter count
node scripts/loadtest.mjs --url=https://<host> --jobs=25 --depth=10
node scripts/janitor.mjs --dry-run              # then wire it in-process, see DEPLOY.md
```

**Pass criteria.**

- **`/api/keys` must 404.** `offOnHostedBox()` now guards all four handlers, so on a box
  with `INKCAST_HOSTED=1` a `GET /api/keys` returns 404 and not a list of the operator's
  credentials. This is the one item on this page that is a security check rather than a
  quality one, and it is cheap: one `curl`.
- **The session secret must be present or the box must refuse to serve.**
  `requireSessionSecret()` runs at module scope, so a missing `INKCAST_SESSION_SECRET` with
  `INKCAST_HOSTED=1` should fail _loudly at startup_, not serve 500s. `docker-compose.yml`
  now fails at `compose config` instead.
- **The p95 admission gate.** `loadtest.mjs`'s `admissionDepth()` reads each job's own queue
  position out of the SSE stream it is already following. Verified to discriminate: 8 jobs
  at `--depth=3` yields 5 eligible, not 8. A gate that reports all jobs eligible is
  measuring nothing — that was the bug.
- **Memory.** Inside the built image, `chromium.launch()` alone is 207 MB across 4
  processes and each 1920×1080 context adds ~160 MB. A 256 MB tier does not OOM at
  concurrency 2; it OOMs at `chromium.launch()`. There is no configuration escape hatch:
  `RenderOptions.concurrency` exists and nothing sets it, and `INKCAST_RENDER_WORKERS` is
  documented in `.env.example` and read by no code in the repo.

## Gate 6 — the spend ledger, which is still not wired

**FREE to test, and it needs no key at all** — which is why its absence is worth naming
here rather than filed under something expensive.

`packages/pipeline/src/spend.ts` is a complete, append-only NDJSON day ledger with 13 tests
including 40 concurrent bookings and 8 separate OS processes appending. It is now exported
from `packages/pipeline/src/index.ts`, so it can be reached. It is still **not called**:
`decide()` runs before no generation and `book()` after none, so past
`INKCAST_DAILY_USD` a run pays full price and nothing records the day's tally.

Until that lands, **`INKCAST_DAILY_USD` does nothing**. Do not rely on it as the guardrail
for any gate on this page. The exact call sites are in `docs/STATUS.md` (2026-08-22).

---

## The phantom lesson cost

Worth its own section because it is the one bug on this page that makes every _other_
number here wrong.

When the lesson came from cache, `design.author` stayed `'anthropic'` and `cast.ts` passed
the cached lesson's real character count to `costOf`, so the run was billed for a model
call it never made. `cost.ts`'s `authoredChars > 0` floor could not catch it: the cached
lesson is real text and its length is no evidence anybody paid for it.

Measured across the 22 recorded projects: `projects/cardiac` is the only one with `lesson`
in its own `skipped` array _and_ a lesson cost line — $0.2567 of a recorded $0.627, or 41%
of that project's total. `cast.ts` now passes
`lessonAuthored: design.author === 'anthropic' && !run.skipped.includes('lesson')`.

**So: any cost in a `pipeline.json` written before 2026-08-22 may be overstated**, and
`projects/cardiac`'s definitely is. When a keyed gate reports a price, check `skipped`
before believing it.

## Provenance is still set before the call

`docs/PLAN-LAUNCH.md` names this as a trap that has already cost the project four silent
failures. It is still live for the **lesson** and **figure** lanes, and it was reproduced
here by accident, with hard evidence, at zero cost. This is the most important open item on
this page, because it is the one that makes every other number untrustworthy.

`packages/pipeline/src/cast.ts:485` is `author = adapter`, where `adapter` comes from
`resolveLessonAdapter(lessonOpts)` — a decision made from _which environment variables are
set_, before any call happens. `packages/planner/src/lesson.ts:86-90` then does this:

```
if (adapter === 'anthropic') {
  lesson = await anthropicLesson(input, opts, preset.maxSeconds);
  if (!lesson) log.warn('the model did not produce a usable lesson — deriving one instead');
}
if (!lesson) lesson = deriveLesson(input, opts, preset);
```

The fallback is a `log.warn` and nothing else. `teachLesson` returns a bare `Lesson`, so
there is no channel by which cast.ts could learn that the model never answered.

### The reproduction, in full

Running the CLI with `ANTHROPIC_API_KEY=disabled-no-spend` — an invalid key — produced a
project whose `pipeline.json` said:

```
providers: { "lesson": "anthropic/claude-opus-5", "planner": "anthropic/claude-opus-5", … }
cost.lines: [{ "stage": "lesson", "provider": "anthropic/claude-opus-5", "usd": 0.0178,
               "basis": "~2000 in + ~313 out tokens at $5/$25 per MTok" }]
lesson.problems: []
```

Every one of those three lines is false. The lesson was written locally: its `objective`
was `"explain in your own words how --version works, and why each step of it is needed"`,
which is the template literal at `packages/planner/src/lesson-derive.ts:464` — the
_heuristic_ author. No model was called, no money was owed, $0.0178 was booked, and
`problems` was empty, so nothing anywhere reported the demotion.

Note what this means for the fix landed on 2026-08-22. `cast.ts` now passes
`lessonAuthored: design.author === 'anthropic' && !run.skipped.includes('lesson')`, which
correctly kills the _cached-lesson_ phantom. It cannot help here, because `design.author` is
itself the lie: it says `'anthropic'` for a lesson Anthropic never saw. The two bugs share a
symptom and have different causes, and only one of them is fixed.

### What the real fix is

`teachLesson` must return what authored, not what was configured — the same shape the voice
lane already uses. `voiceRecordOf` (`cast.ts:1215`) is the pattern to copy: it takes a
`ResolvedVoice` carrying `spoke`, `charsByProvider` and `problems` _observed inside the
stage_, and it deliberately inherits the previous record rather than re-deriving from the
environment, with a comment explaining that re-deriving "is exactly how a project voiced by
the free engine came to be recorded, and billed, as a paid one". That is this bug, in the
lane where it was already fixed.

The figure lane has the same gap and no observation point at all: `providers.images` is
`provs.images.name`, the configured head of the chain, and `Asset` in
`packages/core/src/storyboard.ts:72` has a `source` enum but **no field naming which
provider drew it**. The billed _count_ is honest — `generatedAssets` is diffed against the
assets present before the stage ran — but the attribution is not.

This was not fixed by the integration pass, deliberately: it is a cross-package signature
change through the stage contract, it moves storyboard content for any project with
generated assets, and verifying that a fallback is reported correctly requires _making a
fallback happen_, which needs a funded key and a deliberately broken one. It is a keyed
gate, which is why it is written down here.

**Pass criterion, when it lands.** With a funded `ANTHROPIC_API_KEY` and a deliberately
invalid one, the two runs must differ in `pipeline.json`: the invalid one must record the
heuristic author in `providers.lesson`, a non-empty `lesson.problems`, and **no lesson cost
line at all**. If those three do not all change together, the fix is incomplete.
