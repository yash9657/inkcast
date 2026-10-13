/**
 * Grab single frames from a project without encoding a video.
 *
 * `render()` is the only supported way to get pixels, and it costs a full encode —
 * 110 seconds of wall clock for the benchmark. A plot change is visible in about six
 * frames, so this walks the same three calls `render()` makes (font, plan, page) and
 * then seeks a CDP capturer to each timestamp, writing one PNG each.
 *
 * Not part of the package's public API and not wired into any script: it is a
 * verification tool, used from the repo root as
 *
 *     npx tsx packages/render/src/frames.mts <projectDir> <outDir> [t...]
 *
 * With no timestamps it takes eight evenly spaced frames across the film.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadStoryboard } from '@inkcast/core';
import { launchChromium, openCapture } from './browser.js';
import { compilePlan } from './compile.js';
import { resolveFont } from './font.js';
import { buildPageHtml } from './html.js';

const [dir, outDir, ...stamps] = process.argv.slice(2);
if (!dir || !outDir) {
  console.error('usage: frames.mts <projectDir> <outDir> [seconds...]');
  process.exit(2);
}

const sb = await loadStoryboard(dir);
const font = resolveFont(sb.meta.style, dir);
const plan = compilePlan(sb, dir, { fontFamily: font.family });
const times =
  stamps.length > 0
    ? stamps.map(Number)
    : Array.from({ length: 8 }, (_, i) => ((i + 0.5) / 8) * plan.duration);

await mkdir(outDir, { recursive: true });
const html = buildPageHtml(plan, { mode: 'capture', fontCss: font.css, title: sb.title });
const browser = await launchChromium();
const cap = await openCapture(browser, plan.frame, html);
try {
  for (const t of times) {
    await cap.seek(t);
    const file = path.join(outDir, `t${t.toFixed(2).replace('.', '_')}.png`);
    await cap.savePng(file);
    console.log(`${file}  (t=${t.toFixed(2)}s)`);
  }
} finally {
  await cap.close();
  await browser.close();
}
console.log(
  `\n${times.length} frames, ${plan.duration.toFixed(2)}s film, ${plan.items.length} items`,
);
