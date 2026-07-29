# Inkcast tech stack — verified library APIs

**Status: every claim below was executed on this machine**, not recalled. Environment:
macOS 15.6 darwin **arm64**, Node **v22.17.0**, pnpm 10.33.0, ffmpeg/ffprobe **8.1.2**.
Verified 2026-07-28. Registry versions are `latest` as of that date.

Read this before writing imports. Where a library's real behaviour contradicts its
README, the real behaviour is recorded and marked **GOTCHA**.

House rules that apply to every snippet here (from `docs/CONTRACT.md`):

- **Do not run `pnpm install` / `pnpm add`.** Declare deps in your own package's
  `package.json` with caret ranges and stop. An integration agent installs at the end.
- `tsconfig.base.json` sets `verbatimModuleSyntax: true` → type-only imports **must**
  use `import type { … }`. It also sets `moduleResolution: "bundler"` +
  `esModuleInterop: true`, so `import x from 'some-cjs-pkg'` type-checks fine.
- `noUncheckedIndexedAccess: true` → `arr[0]` is `T | undefined`. Guard it.

### Dependency summary (copy into your own package.json)

| Package                     | Range      | Owner stage                                 |
| --------------------------- | ---------- | ------------------------------------------- |
| `kokoro-js`                 | `^1.2.1`   | voice                                       |
| `@huggingface/transformers` | `^3.8.1`   | voice (peer of kokoro-js)                   |
| `roughjs`                   | `^4.6.6`   | visuals + render                            |
| `@dagrejs/dagre`            | `^3.0.0`   | visuals                                     |
| `elkjs`                     | `^0.12.0`  | visuals (optional, only for `graph` layout) |
| `lucide-static`             | `^1.27.0`  | visuals                                     |
| `@neplex/vectorizer`        | `^0.1.0`   | visuals (optional, raster→SVG)              |
| `playwright`                | `^1.62.0`  | render                                      |
| `unpdf`                     | `^1.8.0`   | planner (ingest)                            |
| `mammoth`                   | `^1.12.0`  | planner (ingest)                            |
| `turndown`                  | `^7.2.4`   | planner (ingest)                            |
| `cheerio`                   | `^1.2.0`   | planner (ingest)                            |
| `@anthropic-ai/sdk`         | `^0.115.0` | planner (opt-in adapter)                    |
| `zod-to-json-schema`        | `^3.25.2`  | planner (opt-in adapter)                    |

ffmpeg/ffprobe and macOS `say` are **external binaries**, not npm deps. Do not add
`ffmpeg-static` — the contract targets a system ffmpeg, and one is present.

---

## 1. kokoro-js — local Kokoro-82M TTS

**Version 1.2.1.** Install name `kokoro-js`. Pure ESM (`"type": "module"`), exports
`./dist/kokoro.js` for `import`. Deps: `@huggingface/transformers ^3.5.1` (resolves to
**3.8.1**) and `phonemizer ^1.2.1`.

```ts
import { KokoroTTS } from 'kokoro-js';
import { writeFile } from 'node:fs/promises';

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8', // "fp32" | "fp16" | "q8" | "q4" | "q4f16"
  device: 'cpu', // "cpu" in Node. "wasm" | "webgpu" are browser targets.
  progress_callback: (p) => log.debug('kokoro download', p),
});

const audio = await tts.generate('Gradient descent walks downhill.', {
  voice: 'af_heart', // storyboard.meta.voice default — matches the IR
  speed: 1,
});

// RawAudio: { audio: Float32Array; sampling_rate: number }
await writeFile(wavPath, Buffer.from(audio.toWav())); // or: await audio.save(wavPath)
const durationSec = audio.audio.length / audio.sampling_rate; // -> scene.durationSec
```

**Model id confirmed:** `onnx-community/Kokoro-82M-v1.0-ONNX` — hard-coded in the
package's own code path and in its README.

**dtype options are five, not two:** `fp32 | fp16 | q8 | q4 | q4f16`. Default is `fp32`.
Use **`q8`** — it is the best size/quality tradeoff for our purposes.

**Output rate is 24 000 Hz**, verified in the shipped bundle:
`return new RawAudio(waveform.data, 24e3)`. Prefer reading `audio.sampling_rate` at
runtime over hard-coding it.

**Voices — 28 valid ids** (the typed `VOICES` map). `af_*` American female, `am_*`
American male, `bf_*`/`bm_*` British. Default `af_heart`:

```
af_heart af_alloy af_aoede af_bella af_jessica af_kore af_nicole af_nova af_river
af_sarah af_sky am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck
am_santa bf_emma bf_isabella bf_alice bf_lily bm_george bm_lewis bm_daniel bm_fable
```

- **GOTCHA:** the package ships **54** `.bin` voice files (27 MB) including
  `ef_/em_/ff_/hf_/hm_/if_/im_/jf_/jm_/pf_/pm_/zf_/zm_` (Spanish, French, Hindi,
  Italian, Japanese, Portuguese, Chinese), but only the 28 English ids above are in the
  typed map and `_validate_voice()` only accepts the `a`/`b` language prefixes. **Do not
  offer the other 26 in the UI** — they will be rejected. Validate
  `storyboard.meta.voice` against `tts.voices` before generating.
- Voice styles are read from **local disk** in Node (`voices/<id>.bin` via
  `fs/promises`), not fetched. Only the browser build hits the Hub for voices.

