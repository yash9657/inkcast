#!/usr/bin/env node
/**
 * screens.mjs — photograph the whole web surface, in both themes, into `.screens/`.
 *
 * This is the gate for `docs/PLAN-LAUNCH.md` C3/C5 ("Playwright screenshots of `/`,
 * `/studio`, generation in progress, result, `/library`, `/share/:id` in both
 * themes"). It exists because the launch build's entire visual layer — the C1
 * token swap, the C3 component sweep, the C4 logo, the C5 landing page — had
 * been written, typechecked and committed without one pixel of it ever being
 * looked at. Reading CSS tokens tells you what a colour is; it does not tell you
 * that a 10px accent shadow is smearing into the rule below it. So: boot the app,
 * drive a real browser, write PNGs, and then *look at them*.
 *
 * ## Four decisions that are load-bearing
 *
 * 1. **The theme is forced by attribute, never by clicking the toggle.**
 *    `components/ui/providers.tsx` runs next-themes with
 *    `attribute={['class','data-theme']}`, `defaultTheme="system"` and
 *    `storageKey="inkcast-theme"`. So we seed that key in `localStorage` *and*
 *    stamp `class`/`data-theme` in an init script, *and* set Playwright's
 *    `colorScheme` to match. All three, because each one alone has a hole:
 *    localStorage alone flashes the system theme until hydration, the attribute
 *    alone is overwritten by next-themes' own inline script, and `colorScheme`
 *    alone only decides what "system" resolves to. Clicking the toggle would
 *    make the screenshot depend on the very component under test.
 *
 * 2. **Every page is scrolled to the bottom before it is photographed.**
 *    `components/marketing/reveal.tsx` animates from `opacity: 0` on an
 *    IntersectionObserver. A `fullPage` screenshot does not scroll, so without
 *    this pass the landing page photographs as a hero above four screens of
 *    blank paper — a fake defect that would eat the whole review. We scroll in
 *    viewport-sized steps, let each step settle, and come back to the top. We do
 *    NOT inject `[data-reveal]{opacity:1}`: that would also mask a reveal that
 *    is genuinely broken.
 *
 * 3. **A focus pass, because an invisible focus ring is the defect a screenshot
 *    of a resting page cannot show.** For `/` and `/studio` we press Tab a few
 *    times and photograph the viewport, in both themes. `globals.css` gives
 *    `focus-ring` a 2px `--ring` outline at 2px offset, and the brutalist 1px ink
 *    border sits exactly where that outline lands — this is how we find out
 *    whether it survives.
 *
 * 4. **It never touches the real `projects/` directory.** `INKCAST_PROJECTS`
 *    must point at a scratch copy before this script runs (the runner sets it);
 *    if it is unset we refuse rather than let a screenshot run mutate somebody's
 *    films. Provider keys are likewise stubbed to invalid non-empty strings,
 *    because `packages/keyvault/src/hydrate.ts` copies real keychain keys into
 *    `process.env` for anything that does not already have a value, and a page
 *    that lists "configured providers" must not be the thing that spends money.
 *
 * Usage:
 *   INKCAST_PROJECTS=/tmp/screens-projects node scripts/screens.mjs
 *
 * Environment:
 *   SCREENS_PROJECT_ID  project id for /project/:id and /share/:id (required for
 *                       those two routes; they are skipped, loudly, without it)
 *   SCREENS_MODE        'start' (default, needs a completed `next build`) or
 *                       'dev' (compiles on demand — use when another workstream
 *                       has the shared packages mid-edit and the build cannot
 *                       typecheck)
 *   SCREENS_PORT        default 3187
 *   SCREENS_BASE        attach to an already-running server instead of booting
 *   SCREENS_OUT         default <repo>/.screens
 *   SCREENS_ONLY        comma-separated substrings; only matching shot names run
 *   SCREENS_APP_DIR     run the server from this directory instead of
 *                       `apps/web`. `next dev` refuses to start a second server
 *                       in a directory that already has one ("Another next dev
 *                       server is already running"), which is exactly the state
 *                       a parallel workstream leaves the repo in. Pointing this
 *                       at a mirror — the app tree copied, with `node_modules`,
 *                       `assets` and `packages` symlinked back — gets a picture
 *                       of the current components without killing somebody
 *                       else's server. Prefer `start` against the real app dir
 *                       whenever the build is green; a mirror photographs a
 *                       copy, so it has to be re-synced after every edit.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const webDir = process.env.SCREENS_APP_DIR
  ? path.resolve(process.env.SCREENS_APP_DIR)
  : path.join(repoRoot, 'apps', 'web');

const OUT = process.env.SCREENS_OUT ?? path.join(repoRoot, '.screens');
const PORT = Number(process.env.SCREENS_PORT ?? 3187);
const MODE = process.env.SCREENS_MODE === 'dev' ? 'dev' : 'start';
/*
 * `localhost`, NOT `127.0.0.1`, and this cost an hour the first time.
 *
 * Next 16 blocks cross-origin requests to dev resources unless the host is in
 * `allowedDevOrigins`, and it treats `127.0.0.1` as a different origin from the
 * `localhost` the dev server binds. The block is silent in the browser: the HTML
 * is served 200, the page paints, and `main-app.js` never executes — so React
 * never hydrates, every `motion` reveal stays at its `initial` `opacity: 0`, and
 * the landing page photographs as a header above five screens of blank paper.
 * Measured: at `127.0.0.1` the mobile drawer trigger click opens 0 dialogs and
 * `[data-reveal]` computes to opacity 0; at `localhost`, 1 dialog and opacity 1,
 * same server, same commit. Anyone tempted to "fix" a blank screenshot by
 * forcing `[data-reveal]{opacity:1}` should read this paragraph first.
 */
