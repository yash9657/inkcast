# Inkcast build contract

**Every agent working on this repo MUST read this file first and obey it exactly.**
It exists so a dozen people can build in parallel without stepping on each other.

## What we are building

Open-source AI explainer videos: documents or a prompt in, hand-drawn whiteboard
video with synced narration out. A free alternative to tools charging $1.25–8.00
per finished minute; our marginal cost target is **under $0.20/minute**, and
**$0.00 with fully local models**.

The product is a **compiler**, not a model. Text → Storyboard IR → animated
frames → mp4. There is no proprietary video model and we do not need one.

## The one contract: the Storyboard IR

`packages/core/src/storyboard.ts` is the schema. **It is already written. Do not
change its shape.** If you genuinely need a new field, add it as `.optional()`
and say so in your final report.

Read it before writing any code. Key ideas you must respect:

- **One persistent canvas, not slides.** Scenes move a `camera` around a single
  large canvas. Elements default to `persist: true` and stay on the board so
  later scenes can annotate them. Wiping the board every scene is the single
  biggest quality failure of competing tools — do not reintroduce it.

  **Re-amended 2026-08-27: the amendment below is superseded and accumulation is
  the default again, on every preset the studio ships.** The 55.5% → 62.3% fill
  measurement that bought `wipe` was taken with `fillcheck`, whose `cover` term is
  a union of bounding boxes and therefore cannot see lines, arrows or a
  label-heavy card — it rewarded the shape of the thing it could measure
  (`docs/HANDOFF-GATE-ONE.md`). And `wipe` composes badly with bought silence:
  every second the voice stage buys so a finished board can be read is a second
  that board may already have gone, which is `projects/c5caa09eb153` — 52% of the
  film blank paper (`docs/STATUS.md`, 2026-08-27). `wipe` stays a documented,
  supported mode, reachable by `--board wipe` and by a preset that asks for it; it
  is no longer what anyone gets by not choosing. The amendment's own text is kept
  below because its second claim — that a beat framed at a quarter of the screen
  is a beat nobody re-reads — is still true, and is now answered by walking the
  camera over the board rather than by wiping it.

  **Amended 2026-08-21, and the original rule still stands where it was aimed.**
  Accumulation remains the default and the right answer for a long lesson: at two
  minutes and up the finished board _is_ the summary, the recap's pull-back over
  it is the payoff for never having wiped, and that is why `standard`, `short` and
  `square` all still accumulate. What changed is that we measured the rule at
  ninety seconds and under, where it does not hold. The evidence: on the same
  lesson, `--board wipe` moved mean content fill from **55.5% to 62.3%** and
  regions from **4 to 1** — because at eight beats in a four-cell region a beat is
  framed at a quarter of the screen, and nobody re-reads beat four at that size.
  There is no board tour worth taking in a film that ends before the tour would.
  So the `explainer` preset (`packages/planner/src/presets.ts`) defaults to
  `board: 'wipe'` and trades the accumulated summary for per-idea framing, and it
  is the only preset that does. The prohibition it replaces was about wiping
  _instead of_ having a canvas at all, which is the competitors' failure and is
  still forbidden: `wipe` keeps the single canvas, the fractional timing and the
  entity library, and expires ink by `persistUntil` rather than by starting a new
  slide. Wiping is now a per-preset decision backed by a number, never a global
  default — and re-defaulting an accumulating preset would move the four pinned
  storyboard hashes, which is its own reason not to.

  _(End of the superseded amendment. Its closing sentence was checked when it was
  reversed: the four pinned hashes are taken against `standard`, which never
  wiped, so flipping `explainer` back does not move them.)_

- **Timing is fractional, then measured.** Authors set `enter.at` as a fraction
  (0–1) of a scene. The voice stage measures real audio and writes
  `scene.durationSec`. Re-voicing in another language reflows automatically.
- **Assets resolve once.** `storyboard.assets[]` is an entity library keyed by
  `id`. An element references `assetId`. Never generate the same entity twice —
  that is why competitors' characters mutate between scenes.

## Pipeline stages and their signatures

Each stage only _enriches_ the storyboard. Keep these signatures exactly.