**First-run weight download: YES, unavoidable.** Model weights are not in the npm
package; transformers.js pulls them from the Hub on first `from_pretrained`. Measured
sizes: `model_quantized.onnx` (**q8**) **92.4 MB**, `model_fp16.onnx` 163.2 MB,
`model.onnx` (fp32) 325.5 MB, `model_q4.onnx` 305.2 MB. Note `q8` maps to
`onnx/model_quantized.onnx` — there is no `model_q8.onnx`.

Caching / offline control, via `env` from `@huggingface/transformers` (kokoro-js also
re-exports an `env` for wasm paths only):

| Field               | Default in Node            | Use                                                                     |
| ------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `cacheDir`          | `./.cache` (cwd-relative!) | **Set this explicitly** or the cache lands wherever the CLI was invoked |
| `useFSCache`        | `true`                     | Keep on                                                                 |
| `allowLocalModels`  | `true`                     | Keep on                                                                 |
| `allowRemoteModels` | `true`                     | Set `false` to hard-fail instead of downloading                         |

**This is the one place the "zero network" requirement cannot be fully met** — a
92 MB one-time download is required before local TTS works. Handle it explicitly:
report progress via `opts.onProgress`, and if the download fails, log a clear warning
and fall back to the macOS `say` path (§10) rather than crashing. Cache the weights
outside `projects/<id>/` (they are shared across projects), e.g. under a repo-level
`.cache/models`.

`phonemizer` has **zero dependencies** — no espeak binary, no Python. Good.

**VERDICT: USE.** The only real local-TTS option that satisfies "TypeScript, no Python".
Correct model id, generous voice set, clean WAV output, and duration is derivable
directly for `scene.durationSec`. Accept and manage the one-time 92 MB download; keep
`say` as the graceful-degradation path.

---

## 2. roughjs — hand-drawn geometry, server-side, no DOM

**Version 4.6.6.** Install name `roughjs` (no scope, no `.js`). Ships `bundled/rough.esm.js`
(ESM) and `bundled/rough.cjs.js`. `package.json` has **no `exports` map**, only
`main`/`module`, so in Node ESM the bare specifier resolves to the **CJS** file.

**Import the ESM bundle by explicit subpath** — verified working with zero DOM:

```ts
import rough from 'roughjs/bundled/rough.esm.js';
```

`rough.generator()` needs no `document`, no canvas, no jsdom. It returns a
`RoughGenerator` whose `Drawable`s carry `sets: OpSet[]`, and — importantly — the
generator itself converts opsets to SVG path data:

```ts
const gen = rough.generator({ options: { roughness: 1.4, bowing: 1.2, stroke: '#111' } });

const drawable = gen.rectangle(10, 10, 200, 120, { seed: 42, randomizer: undefined });
// drawable.shape === 'rectangle'
// drawable.sets  === [{ type: 'path', ops: [{op:'move',data:[…]},{op:'bcurveTo',data:[…]}, …] }]

for (const { d, stroke, strokeWidth, fill } of gen.toPaths(drawable)) {
  svg += `<path d="${d}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}"/>`;
}
```

`gen.toPaths(drawable)` → `Array<{ d: string; stroke: string; strokeWidth: number; fill: string }>`.
That `d` string is exactly what we need for both `Asset.svg` and the renderer's
stroke-dash draw-on animation. **You never need to walk `sets`/`ops` by hand.**

All shape factories verified to produce path data with no DOM:

| Call                                     | `sets` types          | paths from `toPaths()`      |
| ---------------------------------------- | --------------------- | --------------------------- |
| `gen.rectangle(x,y,w,h,o)`               | `path`                | 1                           |
| `gen.ellipse(cx,cy,w,h,o)`               | `path`                | 1                           |
| `gen.circle(cx,cy,d,o)`                  | `path`                | 1                           |
| `gen.line(x1,y1,x2,y2,o)`                | `path`                | 1                           |
| `gen.linearPath(pts,o)`                  | `path`                | 1                           |
| `gen.curve(pts,o)`                       | `path`                | 1                           |
| `gen.polygon(pts,o)`                     | `path`                | 1                           |
| `gen.arc(cx,cy,w,h,start,stop,closed,o)` | `path`                | 1                           |
| `gen.path('M10 10 C …',o)`               | `path`                | 1                           |
| `…,{ fill:'#e11', fillStyle:'hachure' }` | `fillSketch` + `path` | 2 (fill first, then stroke) |

`points` are `[number, number][]`. Filled shapes return **two** paths — render them in
array order so the sketchy fill sits under the outline.

### GOTCHA 1 — `rough.generator(config)` nests its options

Passing drawing options flat is **silently ignored**:

```ts
rough.generator({ stroke: '#111' }); // -> toPaths() gives stroke "#000"  ✗
rough.generator({ options: { stroke: '#111' } }); // -> toPaths() gives stroke "#111"  ✓
```

### GOTCHA 2 — the seed leaks, which breaks reproducibility (critical for us)

`Asset.seed` exists so regeneration is visually identical. roughjs will silently defeat
that. The generator memoises its RNG onto the options object; when you call a shape
**without** an options argument, `o === generator.defaultOptions`, so the live RNG is
stored on `defaultOptions` and every later call inherits that already-advanced RNG —
copied over your `seed` by `Object.assign`. Measured:

```
defaultOptions.randomizer before an options-less call: undefined
defaultOptions.randomizer after  an options-less call: Random
then: rect(seed:7) === rect(seed:7)  ->  false     ← seed no longer does anything
```

Two safe patterns (both verified to give `true`):