const BASE = process.env.SCREENS_BASE ?? `http://localhost:${PORT}`;
const PROJECT_ID = process.env.SCREENS_PROJECT_ID ?? '';
const ONLY = (process.env.SCREENS_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Desktop is the design target; 360x800 is the smallest phone C5 must survive. */
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

const THEMES = ['light', 'dark'];

function shots() {
  const list = [];
  const routes = [
    { name: 'home', url: '/' },
    { name: 'studio', url: '/studio' },
    { name: 'library', url: '/library' },
  ];
  if (PROJECT_ID) {
    routes.push({ name: 'project', url: `/project/${PROJECT_ID}` });
    routes.push({ name: 'share', url: `/share/${PROJECT_ID}` });
  }
  for (const route of routes) {
    for (const theme of THEMES) {
      list.push({ ...route, theme, viewport: DESKTOP, fullPage: true });
    }
  }
  for (const theme of THEMES) {
    list.push({ name: 'home-360', url: '/', theme, viewport: MOBILE, fullPage: true });
  }
  // Focus passes: viewport only, because the point is the ring on the control
  // that has focus, not the page under it.
  for (const theme of THEMES) {
    list.push({ name: 'home-focus', url: '/', theme, viewport: DESKTOP, fullPage: false, tabs: 4 });
    list.push({
      name: 'studio-focus',
      url: '/studio',
      theme,
      viewport: DESKTOP,
      fullPage: false,
      tabs: 6,
    });
  }
  return list.filter(
    (s) => ONLY.length === 0 || ONLY.some((f) => `${s.name}-${s.theme}`.includes(f)),
  );
}

/* --------------------------------------------------------------- the server */

/** Invalid but PRESENT: hydrateKeys() treats any non-empty value as final. */
const NO_SPEND = {
  ANTHROPIC_API_KEY: 'disabled-no-spend',
  ELEVENLABS_API_KEY: 'disabled-no-spend',
  FAL_KEY: 'disabled-no-spend',
  REPLICATE_API_TOKEN: 'disabled-no-spend',
  OPENAI_API_KEY: 'disabled-no-spend',
};

async function waitForServer(base, deadlineMs) {
  const until = Date.now() + deadlineMs;
  for (;;) {
    try {
      const res = await fetch(base, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > until) throw new Error(`server never answered on ${base}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function bootServer() {
  // pnpm links each package's own bins, and `next` is a dependency of
  // apps/web rather than of the root, so it is only in the app's .bin.
  const bin = path.join(webDir, 'node_modules', '.bin', 'next');
  const args =
    MODE === 'dev'
      ? ['dev', '--webpack', '--port', String(PORT)]
      : ['start', '--port', String(PORT)];
  const child = spawn(bin, args, {
    cwd: webDir,
    env: {
      ...process.env,
      ...NO_SPEND,
      NODE_ENV: MODE === 'dev' ? 'development' : 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      // The landing page's format row hotlinks showcase films by id; leaving
      // these unset is the state a fresh deploy is in, which is the state worth
      // photographing (the cards fall back to a drawn sketch).
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(d.toString()));
  child.stderr.on('data', (d) => log.push(d.toString()));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`\n[screens] server exited ${code}:\n${log.join('')}\n`);
    }
  });
  return { child, log };
}

/* -------------------------------------------------------------- the capture */

/**
 * Wait until the page is worth photographing.
 *
 * Three things, each of which produced a misleading screenshot before it was
 * added:
 *
 * 1. **Fonts.** A shot taken mid-swap photographs the fallback stack, and every
 *    judgement about type in it is a judgement about Helvetica.
 * 2. **Skeletons.** `/library` and `/project/:id` fetch on the client. The first
 *    run of this script photographed `/library` as six shimmer boxes and the
 *    caption "Reading the projects directory…", which says nothing about the
 *    card design that was the point of the shot.
 * 3. **The hero board.** `components/marketing/ink-demo.tsx` performs a 28-beat
 *    drawing over `28 x --transition-duration-slower` = 13.4s, with a camera
 *    that tours three framings. Photographed at 3s it is a half-written label
 *    inside a mid-pan — which reads exactly like a text-clipping bug and was
 *    briefly reported as one. The finished board is the honest frame: title,
 *    plot, three annotations, nothing cut.
 */
async function settle(page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(400);

  // Client-fetched views: give the data a chance, then stop waiting. A route
  // that never resolves is itself a finding, so this must not throw.
  await page
    .waitForFunction(() => document.querySelectorAll('[data-slot="skeleton"]').length === 0, {
      timeout: 15_000,
    })
    .catch(() => {});

  if (await page.locator('.inkcast-demo').count()) {
    // One beat is --transition-duration-slower; read it rather than hardcoding
    // 480ms, so a change to the motion token cannot silently desync this wait
    // from the animation it is waiting for.
    const beatMs = await page.evaluate(() => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--transition-duration-slower')
        .trim();
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return 480;
      return raw.endsWith('ms') ? n : n * 1000;
    });
    await page.waitForTimeout(beatMs * 28 + 1200);
  }
}

async function scrollThrough(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  const step = page.viewportSize()?.height ?? 800;
  for (let y = 0; y < height + step; y += step) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(220);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

async function capture(browser, shot) {
  const context = await browser.newContext({
    viewport: shot.viewport,
    colorScheme: shot.theme,
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference',
  });
  // Seeded before any document script runs, so next-themes' inline script reads
  // our choice out of storage rather than resolving `system`.
  await context.addInitScript(
    ({ theme, key }) => {
      try {
        window.localStorage.setItem(key, theme);
      } catch {
        /* storage can be denied; the attribute below still lands */
      }
      const stamp = () => {
        // `documentElement` is null while an init script runs against
        // about:blank, so this is a guard rather than defensive noise: without
        // it every page logs a TypeError that looks like an app bug in the
        // report.
        const html = document.documentElement;
        if (!html) return;
        html.setAttribute('data-theme', theme);
        html.classList.toggle('dark', theme === 'dark');
        html.style.colorScheme = theme;
      };
      stamp();
      document.addEventListener('DOMContentLoaded', stamp);
    },
    { theme: shot.theme, key: 'inkcast-theme' },
  );

  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${String(err).slice(0, 300)}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`http ${res.status()} ${res.url().replace(BASE, '')}`);
  });

  const response = await page.goto(`${BASE}${shot.url}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await settle(page);
  if (shot.fullPage) await scrollThrough(page);

  if (shot.tabs) {
    for (let i = 0; i < shot.tabs; i += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(120);
    }
    problems.push(
      `focus after ${shot.tabs} tabs: ${await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return 'body (nothing focused)';
        const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
        return `<${el.tagName.toLowerCase()}> ${label}`;
      })}`,
    );
  }

  const file = path.join(OUT, `${shot.name}-${shot.theme}.png`);
  await page.screenshot({ path: file, fullPage: Boolean(shot.fullPage) });
  const status = response?.status() ?? 0;
  await context.close();
  const slices = shot.fullPage ? await slice(file, shot.viewport.height * 2) : [];
  return { file: path.relative(repoRoot, file), status, problems, slices };
}

/**
 * Cut a tall full-page shot into viewport-sized panes.
 *
 * A full landing page is ~14,500 device pixels tall. Anything that looks at it —
 * a person on a laptop, or a model with a 1,568px input cap — sees it at roughly
 * a tenth scale, where 13px body copy is two grey pixels and "unreadable text"
 * is indistinguishable from "text". The panes are what actually gets reviewed;
 * the whole-page file stays because it is the only artefact that shows section
 * rhythm and where the fold lands.
 */
async function slice(file, paneHeight) {
  const image = sharp(file);
  const { width, height } = await image.metadata();
  if (!width || !height || height <= paneHeight * 1.2) return [];
  const out = [];
  for (let i = 0, top = 0; top < height; i += 1, top += paneHeight) {
    const h = Math.min(paneHeight, height - top);
    // A sliver of a pane is a scrollbar's worth of nothing; fold it into the
    // previous one by stopping instead.
    if (h < paneHeight * 0.2 && out.length > 0) break;
    const target = file.replace(/\.png$/, `.p${i + 1}.png`);
    await sharp(file).extract({ left: 0, top, width, height: h }).toFile(target);
    out.push(path.basename(target));
  }
  return out;
}

/* ------------------------------------------------------------------ the run */

async function main() {
  if (!process.env.INKCAST_PROJECTS) {
    throw new Error(
      'INKCAST_PROJECTS is not set. Point it at a scratch copy of projects/ — a screenshot run must never write into the real one.',
    );
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  let server;
  if (!process.env.SCREENS_BASE) {
    server = bootServer();
    process.stdout.write(`[screens] booting next ${MODE} on ${BASE}\n`);
  }
  const results = [];
  let browser;
  try {
    await waitForServer(BASE, 180_000);
    browser = await chromium.launch();
    for (const shot of shots()) {
      const name = `${shot.name}-${shot.theme}`;
      try {
        const result = await capture(browser, shot);
        results.push({ name, url: shot.url, ...result });
        process.stdout.write(
          `[screens] ${name.padEnd(18)} ${String(result.status).padEnd(4)} ${result.file}\n`,
        );
        for (const p of result.problems) process.stdout.write(`           · ${p}\n`);
      } catch (err) {
        results.push({ name, url: shot.url, error: String(err).slice(0, 400) });
        process.stdout.write(`[screens] ${name.padEnd(18)} FAILED ${String(err).slice(0, 200)}\n`);
      }
    }
  } finally {
    await browser?.close();
    if (server) {
      server.child.kill('SIGTERM');
      // next start forks a worker; give the tree a beat to go away on its own
      // before the process exits and orphans it.
      await new Promise((r) => setTimeout(r, 500));
      server.child.kill('SIGKILL');
    }
  }

  // `.txt`, not `.json`, and the reason is the repo's own lint: `pnpm lint` is
  // `prettier --check .`, `.screens/` is not in `.prettierignore`, and prettier
  // has opinions about how a two-element array in a JSON file should wrap. A
  // machine-written report that fails the repo's format check turns a screenshot
  // run into a broken build, so the report is a format prettier does not parse.
  // `attached` when SCREENS_BASE pointed us at a server we did not start: MODE
  // is meaningless in that case, and a report that claims a production `start`
  // over somebody's dev server is a lie about what was photographed.
  const lines = [`base ${BASE}`, `mode ${process.env.SCREENS_BASE ? 'attached' : MODE}`, ''];
  for (const r of results) {
    lines.push(`${r.name.padEnd(18)} ${r.error ? 'FAILED' : r.status} ${r.file ?? ''}`);
    if (r.error) lines.push(`  error: ${r.error}`);
    for (const p of r.problems ?? []) lines.push(`  · ${p}`);
    if (r.slices?.length) lines.push(`  panes: ${r.slices.join(' ')}`);
  }
  await writeFile(path.join(OUT, 'report.txt'), `${lines.join('\n')}\n`);
  const failed = results.filter((r) => r.error || (r.status && r.status >= 400));
  process.stdout.write(`[screens] ${results.length} shots, ${failed.length} bad\n`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