| Stage   | Package            | Entry signature                                                            |
| ------- | ------------------ | -------------------------------------------------------------------------- |
| ingest  | `@inkcast/planner` | `ingest(input: {text?, filePath?, url?}): Promise<SourceDoc>`              |
| plan    | `@inkcast/planner` | `plan(doc: SourceDoc, opts: PlanOptions): Promise<Storyboard>`             |
| voice   | `@inkcast/voice`   | `narrate(sb: Storyboard, dir: string, opts?): Promise<Storyboard>`         |
| visuals | `@inkcast/visuals` | `resolveVisuals(sb: Storyboard, dir: string, opts?): Promise<Storyboard>`  |
| render  | `@inkcast/render`  | `render(sb: Storyboard, dir: string, opts?): Promise<{videoPath: string}>` |

`dir` is a per-project working directory (`projects/<id>/`). Stages write their
artefacts there (`audio/`, `assets/`, `frames/`, `out.mp4`) and store **relative**
paths in the storyboard so projects stay portable.

Every stage must be **idempotent and resumable**: if the artefact it would
produce already exists and its input hash is unchanged, skip the work. Cache
keys go in `<dir>/cache.json`.

## Hard requirements

1. **It must work with zero API keys and zero network.** No key is set in this
   environment. Every stage needs a local default:
   - planner → deterministic heuristic planner (structure-aware, no LLM)
   - voice → Kokoro ONNX running locally via `kokoro-js`
   - visuals → built-in icon set + procedural diagrams, no text-to-image
     Cloud providers (Anthropic for planning, ElevenLabs for voice, Replicate/fal
     for images) are **opt-in upgrades behind adapters**, selected by env var.
     A missing key must degrade gracefully with a clear log line, never crash.
2. **Renderer is Playwright + ffmpeg. Do NOT use Remotion.** Remotion needs a
   paid company licence above 3 employees, which is incompatible with this
   project's purpose. We drive a headless Chromium page, seek deterministically,
   capture frames, and mux with ffmpeg.
3. **TypeScript, ESM, strict.** No Python in the runtime path.
4. **Do not run `pnpm install`, `pnpm add`, or any command that writes
   `pnpm-lock.yaml`.** Concurrent lockfile writes corrupt the workspace. Declare
   your dependencies in your own `package.json` with caret ranges and stop
   there. A dedicated integration agent installs everything at the end.
5. **Stay inside the files you own.** Listed per-agent in your prompt. Never
   edit another agent's files, the root `package.json`, `pnpm-workspace.yaml`,
   `tsconfig.base.json`, or `packages/core/src/storyboard.ts`.
6. **No placeholders.** No `// TODO: implement`, no stubbed functions that throw
   "not implemented", no mock data standing in for real logic. Everything you
   write must actually run. This is shipping code.

## Package conventions

Package names are `@inkcast/<dir>`. Every package `package.json` looks like:

```json
{
  "name": "@inkcast/voice",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": { "@inkcast/core": "workspace:*" }
}
```

We consume TypeScript sources directly across the workspace (no build step
needed for local dev). Each package needs a `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": { "outDir": "dist", "rootDir": "src" }
}
```

Export a clean public API from `src/index.ts`. Log through
`@inkcast/core`'s `logger` (see `packages/core/src/log.ts`) so CLI and web share
one progress format.

## Progress reporting

Long stages report progress so the UI can show it. Emit via the callback in
`opts.onProgress?: (p: {stage: string; pct: number; note?: string}) => void`.
The web app streams these to the browser over SSE.

## Design and UX

`docs/DESIGN.md` is written by the design-system agent and is **binding** for all
UI work. Do not invent your own colours, spacing, or type scale — consume the
tokens. Aesthetic target: elegant, minimal, confident, modern-AI-company. Light
and dark must both be first-class.

## Definition of done for the MVP

From the repo root, with no API keys:

```bash
pnpm install
pnpm cast examples/gradient-descent.md   # writes projects/<id>/out.mp4
pnpm dev                                  # studio at localhost:3000
```

produces a watchable, correctly narrated, hand-drawn explainer video.