```ts
// A. always pass options, and always clear the memoised RNG
gen.rectangle(0, 0, 100, 50, { seed, randomizer: undefined });

// B. never call a shape without options on a shared generator
```

Wrap this once in the visuals package so no call site can get it wrong:

```ts
/** Always reseed: roughjs memoises its RNG onto the options object. */
function draw(gen: RoughGenerator, seed: number, fn: (o: Options) => Drawable) {
  return gen.toPaths(fn({ seed, randomizer: undefined }));
}
```

Seeded output is **stable across processes** — the same seed produced a byte-identical
`d` string in two separate `node` runs, so `Asset.seed` is a valid cache key.

**VERDICT: USE.** It is the right library and it works fully headless — but only via the
`roughjs/bundled/rough.esm.js` subpath, with nested config, and with
`randomizer: undefined` on every seeded call. Ignoring the seed gotcha will produce
assets that mutate between renders, which is the exact failure the IR's `seed` field
exists to prevent.

---

## 3. dagre vs elkjs — graph layout

Both work in Node ESM. They are not equivalent choices.

### `@dagrejs/dagre` — **preferred**

`dagre@0.8.5` is the name most people reach for, but it was published **2019-12-03**,
is unmaintained, and drags in **lodash** and the old `graphlib`. The maintained fork
`@dagrejs/dagre@3.0.0` (published **2026-03-22**) has a real `exports` map with a
proper ESM build and only one dep (`@dagrejs/graphlib`). Verified working:

```ts
import * as dagre from '@dagrejs/dagre';
// named exports: Graph, debug, default, graphlib, layout, util, version

const g = new dagre.graphlib.Graph({ directed: true });
g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 });
g.setDefaultEdgeLabel(() => ({})); // required, or setEdge throws

for (const n of el.nodes) g.setNode(n.id, { label: n.label, width: 140, height: 60 });
for (const e of el.edges) g.setEdge(e.from, e.to);

dagre.layout(g); // mutates g in place, synchronous

g.graph(); // -> { width: 180, height: 360, … }  total bounds
g.node('a'); // -> { x: 90, y: 50, width: 140, height: 60, label: 'Data' }
g.edge('a', 'b'); // -> { points: [{x:90,y:80},{x:90,y:115},{x:90,y:150}] }
```

`rankdir` is `'TB' | 'BT' | 'LR' | 'RL'` — maps directly onto the IR's
`DiagramElement.layout`: `flow` → `LR`, `tree`/`stack` → `TB`. **Node `x`/`y` are
centres**, not top-left, so convert to the IR's `Box` with `x: n.x - n.width/2`.
Cycles are handled (a back-edge `d→b` produced a sensible routed polyline).

Synchronous — no async plumbing in the visuals stage.

### `elkjs` — only if you need real graph (non-layered) layout

**0.12.0**, zero deps. `main` is the extensionless `lib/main`; Node ESM resolved the
bare specifier anyway and `new ELK().layout()` worked. But `lib/main.js` is the
worker-based API, so prefer the explicit bundled build to avoid worker plumbing:

```ts
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();
const laid = await elk.layout({
  id: 'root',
  layoutOptions: {
    'elk.algorithm': 'layered', // or 'stress' / 'force' / 'mrtree' / 'radial'
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '40',
  },
  children: [
    { id: 'a', width: 140, height: 60 },
    { id: 'b', width: 140, height: 60 },
  ],
  edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }],
});
// laid.width/height; laid.children[i].x/y  (TOP-LEFT, unlike dagre)
// laid.edges[0].sections -> [{ startPoint:{x,y}, endPoint:{x,y}, bendPoints? }]
```

Differences that matter: **async** (returns a Promise, drags async through the visuals
stage), coordinates are **top-left** not centre, `layoutOptions` values are **strings**,
and it's a ~1.4 MB GWT-compiled bundle.

**VERDICT: USE `@dagrejs/dagre@^3.0.0`** for `flow`, `tree`, `stack`, `sequence`, `grid`.
Synchronous, tiny, centre-based coords, maintained. **AVOID `dagre@0.8.5`** (2019,
unmaintained, lodash). **`elkjs` is OPTIONAL** — add it only when `layout: 'graph'`
genuinely needs force/stress placement that dagre's layered algorithm cannot express;
if in doubt, ship dagre only and drop `elkjs` from the dependency list.

---

## 4. lucide-static — raw SVG icons on disk

**Version 1.27.0.** Install name `lucide-static`. Zero dependencies, ISC licensed.

On-disk layout under `node_modules/lucide-static/`:

| Path               | Contents                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| `icons/<name>.svg` | **2007 individual SVG files** — this is what we read                    |
| `icon-nodes.json`  | every icon as a parsed node tree (no SVG text)                          |
| `sprite.svg`       | all icons as one `<symbol>` sheet                                       |
| `tags.json`        | `{ "rocket": ["ship","launch",…] }` — **use this for search//aliasing** |
| `dist/`, `font/`   | JS bundles and an icon font; not needed                                 |

File names are kebab-case (`a-arrow-down.svg`, `activity-square.svg`, `rocket.svg`).
Every icon is a 24×24 `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
`stroke-width="2"` outline made of `<path>`/`<circle>`/`<line>`/`<rect>` children:

```svg
<!-- @license lucide-static v1.27.0 - ISC -->
<svg class="lucide lucide-rocket" xmlns="http://www.w3.org/2000/svg"
     width="24" height="24" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  …
