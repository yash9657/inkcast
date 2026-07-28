/**
 * The render page.
 *
 * One HTML document, two modes. `capture` is what Playwright screenshots;
 * `preview` is the same document plus a clock and a transport bar for the studio
 * to iframe. The animation code (`page/runtime.js`) is byte-identical in both —
 * that is the whole point, and it is why the preview cannot drift away from the
 * mp4.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storyboard } from '@inkcast/core';
import { compilePlan } from './compile.js';
import { resolveFont } from './font.js';
import type { RenderPlan } from './types.js';

let pageDir: string | null = null;

/** Works both from `src/` (dev, TS consumed directly) and from `dist/`. */
function resolvePageDir(): string {
  if (pageDir) return pageDir;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, 'page'), path.join(here, '..', 'src', 'page')];
  for (const c of candidates) {
    if (existsSync(path.join(c, 'runtime.js'))) {
      pageDir = c;
      return c;
    }
  }
  throw new Error(
    `@inkcast/render: cannot find the animation runtime (looked in ${candidates.join(', ')})`,
  );
}

const sourceCache = new Map<string, string>();

function pageSource(name: string): string {
  const file = path.join(resolvePageDir(), name);
  let src = sourceCache.get(file);
  if (src === undefined) {
    src = readFileSync(file, 'utf8');
    sourceCache.set(file, src);
  }
  return src;
}

/** Safe to drop inside a `<script>`: no closing tag, no line separators. */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type PageOptions = {
  mode: 'capture' | 'preview';
  fontCss: string;
  title?: string;
  /** Preview only: narration to play alongside the clock. */
  audioSrc?: string;
};

const PREVIEW_CSS = `
:root { color-scheme: light dark; --ic-fg: #1b232e; --ic-bg: #f4f3f0; --ic-panel: rgba(255,255,255,0.82); --ic-line: rgba(27,35,46,0.14); --ic-accent: #2f6fed; }
@media (prefers-color-scheme: dark) {
  :root { --ic-fg: #e7e9ec; --ic-bg: #0f1216; --ic-panel: rgba(22,26,32,0.86); --ic-line: rgba(231,233,236,0.16); --ic-accent: #6f9cff; }
}
body { background: var(--ic-bg); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 12px; padding: 12px; box-sizing: border-box; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ic-fg); }
#stage { width: 100%; max-width: 100%; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 2px rgba(27,35,46,0.06), 0 8px 24px -8px rgba(27,35,46,0.18); }
.ic-bar { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 720px; padding: 8px 12px; border: 1px solid var(--ic-line); border-radius: 999px; background: var(--ic-panel); backdrop-filter: blur(8px); box-sizing: border-box; }
.ic-btn { position: relative; width: 30px; height: 30px; flex: none; border: 0; border-radius: 999px; background: var(--ic-accent); cursor: pointer; }
.ic-btn::before { content: ""; position: absolute; inset: 0; margin: auto; width: 0; height: 0; border-style: solid; border-width: 6px 0 6px 10px; border-color: transparent transparent transparent #fff; transform: translateX(1px); }
.ic-btn.is-playing::before { width: 9px; height: 11px; border: 0; background: linear-gradient(to right, #fff 0 3px, transparent 3px 6px, #fff 6px 9px); transform: none; }
.ic-btn:focus-visible { outline: 2px solid var(--ic-accent); outline-offset: 3px; }
.ic-track { position: relative; flex: 1; height: 6px; border-radius: 999px; background: var(--ic-line); cursor: pointer; touch-action: none; }
.ic-fill { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 999px; background: var(--ic-accent); }
.ic-ticks i { position: absolute; top: -3px; width: 1px; height: 12px; background: var(--ic-fg); opacity: 0.28; }
.ic-time { flex: none; font-variant-numeric: tabular-nums; opacity: 0.72; }
`;

export function buildPageHtml(plan: RenderPlan, opts: PageOptions): string {
  const capture = opts.mode === 'capture';
  const { w, h } = plan.frame;
  const baseCss = `
*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
html, body { margin: 0; padding: 0; }
body { -webkit-font-smoothing: antialiased; }
#stage { background: ${plan.paper}; }
svg { display: block; }
`;
  const captureCss = `
html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: ${plan.paper}; }
#stage { width: ${w}px; height: ${h}px; }
`;
  const previewStage = `#stage { aspect-ratio: ${w} / ${h}; }`;

  const audio =
    !capture && opts.audioSrc
      ? `<audio id="inkcast-audio" preload="auto" src="${escapeHtml(opts.audioSrc)}"></audio>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title ?? 'Inkcast')}</title>
<style>
${opts.fontCss}
${baseCss}
${capture ? captureCss : PREVIEW_CSS + previewStage}
</style>
</head>
<body>
<div id="stage"></div>
${audio}
<script>window.__INKCAST_MODE__ = ${embedJson(opts.mode)};
window.__INKCAST_PLAN__ = ${embedJson(plan)};</script>
<script>
${pageSource('runtime.js')}
</script>
${capture ? '' : `<script>\n${pageSource('preview.js')}\n</script>`}
</body>
</html>`;
}

export type PreviewOptions = {
  /** Narration URL as the browser will see it. Default `audio/narration.wav`. */
  audioSrc?: string | null;
  /** Explicit handwriting font file. */
  fontPath?: string;
  /** Draw the faint board grid. Default true. */
  grid?: boolean;
};

/**
 * The studio's instant preview: the finished animation with a real clock, no
 * rendering, no ffmpeg, no Chromium. Serve the returned string (or write it to a
 * file next to `<dir>/audio/`) and iframe it.
 */
export function buildPreviewHtml(sb: Storyboard, dir: string, opts: PreviewOptions = {}): string {
  const font = resolveFont(sb.meta.style, dir, opts.fontPath);
  const plan = compilePlan(sb, dir, {
    fontFamily: font.family,
    ...(opts.grid === undefined ? {} : { grid: opts.grid }),
  });
  const audioSrc = opts.audioSrc === undefined ? 'audio/narration.wav' : opts.audioSrc;
  return buildPageHtml(plan, {
    mode: 'preview',
    fontCss: font.css,
    title: `${sb.title} — Inkcast preview`,
    ...(audioSrc ? { audioSrc } : {}),
  });
}
