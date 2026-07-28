/**
 * `inkcast preview <id>` — serve the project on localhost.
 *
 * If the renderer left its `preview.html` in the project directory, that is what
 * `/` serves: it is the same deterministic page the frames were captured from,
 * so it is the honest preview. `/player` is always available — a small page
 * built from the storyboard with the finished mp4 and a clickable scene list, so
 * you can jump straight to the beat you want to fix before running `edit`.
 *
 * Nothing is written, nothing leaves the machine, and the server binds to
 * 127.0.0.1 only.
 */
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { loadStoryboard, sceneOffsets, totalDuration, type Storyboard } from '@inkcast/core';
import type { CliContext } from '../env.js';
import type { Flags } from '../main.js';
import { clock, paint } from '../ui.js';
import { openInOs, resolveProject } from './shared.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export async function previewCommand(
  ctx: CliContext,
  id: string | undefined,
  flags: Flags,
): Promise<number> {
  const c = paint(ctx.color);
  const project = await resolveProject(id);
  const dir = project.dir;
  const rendererPage = path.join(dir, 'preview.html');
  const hasRendererPage = existsSync(rendererPage);

  const server = createServer((req, res) => {
    handle(req, res, dir, project.videoPath, hasRendererPage).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('preview failed');
    });
  });

  const port = await listen(server, flags.port ?? 4321);
  const url = `http://127.0.0.1:${port}/`;

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, url, projectId: project.id })}\n`);
  } else if (!ctx.quiet) {
    const label = (s: string) => c.dim(s.padEnd(13));
    let out = `\n${c.green('▶')} ${c.bold(project.title)} ${c.dim(`· ${project.id}`)}\n\n`;
    out += `  ${label(hasRendererPage ? 'renderer page' : 'player')} ${c.cyan(url)}\n`;
    if (hasRendererPage) out += `  ${label('player')} ${c.cyan(`${url}player`)}\n`;
    out += `  ${label('storyboard')} ${c.cyan(`${url}storyboard.json`)}\n`;
    out += `\n  ${c.dim('Ctrl-C to stop.')}\n\n`;
    process.stdout.write(out);
  }
  if (flags.open) openInOs(url);

  return await new Promise<number>((resolve) => {
    const shutdown = () => {
      server.close();
      resolve(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

function listen(server: ReturnType<typeof createServer>, first: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = first;
    const attempt = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port - first < 10) {
          port++;
          attempt();
          return;
        }
        reject(err);
      });
      server.listen(port, '127.0.0.1', () => resolve(port));
    };
    attempt();
  });
}

/* ------------------------------------------------------------------ routing */

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
  videoPath: string | undefined,
  hasRendererPage: boolean,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const route = decodeURIComponent(url.pathname);

  if (route === '/' && hasRendererPage) {
    await sendFile(res, path.join(dir, 'preview.html'));
    return;
  }
  if (route === '/' || route === '/player' || route === '/player/') {
    let sb: Storyboard | undefined;
    try {
      sb = await loadStoryboard(dir);
    } catch {
      sb = undefined;
    }
    const html = playerPage(sb, Boolean(videoPath));
    res.writeHead(200, { 'content-type': MIME['.html']!, 'cache-control': 'no-store' });
    res.end(html);
    return;
  }
  if (route === '/video') {
    if (!videoPath) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no video rendered yet');
      return;
    }
    await sendFile(res, videoPath, req.headers.range);
    return;
  }

  // Everything else is served from the project directory, traversal-proof.
  const target = path.resolve(dir, `.${route}`);
  if (!target.startsWith(path.resolve(dir) + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('outside the project directory');
    return;
  }
  if (!existsSync(target)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  await sendFile(res, target, req.headers.range);
}

/** Static file with byte-range support, which video scrubbing depends on. */
async function sendFile(res: ServerResponse, file: string, range?: string): Promise<void> {
  const info = await stat(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;

  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (Number.isNaN(start) || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${info.size}`,
      'accept-ranges': 'bytes',
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

/* -------------------------------------------------------------- player page */

function playerPage(sb: Storyboard | undefined, hasVideo: boolean): string {
  const title = sb ? esc(sb.title) : 'Inkcast project';
  const offsets = sb ? sceneOffsets(sb) : [];
  const scenes = (sb?.scenes ?? [])
    .map((scene, i) => {
      const at = offsets[i] ?? 0;
      return `<li data-at="${at}"><span class="t">${clock(at)}</span><span class="n"><b>${esc(scene.id)}</b>${esc(scene.narration)}</span></li>`;
    })
    .join('\n');
  const meta = sb
    ? `${sb.scenes.length} scenes · ${clock(totalDuration(sb))} · ${esc(sb.meta.aspect)} · ${esc(sb.meta.style)} · ${esc(sb.meta.palette)} · ${esc(sb.meta.voice)} · ${esc(sb.meta.language)}`
    : 'no storyboard on disk';

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Inkcast preview</title>
<style>
  :root { color-scheme: light dark; --fg: #16181d; --bg: #fbfbfa; --muted: #6b7280; --line: #e5e7eb; --accent: #3b5bdb; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e8e8e6; --bg: #14161a; --muted: #9ca3af; --line: #2a2e35; --accent: #91a7ff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 68rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .35rem; letter-spacing: -0.01em; }
  .meta { color: var(--muted); font-size: .82rem; margin-bottom: 1.5rem; }
  video { width: 100%; background: #000; border-radius: .6rem; border: 1px solid var(--line); }
  .none { padding: 3rem 1rem; text-align: center; border: 1px dashed var(--line); border-radius: .6rem; color: var(--muted); }
  h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); margin: 2rem 0 .6rem; }
  ol { list-style: none; margin: 0; padding: 0; }
  li { display: flex; gap: .9rem; padding: .6rem .5rem; border-top: 1px solid var(--line); cursor: pointer; }
  li:hover { background: color-mix(in oklab, var(--accent) 8%, transparent); }
  li.on { background: color-mix(in oklab, var(--accent) 14%, transparent); }
  .t { color: var(--muted); font-variant-numeric: tabular-nums; font-size: .8rem; padding-top: .12rem; min-width: 3.2rem; }
  .n b { display: block; font-weight: 600; font-size: .74rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  footer { margin-top: 2.5rem; color: var(--muted); font-size: .8rem; }
  a { color: var(--accent); }
</style>
<main>
  <h1>${title}</h1>
  <div class="meta">${meta}</div>
  ${hasVideo ? '<video id="v" controls preload="metadata" src="/video"></video>' : '<div class="none">No video rendered yet — run <code>inkcast rerender</code>.</div>'}
  <h2>Scenes</h2>
  <ol id="scenes">${scenes || '<li><span class="n">no scenes</span></li>'}</ol>
  <footer>
    <a href="/storyboard.json">storyboard.json</a> · served locally by the Inkcast CLI · one persistent canvas, no slides
  </footer>
</main>
<script>
  const v = document.getElementById('v');
  const items = [...document.querySelectorAll('#scenes li[data-at]')];
  for (const li of items) {
    li.addEventListener('click', () => {
      if (!v) return;
      v.currentTime = Number(li.dataset.at);
      v.play();
    });
  }
  if (v) {
    v.addEventListener('timeupdate', () => {
      let current = null;
      for (const li of items) if (Number(li.dataset.at) <= v.currentTime + 0.01) current = li;
      for (const li of items) li.classList.toggle('on', li === current);
    });
  }
</script>
</html>
`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