</svg>
```

Resolve the directory without hard-coding `node_modules`:

```ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const iconsDir = path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons');
const svg = await readFile(path.join(iconsDir, `${slug}.svg`), 'utf8');
```

To roughen: pull each child's geometry out, feed it through
`gen.path(d, { seed, randomizer: undefined })` (§2), and emit the returned `d` strings.
Because everything is `stroke="currentColor"` with no fills, these roughen cleanly and
recolour from the palette with a single `stroke` attribute. Scale by 24 → the element's
`Box`. **Attribute the ISC licence** in the repo's third-party notices.

**VERDICT: USE.** Exactly the shape we need — 2007 plain stroke-only SVG files readable
straight off disk, zero deps, permissive licence, plus `tags.json` for keyword→icon
matching in the built-in (no-API-key) visuals path.

---

## 5. Raster PNG → SVG: @neplex/vectorizer vs potrace

### `@neplex/vectorizer` — **preferred**

**0.1.0** (latest; published from Node 24). Rust `vtracer` via napi-rs. It ships
**prebuilt platform binaries as optionalDependencies**, and
**`@neplex/vectorizer-darwin-arm64@0.1.0` exists** — so it installs on this machine with
no Rust toolchain and no node-gyp compile. Runtime deps are only `commander` +
`picocolors`. `index.d.ts` is generated by napi-rs, so types are exact.

```ts
import { vectorize, ColorMode, Hierarchical, PathSimplifyMode, Preset } from '@neplex/vectorizer';
import { readFile } from 'node:fs/promises';

const svg: string = await vectorize(await readFile('in.png'), {
  colorMode: ColorMode.Binary, // Binary = 1 (black/white) | Color = 0
  hierarchical: Hierarchical.Stacked, // Stacked = 0 | Cutout = 1
  mode: PathSimplifyMode.Spline, // None = 0 | Polygon = 1 | Spline = 2
  filterSpeckle: 4,
  cornerThreshold: 60,
  lengthThreshold: 4,
  spliceThreshold: 45,
  maxIterations: 10,
  colorPrecision: 6,
  layerDifference: 16,
  pathPrecision: 2,
});
```

`vectorize(source: Buffer, config?: Config | Preset, signal?: AbortSignal): Promise<string>`
— returns the SVG document as a string. Sync (`vectorizeSync`), raw-RGBA
(`vectorizeRaw`, `vectorizeRawSync`) and streaming-callback
(`vectorizeToCallback`, plus `isEOF(chunk, progress)`) variants exist, as do a `Preset`
enum, an `optimize(svgString, …)` helper, and `readImageSync`. Note the config keys are
**camelCase**, and the enums are numeric — import and use the enum members rather than
guessing integers.

For our use (turning a generated raster illustration into strokeable vectors) use
`ColorMode.Binary` + `PathSimplifyMode.Spline`; that yields few, smooth paths that
roughen and draw-on well.

### `potrace` / `oslllo-potrace` — avoid

- **`potrace@2.1.8`** was published **2020-07-29** and depends on **`jimp@^0.14.0`** (also
  2020). Unmaintained, pre-ESM, callback-based, and a five-year-old image stack under
  Node 22.
- **`oslllo-potrace@5.0.0`** (published 2025-12-22) is the maintained option and uses
  `jimp@^1.6.0`, but it is **CJS-only** (`main: src/index.js`, no `exports` map, no
  `type: module`), its documented API is `require`-based, and its README examples pull in
  further packages (`fs-extra`, `oslllo-svg2`). API shape:
  `const svg: string = await Potrace(sourcePath).trace();` — a callable factory, so under
  ESM you'd need `import Potrace from 'oslllo-potrace'` and rely on CJS default interop.
- Both are **bitmap-tracing only** (single-colour), whereas vtracer handles colour
  clustering, and both add a full `jimp` image pipeline we otherwise don't need.

**VERDICT: USE `@neplex/vectorizer` (OPTIONAL dep), AVOID both potrace packages.**
Prebuilt darwin-arm64 binary, modern typed API, no compile step, colour or binary modes.
Keep it **optional and lazily imported** — the zero-key default path uses `lucide-static`

- procedural diagrams and must never require a native module to be present:

```ts
let vectorize: typeof import('@neplex/vectorizer').vectorize | undefined;
try {
  ({ vectorize } = await import('@neplex/vectorizer'));
} catch {
  log.warn('@neplex/vectorizer unavailable — skipping raster vectorisation');
}
```

---

## 6. playwright — deterministic frame capture

**Version 1.62.0.** Install **`playwright`** (not `playwright-core`): it depends on
`playwright-core@1.62.0` and provides the `playwright install` CLI. `engines.node >= 20`.
It has a real `exports` map with `./index.mjs`, so ESM named imports work:

```ts
import { chromium } from 'playwright';
```

Everything below was executed end-to-end: 45 frames captured and muxed into a playable
mp4 (see §7).

```ts
const browser = await chromium.launch({
  args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars'],
});

const context = await browser.newContext({
  viewport: { width: 960, height: 540 }, // CSS px
  deviceScaleFactor: 2, // -> 1920x1080 actual pixels
  reducedMotion: 'reduce', // kills prefers-reduced-motion animations
});

const page = await context.newPage();
await page.addStyleTag({
  content: `*,*::before,*::after{animation:none!important;transition:none!important;
            caret-color:transparent!important}`,
});
await page.setContent(html);

