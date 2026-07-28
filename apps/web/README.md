# @inkcast/web — the studio

The browser front end for Inkcast, plus the HTTP layer that drives the generation
pipeline. Next.js App Router, React 19, Tailwind 4.

Everything here works with **zero API keys**. The planner, the voice and the
artwork all have local defaults; cloud providers are opt-in upgrades behind env
vars, and a missing key degrades with a warning rather than an error. Hit
`GET /api/providers` to see exactly which provider each stage will use.

## Running it

From the repo root:

```bash
pnpm install          # once — installs Playwright's Chromium too
pnpm dev              # studio at http://localhost:3000
```

Or from this directory: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm typecheck`.

You also need **ffmpeg** on your `PATH` — the renderer captures frames with
Playwright and muxes them with ffmpeg. Nothing else is required.

Generated projects are written to `projects/<id>/` **at the repo root**, the same
place `pnpm cast` writes them, so a video made on the command line shows up in
the studio library and vice versa.

### Long renders and the dev server

A render is minutes of work and runs as a background job inside the Next server
process. Two consequences worth knowing:

- **Restarting the dev server abandons in-flight runs.** Progress is on disk, so
  re-submitting the same document resumes it rather than starting over.
- Editing a file under `apps/web` triggers a hot reload, which is safe — the job
  registry is pinned to `globalThis` and survives it. Editing a _pipeline_
  package mid-render is not safe; the module graph is replaced underneath the run.

## Environment variables

Every one is optional. Copy `.env.example` at the repo root to `.env` and edit.

This app reads the root `.env` itself, in addition to Next's own
`apps/web/.env.local` — a key set in either place works, and the real environment
always wins over both.

| Variable                          | Effect when unset                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `INKCAST_PROJECTS`                | Project directories go to `<repo>/projects`. Set it to an absolute path to store them elsewhere.                            |
| `ANTHROPIC_API_KEY`               | The offline heuristic planner runs, and `/edit` uses its pattern-matched instruction parser.                                |
| `INKCAST_PLANNER`                 | `anthropic` when a key is set, `local` otherwise. `local` forces the offline planner; a Claude model id selects that model. |
| `ELEVENLABS_API_KEY`              | Kokoro-82M runs locally through `kokoro-js` (one-time ~92 MB download).                                                     |
| `INKCAST_VOICE`                   | `af_heart`, local. A non-Kokoro id routes to ElevenLabs.                                                                    |
| `REPLICATE_API_TOKEN` / `FAL_KEY` | The built-in stroke-icon library plus procedural diagrams. Free, offline, deterministic.                                    |
| `INKCAST_LOG`                     | `info`. One of `debug`, `info`, `warn`, `error`.                                                                            |
| `INKCAST_RENDER_WORKERS`          | The render stage picks a default from the core count. Each worker is a Chromium page.                                       |

## API surface

Every route runs on the **Node runtime** (`export const runtime = 'nodejs'`) —
they touch the filesystem and spawn ffmpeg, so none of them can be edge. Request
bodies are Zod-validated and failures come back as
`{ error: string, details?: string[] }` with a real status code.

### `POST /api/generate`

Starts a run and returns immediately. Accepts JSON or `multipart/form-data`.

```jsonc
// exactly one source: text | url | filePath | an uploaded file
{
  "text": "…", // ≥ 20 characters
  "url": "https://…", // http/https only
  "filePath": "examples/x.md", // server-side, confined to the repo root
  "title": "Optional",
  "projectId": "reuse-this-id", // resumes that project's cached stages
  "force": false, // redo every stage even if cached

  // Storyboard overrides, accepted flattened *or* nested under `meta`:
  "aspect": "16:9", // 16:9 | 9:16 | 1:1
  "style": "marker", // marker | pencil | chalk | ink
  "palette": "color", // mono | color
  "language": "en",
  "voice": "af_heart",
  "fps": 30,
  "outroSec": 1.2,
}
```

For an upload, send `multipart/form-data` with the document under `file` and the
same fields as form parts. Accepted extensions: `.md .markdown .txt .text .pdf
.docx .html .htm .rtf .json .adoc .rst`, up to 32 MB. The file is written to
`projects/<id>/source/` **before** ingest runs, so the source stays with the
project and a re-render a week later still works.

**→ `202`** `{ projectId, status: "running", started, streamUrl }`

`started` is `false` when a run for that project was already in flight and this
request joined it instead of starting a second render.

Omitting `projectId` derives one from the source, so submitting the same document
twice resumes that project (every stage is cached) rather than duplicating it.
Uploads always get a fresh id.

### `GET /api/generate/<id>/stream`

Server-Sent Events for one run. Each message is a bare JSON object on a `data:`
line, and a terminal event is always last:

```
data: {"stage":"render","pct":62,"stagePct":38,"note":"frame 1140/1830"}
data: {"done":true,"projectId":"…","videoPath":"out.mp4","videoUrl":"/api/media/…/out.mp4","durationSec":94.2}
data: {"error":"[voice] model download failed","stage":"voice"}
```

`pct` is overall 0–100 and monotonic; `stagePct` is progress within the current
stage. Comment lines (`: ping`) are keepalives and are invisible to `EventSource`.

Progress is **buffered**, so a client that connects late is replayed what it
missed before it sees anything live, and one that connects after the run finished
still gets the terminal event instead of hanging. Multiple listeners are fine.

This endpoint **always answers 200**: `EventSource` cannot read a non-2xx body
and would reconnect forever, so "no such project" and "nothing is running" are
reported as `error` events. Only a malformed id gets a 400.

### `GET /api/generate/<id>`

A snapshot instead of a stream, for a client that would rather poll or that wants
to know whether to open a stream at all.

**→ `200`** `{ projectId, job, project }` — `job` is `null` once the run has been
swept from memory; `project.videoPath` then tells you it finished earlier.

### `GET /api/projects`

**→ `200`** `{ projects: ProjectRecord[], count }`, newest first.

```ts
type ProjectRecord = {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string; // ISO
  scenes: number;
  durationSec: number;
  videoPath?: string; // project-relative
  videoUrl?: string; // ready for <video src>
  source?: { kind: 'text' | 'url' | 'file'; ref: string };
  error?: string; // why the last run failed
  costUsd?: number;
  aspect?: string;
  progress?: { stage: string; pct: number }; // only while running
};
```

### `GET /api/projects/<id>`

**→ `200`** `{ project, storyboard, audioUrls, job }`. `storyboard` is `null`
until the plan stage has run; `audioUrls` is one media URL per scene (`null` for
scenes not yet narrated).

### `DELETE /api/projects/<id>`

Removes the project directory and its index entry. **→ `200`** `{ ok: true, id }`,
`404` if unknown, `409` while a run is in progress.

### `POST /api/projects/<id>/edit`

`{ "instruction": "make scene 2 shorter" }`

Patches the storyboard and saves it. Does **not** re-render — call `/rerender`
when you are ready to spend the compute.

**→ `200`** `{ storyboard, applied, via, needsRerender }` where `applied` is one
line per change and `via` is `anthropic` or `local`. `422` when the instruction
cannot be mapped onto an edit operation (the response `details` carry the usage
hint), `409` while a run is in progress.

### `POST /api/projects/<id>/rerender`

Optional body `{ "force": true }`. Rebuilds the video from the saved storyboard;
ingest and plan are skipped and only scenes whose narration changed are
re-voiced.

**→ `202`** `{ projectId, status, started, streamUrl }` — same shape as
`/api/generate`, and progress comes over the same stream endpoint.

### `GET /api/media/<id>/<path…>`

Streams a file out of a project directory: `out.mp4`, `audio/s1.wav`, a captured
frame. Supports `HEAD`, `ETag`/`304` revalidation, and **HTTP Range** requests —
without which `<video>` cannot seek.

Guarded against traversal on every request: the id must match the project-id
alphabet, each path segment is rejected if it is empty/`.`/`..`, and the resolved
path must stay inside the project directory _after_ symlinks are followed. `.html`
is deliberately served as `text/plain`, and every response carries a restrictive
CSP, because project files can come from an untrusted upload.

### `GET /api/providers`

**→ `200`** `{ providers, local, projectsDir }` — which provider each stage will
use and why, mirroring `inkcast providers`. `local: true` means nothing in a run
leaves this machine and nothing can be billed.

## Layout

```
app/
  (marketing)/ (app)/     pages — owned by the studio UI agent
  api/                    every route handler
    _lib/http.ts          JSON/error helpers, body validation
    _lib/schemas.ts       Zod request schemas
    _lib/media.ts         path containment, Range parsing, content types
components/ui/            design-system primitives
lib/
  api.ts                  typed browser client for these routes
  use-generation.ts       React hook over the SSE stream
  store.ts                env bootstrap + project index
  jobs.ts                 in-process job registry and progress fan-out
```

Two notes on `lib/store.ts`, because they are load-bearing:

1. It is the **environment bootstrap**. `@inkcast/core` captures
   `INKCAST_PROJECTS` once at module load, and `next dev` runs with `apps/web` as
   its cwd — so without this, projects would land in `apps/web/projects/` and the
   studio would not see anything the CLI made. The module has no static workspace
   imports and reaches core and the pipeline through `loadCore()` / `loadPipeline()`,
   which cannot evaluate before the bootstrap has run. Route handlers therefore
   import workspace **types only**, never values.
2. `projects/index.json` is a **cache, not the source of truth**. The pipeline can
   rebuild any finished project from `storyboard.json` + `pipeline.json`, so
   listing merges a disk scan with the index and lets disk win on anything
   observable. The index only contributes what disk cannot know: that a run is in
   flight, and why the last one failed. Deleting it loses nothing but status.