for (let i = 0; i < frameCount; i++) {
  await page.evaluate((t) => window.seek(t), i / fps); // pure function of t
  const png: Buffer = await page.screenshot({ type: 'png' });
  // -> ffmpeg stdin
}
await browser.close();
```

**Frame size = `viewport × deviceScaleFactor`.** Verified: a 640×360 viewport at
`deviceScaleFactor: 2` produced a **1280×720** mp4. So for `frameSize(aspect)` from the
IR, set the viewport to half the target and `deviceScaleFactor: 2` (crisper text than a
1× viewport at full size).

**Determinism — the rule: never let the page own the clock.** Do not use
`requestAnimationFrame`, CSS animations, `Date.now()`, transitions, or `Math.random()` in
the render page. Expose one pure function and have Node drive it:

```js
window.seek = (t) => {
  /* set every element's state purely from t */
};
```

Layers of protection, all verified:

1. `window.seek(t)` — animation state is a **pure function of `t`**, so frame N is
   reproducible regardless of wall-clock or capture speed.
2. `reducedMotion: 'reduce'` + the `animation:none!important` stylesheet — belt and
   braces against any CSS that slips in.
3. `caret-color: transparent` — a blinking text caret is a real source of
   frame-to-frame diffs.
4. `--disable-lcd-text` (no subpixel AA → stable text pixels), `--force-color-profile=srgb`
   (identical colour across displays), `--hide-scrollbars`.
5. Seed all randomness through `Asset.seed` in Node (§2) and pass results in; never
   randomise inside the page.

Verified: re-seeking to the same `t` after capturing 45 frames reproduced a
byte-identical-length screenshot.

`page.screenshot({ type: 'png' })` returns a **Buffer** when `path` is omitted — write it
straight to ffmpeg's stdin, never to disk. `type: 'jpeg'` + `quality` is available and
faster, but PNG is lossless and the H.264 encode is the quality floor anyway; PNG is
worth it. `animations: 'disabled'` also exists on `screenshot()` but only affects CSS
animations/transitions — it is not a substitute for the pure-`seek` design.

**Installing browsers:** `pnpm exec playwright install chromium` (add `--with-deps` on
Linux CI). Browsers land in `~/Library/Caches/ms-playwright/` on macOS, overridable with
`PLAYWRIGHT_BROWSERS_PATH`. Chromium is a **~150 MB download**, and the required build
revision is pinned per Playwright version (1.62.0 wants chromium **1234**). Bumping
Playwright can therefore silently require a fresh browser download.

**Runtime presence detection — do not launch to find out.** Verified working:

```ts
import { existsSync } from 'node:fs';

export function chromiumAvailable(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  } // executablePath() throws if no build is registered
}
```

On this machine that returned `true` for
`~/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
The `try`/`catch` is required — `executablePath()` throws rather than returning `''` when
nothing is registered. On `false`, fail with an actionable message
("run `pnpm exec playwright install chromium`"), not a stack trace.

**VERDICT: USE.** Contract-mandated and it genuinely delivers deterministic capture. The
non-negotiable design rule is `window.seek(t)` purity — the browser flags and
`reducedMotion` are hardening, not the mechanism. **Remotion remains BANNED** (paid
licence above 3 employees).

---

## 7. ffmpeg / ffprobe recipes

All verified with ffmpeg 8.1.2 against real captured frames.

### Frames on stdin → H.264 + WAV narration → web-ready mp4

```ts
const ff = spawn(
  'ffmpeg',
  [
    '-y',
    '-v',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-i',
    'pipe:0', // PNG/JPEG frames
    '-i',
    narrationWavPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p', // required for browser/QuickTime playback
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart', // moov before mdat -> starts playing while loading
    'out.mp4',
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);

for (const png of frames) {
  if (!ff.stdin.write(png)) await once(ff.stdin, 'drain'); // MUST respect backpressure
}
ff.stdin.end();
await once(ff, 'close'); // check the exit code
```

Confirmed output: `h264 / yuv420p / 1280x720 / 30 fps` video + `aac 16000 Hz` audio, and
`moov` at byte 36 vs `mdat` at 2272 → **faststart verified**.

Notes that will bite you:

- `-f image2pipe` reads concatenated encoded images from one stream; ffmpeg sniffs PNG vs
  JPEG. `-framerate` must come **before** `-i pipe:0` (it's an input option); `-r` after
  the inputs sets the output rate.
- **Respect `stdin.write()` backpressure.** Ignoring the `false` return buffers every
  frame in Node's heap — at 1920×1080 that is hundreds of MB and an eventual OOM.
- **`-shortest` truncates to the shortest stream.** In the test, 45 frames at 30 fps
  (1.5 s) against 4.67 s of audio produced a **1.5 s** mp4 — the narration was cut off.
  Generate `ceil((totalDuration(sb)) * fps)` frames, including `meta.outroSec`, and treat
  `-shortest` as a safety net rather than the mechanism.
- `yuv420p` requires **even** dimensions. All of `frameSize()`'s outputs (1920×1080,
  1080×1920, 1080×1080) are even — but if a `deviceScaleFactor` ever yields an odd size,
  add `-vf 'pad=ceil(iw/2)*2:ceil(ih/2)*2'`.
- `-crf 18` is visually lossless for flat whiteboard art; `-crf 20`–`23` cuts size
  noticeably if needed.

### Concatenating per-scene narration into one track

The voice stage writes one WAV per scene. Build the full track with the concat demuxer
(`-c copy`, so it is fast and lossless), inserting the outro silence:

```bash
# scenes.txt:  file 'audio/scene-000.wav'
ffmpeg -y -v error -f concat -safe 0 -i scenes.txt -c copy narration.wav
```

Add trailing silence for `meta.outroSec` with
`-f lavfi -t 1.2 -i anullsrc=r=24000:cl=mono` as an extra concat input, or
`-af 'apad=pad_dur=1.2'` on the final encode.

### Read an audio file's duration in seconds

```bash
ffprobe -v error -show_entries format=duration \
        -of default=nokey=1:noprint_wrappers=1 input.wav
# -> 4.674694
```

Returns a bare float on stdout, no wrapper. `-of json` if you also want codec/rate:
`ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -show_entries format=duration -of json f.wav`.

For Kokoro output you do **not** need ffprobe — compute
`audio.audio.length / audio.sampling_rate` directly (§1). Use ffprobe for the `say`
fallback and for user-supplied audio.

**Verify ffmpeg exists at startup** (`ffmpeg -version`, exit code 0) and emit one clear
log line if it is missing, per the graceful-degradation rule.

**VERDICT: USE.** Contract-mandated, present at 8.1.2, and the whole
frames→H.264+AAC→faststart chain is verified working. Watch backpressure and `-shortest`.

---

## 8. Document ingest — one library per format

| Format       | Pick                                     | Why                                           |
| ------------ | ---------------------------------------- | --------------------------------------------- |
| **PDF**      | **`unpdf@^1.8.0`**                       | Bundles pdf.js; **zero runtime dependencies** |
| **.docx**    | **`mammoth@^1.12.0`**                    | The only real answer in JS                    |
| **URL/HTML** | **`cheerio@^1.2.0` + `turndown@^7.2.4`** | cheerio strips chrome, turndown converts      |

### PDF — `unpdf` (not raw `pdfjs-dist`)

`unpdf@1.8.0`, `"type": "module"`, `engines.node >= 22`, **no `dependencies`** (only an
optional `@napi-rs/canvas` peer, needed just for `renderPageAsImage` — we don't use it).
Raw `pdfjs-dist@6.1.200` would work but needs worker/canvas wiring that unpdf has
already solved. Verified exports:

```
configureUnPDF, createIsomorphicCanvasFactory, definePDFJSModule, extractImages,
extractLinks, extractText, extractTextItems, getDocumentProxy, getMeta,
getResolvedPDFJS, renderPageAsImage, resolvePDFJSImport
```

```ts
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { readFile } from 'node:fs/promises';

const raw = await readFile(filePath);
const doc = await getDocumentProxy(new Uint8Array(raw)); // parse ONCE
const { totalPages, text } = await extractText(doc, { mergePages: true });
const meta = await getMeta(doc);
// -> totalPages: 1, text: string, meta.info.Title: 'Gradient Descent'
```

`mergePages: true` → `text` is a **string**; `mergePages: false` → `text` is a
**string[]** (one per page). Per-page is better for us: page boundaries are a useful
scene-splitting hint for the heuristic planner.

- **GOTCHA (crashes):** pdf.js **transfers/detaches** the input `Uint8Array`. After one
  call its `byteLength` is **0**, and reusing it throws
  `DOMException: Cannot transfer object of unsupported type`. Verified:

  ```
  extractText(shared)            -> 1
  shared.byteLength              -> 0      ← detached
  extractText(shared) again      -> THREW DOMException
  ```

  **Fix:** call `getDocumentProxy(new Uint8Array(raw))` once and pass the **proxy** to
  `extractText`/`getMeta`/`extractLinks`, or hand every call its own fresh
  `new Uint8Array(raw)`. Never reuse the array.

- **GOTCHA (noisy, harmless):** on Node 22 you get repeated
  `Warning: TypeError: Math.sumPrecise is not a function` plus
  `Cannot substitute the font because of its name: …`. `Math.sumPrecise` does not exist
  in Node 22.17 (it is Node 24+); pdf.js catches it and **text extraction is still
  correct**. These go to pdf.js's warn channel, not stderr-as-failure — do not treat them
  as errors. Silence them via `configureUnPDF` if they pollute CLI output.

### .docx — `mammoth`

`mammoth@1.12.0`, CJS with `lib/index.d.ts`. Typed API:

```ts
import mammoth from 'mammoth';

const { value, messages } = await mammoth.extractRawText({ path: filePath });
// or, to keep heading structure for the planner:
const { value: html } = await mammoth.convertToHtml({ path: filePath });
```

`Input` is `{ path: string } | { buffer: Buffer }` in Node. `extractRawText` loses
headings; **prefer `convertToHtml` then feed the HTML through turndown** so the planner
can see `#`/`##` structure — the IR's scene split should follow document structure.
Heavy dep tree (bluebird, jszip, underscore, @xmldom/xmldom, …) but it is the only
credible .docx option.

### URL → markdown — `cheerio` + `turndown`

`turndown@7.2.4` — one dep (`@mixmark-io/domino`, a pure-JS DOM, so **no jsdom and no
browser needed**). `main` is CJS, `module` is ESM, no `exports` map. Verified working:

```ts
import TurndownService from 'turndown';

const td = new TurndownService({
  headingStyle: 'atx', // "# H1" rather than underlines
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
td.remove(['nav', 'script', 'style', 'header', 'footer', 'aside']);
const markdown = td.turndown(html);
```

Real output from a test document:

```markdown
# Gradient Descent

An _iterative_ optimisation algorithm.

## Update rule

- Compute the gradient
- Step downhill
```

w = w - lr * grad

```

See [the docs](https://example.com/docs).
```

Note `td.remove([...])` **does** drop `<nav>` (verified — "skip me" is absent), and
turndown indents list items with three spaces after the marker. Both are fine for a
planner that only needs headings/lists/paragraphs.

`cheerio@1.2.0` is `"type": "module"` with a full `exports` map (`.`, `./slim`,
`./utils`) and `engines.node >= 20.18.1`:

```ts
import * as cheerio from 'cheerio';

const $ = cheerio.load(html);
$('nav, script, style, header, footer, aside, noscript, iframe').remove();
const main = $('main').html() ?? $('article').html() ?? $('body').html() ?? '';
const markdown = td.turndown(main);
```

Use cheerio to **pick the content root and strip site chrome**, then turndown to convert.
cheerio bundles `undici`, so fetching is available, but plain `fetch` is in Node 22 —
just use that and give cheerio the HTML string.

**VERDICT: USE `unpdf` (PDF), `mammoth` → HTML → `turndown` (.docx), `cheerio` + `turndown`
(URL). AVOID raw `pdfjs-dist`** (unpdf already solves the worker/canvas wiring for zero
extra deps). The detached-`Uint8Array` gotcha is the one thing that will crash ingest.

---

## 9. @anthropic-ai/sdk — opt-in cloud planner

**Version 0.115.0.** Install `@anthropic-ai/sdk`. Package is `"type": "commonjs"` but the
`exports` map provides `./index.mjs` for `import`, so ESM works. Runtime deps:
`standardwebhooks`, `json-schema-to-ts`. Verified by real import on Node 22:

```
default export: function Anthropic
messages.create / stream / parse / countTokens : function
beta.messages.toolRunner                        : function
Anthropic.APIError / Anthropic.RateLimitError   : function
```

```ts
import Anthropic from '@anthropic-ai/sdk';
```

### Current Claude model ids

| Model             | Model id            | Context | In / Out per MTok |
| ----------------- | ------------------- | ------- | ----------------- |
| Claude Opus 5     | `claude-opus-5`     | 1M      | $5 / $25          |
| Claude Sonnet 5   | `claude-sonnet-5`   | 1M      | $3 / $15          |
| Claude Haiku 4.5  | `claude-haiku-4-5`  | 200K    | $1 / $5           |
| Claude Opus 4.8   | `claude-opus-4-8`   | 1M      | $5 / $25          |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M      | $3 / $15          |

**Default to `claude-opus-5`.** Ids are complete as written — **never append a date
suffix**. For the planner, `claude-sonnet-5` is a reasonable cost-tier option.

Two API rules for current models: **`temperature` / `top_p` / `top_k` are rejected with a
400**, and thinking is `thinking: { type: 'adaptive' }` (**`budget_tokens` is a 400**;
adaptive is already the default on `claude-opus-5`). Depth is controlled with
`output_config: { effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }`.

### Structured JSON — preferred: `output_config.format`

For planning we want a `Storyboard` back. The modern, recommended path is structured
outputs, not a tool:

```ts
const res = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000,
  system: PLANNER_SYSTEM,
  messages: [{ role: 'user', content: doc.text }],
  output_config: { format: { type: 'json_schema', schema: storyboardJsonSchema } },
});
```

Note it is `output_config.format` — the old top-level `output_format` is deprecated.
Structured outputs are supported on `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`
and `claude-haiku-4-5`.

### Structured JSON via forced `tool_choice` + `input_schema` (portable fallback)

Works on every model, so keep it as the fallback path:

```ts
const res = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000,
  system: PLANNER_SYSTEM,
  messages: [{ role: 'user', content: doc.text }],
  tools: [
    {
      name: 'emit_storyboard',
      description: 'Emit the finished storyboard for this document.',
      strict: true, // top-level, NOT on tool_choice
      input_schema: storyboardJsonSchema, // needs additionalProperties:false + required
    },
  ],
  tool_choice: { type: 'tool', name: 'emit_storyboard' }, // forces the call
});

const block = res.content.find((b) => b.type === 'tool_use');
if (!block) throw new Error('planner returned no tool_use block');
const storyboard = parseStoryboard(block.input); // zod is the real gate
```

`strict: true` goes on the **tool definition**, alongside `name`/`description`/
`input_schema` — not on `tool_choice`. It requires `additionalProperties: false` plus
`required` on every object.

### Getting the JSON Schema out of the Storyboard zod schema

`packages/core` pins **`zod@^3.24.1`**, and I verified **`z.toJSONSchema` is `undefined`**
on zod 3 (it is a zod 4 API). So the adapter needs `zod-to-json-schema@^3.25.2`:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Storyboard } from '@inkcast/core';

const schema = zodToJsonSchema(Storyboard, { target: 'jsonSchema7', $refStrategy: 'none' });
```

Verified output already includes `additionalProperties: false` and `required`, which is
exactly what `strict: true` needs. Two adjustments before sending:

- Delete the emitted `$schema` key.
- **Numeric and array constraints are not supported** by strict tool use / structured
  outputs — `.min(1)` becomes `minItems: 1` (verified in the output) and `z.number().min(0)`
  becomes `minimum`. Strip them, or accept that only `additionalProperties`/`required`/
  `enum`/`type` are enforced. Recursive schemas are also unsupported; `$refStrategy: 'none'`
  inlines refs, which is why it is set above.

**Always re-validate with `parseStoryboard()`** regardless of which path produced the
JSON — the zod schema, not the API, is the contract.

### Zero-key behaviour (hard requirement)

`ANTHROPIC_API_KEY` is not set in this environment, and `new Anthropic()` with no
credentials does **not** throw at construction — it fails at request time. So gate on the
env var and never construct the client unless it is present:

```ts
if (!process.env.ANTHROPIC_API_KEY) {
  log.warn('ANTHROPIC_API_KEY not set — using the local heuristic planner');
  return heuristicPlan(doc, opts);
}
```

Catch `Anthropic.APIError` subclasses (`RateLimitError`, `AuthenticationError`) and fall
back to the heuristic planner rather than failing the run.

**VERDICT: USE, strictly as an opt-in adapter behind `ANTHROPIC_API_KEY`.** The
heuristic planner remains the default. Prefer `output_config.format`; keep forced
`tool_choice` as the portable fallback; validate with zod either way. Adds
`zod-to-json-schema` as a real dependency because core is on zod 3.

---

## 10. macOS `say` — zero-dependency offline TTS fallback

**Tested for real on this machine.** `/usr/bin/say` is present with **177 voices**.

### The exact commands

```bash
# Direct to 16 kHz mono 16-bit WAV — no ffmpeg needed at all:
say --file-format=WAVE --data-format=LEI16@16000 -o out.wav "Gradient descent."
# -> RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, mono 16000 Hz

# With a chosen voice and speaking rate (words per minute):
say -v Samantha -r 175 -o out.aiff "Gradient descent walks downhill on the loss surface."

# AIFF -> 16 kHz mono WAV via ffmpeg:
ffmpeg -y -v error -i out.aiff -ac 1 -ar 16000 -c:a pcm_s16le out.wav

# Measure it:
ffprobe -v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 out.aiff
# -> 4.674694
```

Verified: the ffmpeg conversion produced `pcm_s16le / 16000 Hz / 1 channel`, duration
`4.674750` vs the source's `4.674694` — a 56 µs difference from frame alignment, which is
irrelevant for `scene.durationSec`.

- **GOTCHA:** `say -o file.aiff --data-format=LEI16@22050` **fails** with
  `Opening output file failed: fmt?`. The container is inferred from the **extension**,
  and little-endian PCM cannot go in an AIFF. Either use a `.wav` extension, or pass
  `--file-format=WAVE` explicitly. Being explicit is better — `say --file-format=WAVE
--data-format=LEI16@16000 -o out.wav` writes the exact format we want in one step and
  skips ffmpeg entirely.
- Default (`say -o out.aiff "…"`) writes **AIFF-C compressed** audio, which then needs the
  ffmpeg step. Prefer the explicit WAVE form.
- `say -v '?'` lists voices as `Name  locale  # example`; filter to `en_` locales.

Wire it as the last-resort provider in the voice stage: `process.platform === 'darwin'`
plus a successful `say -v '?'` probe. It is macOS-only, so it cannot be the primary
local engine — but it needs **no download, no model, and no network**, which makes it the
right answer when the Kokoro weight download fails or hasn't happened yet.

**VERDICT: USE as a macOS-only fallback, never as the default.** Quality is well below
Kokoro's and it doesn't exist on Linux/Windows, but it is genuinely zero-dependency and
zero-network, and it produces the 16 kHz mono WAV plus a measurable duration the IR
needs. Kokoro (§1) stays the documented local default.

---

## Cross-cutting notes for build agents

1. **Node 22, not 24.** `Math.sumPrecise` is missing (unpdf warns), and `unpdf` declares
   `engines.node >= 22` while `pdfjs-dist` wants `>= 22.13`. Root `engines` says
   `>= 20.11`. Don't rely on Node 24 APIs.
2. **CJS/ESM per library** — get these right the first time:

   | Import     | Correct form                                                              |
   | ---------- | ------------------------------------------------------------------------- |
   | roughjs    | `import rough from 'roughjs/bundled/rough.esm.js'` (**subpath required**) |
   | dagre      | `import * as dagre from '@dagrejs/dagre'`                                 |
   | elkjs      | `import ELK from 'elkjs/lib/elk.bundled.js'`                              |
   | playwright | `import { chromium } from 'playwright'`                                   |
   | unpdf      | `import { extractText, getDocumentProxy } from 'unpdf'`                   |
   | mammoth    | `import mammoth from 'mammoth'` (CJS default interop)                     |
   | turndown   | `import TurndownService from 'turndown'` (CJS default interop)            |
   | cheerio    | `import * as cheerio from 'cheerio'`                                      |
   | kokoro-js  | `import { KokoroTTS } from 'kokoro-js'`                                   |
   | anthropic  | `import Anthropic from '@anthropic-ai/sdk'`                               |
   | vectorizer | `await import('@neplex/vectorizer')` (lazy, optional)                     |

3. **Everything optional must be lazily imported inside a `try`/`catch`** and degrade with
   one `logger.warn` line: `@neplex/vectorizer`, `@anthropic-ai/sdk`, `elkjs`.
4. **Two seeded-randomness sources to lock down** for cache-stable output: roughjs
   (`{ seed, randomizer: undefined }`, §2) and anything in the render page (seed in Node,
   never in the browser).
5. **Cache keys** — use `hash()` / `isFresh()` / `markFresh()` from
   `@inkcast/core`'s `project.ts`. Model weights are _not_ project artefacts; cache them
   outside `projects/<id>/`.
