#!/usr/bin/env node
/**
 * Cuts every brand raster and standalone SVG from ./geometry.json.
 *
 *   node assets/brand/make-brand-assets.mjs [--proof <dir>]
 *
 * Writes, all of them committed artefacts:
 *
 *   assets/brand/mark.svg          the full mark, light theme, shadow included
 *   assets/brand/mark-dark.svg     the same, dark theme
 *   assets/brand/mark-icon.svg     tile only, no shadow, theme-aware, crisp edges
 *   apps/web/app/icon.svg          a copy of mark-icon.svg — Next's file convention
 *   apps/web/app/favicon.ico       16 / 32 / 48 px, PNG-compressed entries
 *   apps/web/app/apple-icon.png    180 px, opaque paper
 *   apps/web/app/opengraph-image.png  1200x630, dot grid + lockup + tagline
 *
 * `--proof <dir>` additionally writes the legibility renders the mark was tuned
 * against: 16 / 32 / 64 / 512 px plus a nearest-neighbour zoom of the small ones,
 * because the only way to know whether a 2-unit border survives 16px is to look
 * at the pixels. Those are not committed; regenerate them when you change a
 * number.
 *
 * WHY THIS IS A SCRIPT AND NOT A CHECKED-IN BLOB
 *
 * Every raster here is derived. A hand-exported favicon rots the moment the mark
 * moves and nobody can tell by reading the diff — docs/HANDOFF.md calls silent
 * degradation the dominant failure mode in this repo, and a stale icon is a
 * small pure instance of it. This script is the only path from geometry to
 * bytes, it fails loudly when logo.tsx and geometry.json disagree, and it
 * derives the literal colours from the OKLCH token values rather than letting
 * anyone type a hex.
 *
 * Zero network: Chromium comes from the local Playwright cache, the fonts are
 * the vendored woff2 files in assets/fonts, and nothing is fetched. The script
 * is a build-time tool for a human, not part of `next build`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const APP = join(ROOT, 'apps/web/app');
const { chromium } = await import(join(ROOT, 'node_modules/playwright/index.mjs'));

/* ------------------------------------------------------------------ colour */

/**
 * OKLCH -> sRGB hex. Björn Ottosson's matrices, then the sRGB transfer
 * function. Out-of-gamut components are clamped, which is safe for every token
 * here (all were picked inside sRGB and contrast-checked in globals.css) but
 * would silently lie about a wide-gamut colour, so it warns.
 */
function oklchToHex(spec) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(
    spec.trim(),
  );
  if (!m) throw new Error(`not an oklch() colour: ${spec}`);
  const [L, C, h] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : Number(m[4]);

  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  const lin = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  const hex = lin
    .map((c) => {
      if (c < -0.001 || c > 1.001) {
        console.warn(`  ! ${spec} is outside sRGB (${c.toFixed(3)}), clamped`);
      }
      const v = Math.min(1, Math.max(0, c));
      const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      return Math.round(g * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');

  return alpha === 1
    ? `#${hex}`
    : `#${hex}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')}`;
}

/* ------------------------------------------------- geometry, and its guard */

const geom = JSON.parse(readFileSync(join(HERE, 'geometry.json'), 'utf8'));
const LOGO_TSX = join(ROOT, 'apps/web/components/marketing/logo.tsx');

/**
 * The one thing that makes duplicating the geometry into a .tsx acceptable: if
 * the two copies disagree, this refuses to emit anything. Checked as literal
 * substrings rather than by parsing, because a substring check has no failure
 * mode of its own.
 */
function assertLogoMatchesGeometry() {
  const src = readFileSync(LOGO_TSX, 'utf8');
  const required = [
    geom.viewBox,
    geom.viewBoxCropped,
    geom.strokePath,
    geom.nibPath,
    `strokeWidth: ${geom.strokeWidth}`,
    `x: ${geom.tile.x}, y: ${geom.tile.y}, size: ${geom.tile.size}`,
    `x: ${geom.shadow.x}, y: ${geom.shadow.y}, size: ${geom.shadow.size}`,
  ];
  const missing = required.filter((s) => !src.includes(s));
  if (missing.length) {
    throw new Error(
      `apps/web/components/marketing/logo.tsx has drifted from assets/brand/geometry.json.\n` +
        `Not found in logo.tsx:\n  ${missing.join('\n  ')}\n` +
        `Move both or neither — the mark in the app and the mark in the favicon have to be one mark.`,
    );
  }
}

const palette = {
  light: Object.fromEntries(Object.entries(geom.tokens.light).map(([k, v]) => [k, oklchToHex(v)])),
  dark: Object.fromEntries(Object.entries(geom.tokens.dark).map(([k, v]) => [k, oklchToHex(v)])),
};

/* -------------------------------------------------------------- svg output */

/** The four shapes, in paint order, at a given palette. */
function markShapes(p, { shadow, crisp }) {
  const hint = crisp ? ' shape-rendering="crispEdges"' : '';
  const g = geom;
  return [
    shadow
      ? `<rect x="${g.shadow.x}" y="${g.shadow.y}" width="${g.shadow.size}" height="${g.shadow.size}" fill="${p.primary}"${hint}/>`
      : null,
    `<rect x="${g.tile.x}" y="${g.tile.y}" width="${g.tile.size}" height="${g.tile.size}" fill="${p.card}" stroke="${p.border}" stroke-width="${g.tile.strokeWidth}"${hint}/>`,
    `<path d="${g.strokePath}" fill="none" stroke="${p.primary}" stroke-width="${g.strokeWidth}" stroke-linecap="${g.strokeLinecap}"/>`,
    `<path d="${g.nibPath}" fill="${p.primary}"/>`,
  ]
    .filter(Boolean)
    .join('\n  ');
}

function markSvg({ theme = 'light', shadow = true, crisp = false, size = null } = {}) {
  const vb = shadow ? geom.viewBox : geom.viewBoxCropped;
  const dims = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${dims}>
  ${markShapes(palette[theme], { shadow, crisp })}
</svg>
`;
}

/**
 * The favicon. One file, two themes, via `prefers-color-scheme` inside the SVG —
 * which Chromium and Firefox honour for `rel=icon` and Safari currently ignores,
 * so the light palette is the attribute value and dark is the override. A
 * browser that understands neither still gets the correct light mark.
 *
 * No shadow and a cropped viewBox: at 16px the offset block is unresolvable
 * decoration that costs an eighth of the tile's edge. `crispEdges` on the two
 * rectangles is what keeps the 2-unit border black instead of 50% grey when it
 * lands on 0.94 of a device pixel.
 */
function iconSvg() {
  const l = palette.light;
  const d = palette.dark;
  // Each class sets BOTH fill and stroke, including the `none` half. A CSS rule
  // beats a presentation attribute, so a class that only names `stroke` would
  // silently override `fill="none"` on the cast and put a 1-unit outline around
  // the nib — the mark would be a hair fatter here than in the component, for no
  // visible reason and with nothing to notice it.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geom.viewBoxCropped}">
  <style>
    .tile { fill: ${l.card}; stroke: ${l.border}; }
    .cast-line { fill: none; stroke: ${l.primary}; }
    .cast-fill { fill: ${l.primary}; stroke: none; }
    @media (prefers-color-scheme: dark) {
      .tile { fill: ${d.card}; stroke: ${d.border}; }
      .cast-line { stroke: ${d.primary}; }
      .cast-fill { fill: ${d.primary}; }
    }
  </style>
  <rect class="tile" x="${geom.tile.x}" y="${geom.tile.y}" width="${geom.tile.size}" height="${geom.tile.size}" stroke-width="${geom.tile.strokeWidth}" shape-rendering="crispEdges"/>
  <path class="cast-line" d="${geom.strokePath}" stroke-width="${geom.strokeWidth}" stroke-linecap="${geom.strokeLinecap}"/>
  <path class="cast-fill" d="${geom.nibPath}"/>
</svg>
`;
}

/* ------------------------------------------------ the wordmark's flourish */

/**
 * `seedFrom` (FNV-1a), `randomFromSeed` (mulberry32) and `inkStrokePath` from
 * apps/web/lib/utils.ts and apps/web/components/ui/ink.tsx, transcribed because
 * this script cannot import a .tsx and the OG image's wordmark has to carry the
 * same hand stroke under the `k` that the live lockup does. Same seed, same
 * numbers, same path — verified by eye against the rendered component, and the
 * generated `d` is printed on every run so a change is visible in the log.
 */
function seedFrom(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function randomFromSeed(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function inkStrokePath(rand, a, b, { segments = 5, amplitude = 1.4 } = {}) {
  const round = (n) => Math.round(n * 100) / 100;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const overshoot = (rand() - 0.3) * amplitude * 1.6;
  let d = `M ${round(a.x)} ${round(a.y)}`;
  for (let i = 1; i <= segments; i += 1) {
    const t = i / segments;
    const tPrev = (i - 1) / segments;
    const tMid = (t + tPrev) / 2;
    const jitter = (rand() - 0.5) * 2 * amplitude * Math.sin(Math.PI * tMid);
    const cx = a.x + dx * tMid + nx * jitter;
    const cy = a.y + dy * tMid + ny * jitter;
    const ex = a.x + dx * t + (i === segments ? nx * overshoot : 0);
    const ey = a.y + dy * t + (i === segments ? ny * overshoot : 0);
    d += ` Q ${round(cx)} ${round(cy)} ${round(ex)} ${round(ey)}`;
  }
  return d;
}

const K_STROKE = inkStrokePath(
  randomFromSeed(seedFrom('inkcast-wordmark-k')),
  { x: -7, y: 6.2 },
  { x: 107, y: 5.4 },
  { amplitude: 1.6 },
);

/* ------------------------------------------------------------------ pages */

const fontData = (rel) => readFileSync(join(ROOT, rel)).toString('base64');
const FONT_CSS = `
@font-face { font-family: 'Space Grotesk'; src: url(data:font/woff2;base64,${fontData('assets/fonts/ui/SpaceGrotesk-Variable.woff2')}) format('woff2-variations'); font-weight: 300 700; }
@font-face { font-family: 'Inter'; src: url(data:font/woff2;base64,${fontData('assets/fonts/ui/Inter-Variable.woff2')}) format('woff2-variations'); font-weight: 100 900; }
`;

/** The lockup, as HTML, at a given mark size. Mirrors `Logo` in logo.tsx. */
function lockupHtml(size, p) {
  const font = Math.round(size * 0.68);
  const gap = Math.round(size * 0.3);
  const weight = Math.max(1.5, size * 0.085);
  return `<span style="display:inline-flex;align-items:center;gap:${gap}px">
  ${markSvg({ size }).replace('<svg ', '<svg style="display:block" ')}
  <span style="font-family:'Space Grotesk';font-weight:700;font-size:${font}px;letter-spacing:-0.03em;line-height:1;color:${p.foreground}">in<span style="position:relative;display:inline-block">k<svg viewBox="0 0 100 12" preserveAspectRatio="none" style="position:absolute;bottom:-0.1em;left:0;width:100%;height:0.3em;overflow:visible"><path d="${K_STROKE}" fill="none" stroke="${p.highlighter}" stroke-width="${weight}" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg></span>cast</span>
</span>`;
}

const DOT_GRID = (p) =>
  `background-color:${p.background};background-image:radial-gradient(circle, ${p.gridDot} 1px, transparent 1px);background-size:${geom.gridSize}px ${geom.gridSize}px;`;

/**
 * The OG card, 1200x630. Copy is the landing hero's, verbatim
 * (components/marketing/hero.tsx) — a share card that promises something the
 * page does not say is a lie with a longer half-life than most.
 */
function ogHtml() {
  const p = palette.light;
  return `<!doctype html><html><head><style>${FONT_CSS}
  html,body{margin:0;padding:0}
  body{width:1200px;height:630px;${DOT_GRID(p)}display:flex;align-items:center;overflow:hidden}
  </style></head><body>
  <div style="flex:1;padding:0 0 0 76px;display:flex;flex-direction:column;gap:34px;max-width:700px">
    ${lockupHtml(56, p)}
    <h1 style="margin:0;font-family:'Space Grotesk';font-weight:700;font-size:74px;line-height:1.02;letter-spacing:-0.035em;color:${p.foreground};text-wrap:balance">Type a topic. Watch it get drawn.</h1>
    <p style="margin:0;font-family:'Inter';font-weight:400;font-size:25px;line-height:1.45;letter-spacing:-0.01em;color:${p.mutedForeground};max-width:600px">Hand-drawn explainer videos with a voice that actually teaches &mdash; any topic, any format, free.</p>
  </div>
  <div style="width:436px;display:flex;justify-content:center;align-items:center">
    ${markSvg({ size: 300 })}
  </div>
  </body></html>`;
}

/**
 * 180x180 opaque tile for iOS home screens.
 *
 * Opaque because iOS composites its own mask and a transparent apple-icon comes
 * out black, and only 120 of the 180 px are spent on the mark: iOS rounds the
 * corners hard, and the mark's offset shadow lives in its bottom-right corner,
 * which is exactly the region a superellipse mask eats. 30px of paper on each
 * side keeps the shadow inside the safe area. The dot grid is here for the same
 * reason it is on `body` — the paper is part of the mark's context.
 */
function appleHtml() {
  const p = palette.light;
  return `<!doctype html><html><head><style>html,body{margin:0}
  body{width:180px;height:180px;${DOT_GRID(p)}display:flex;align-items:center;justify-content:center}
  </style></head><body>${markSvg({ size: 120 })}</body></html>`;
}

/* -------------------------------------------------------------------- .ico */

/**
 * A .ico is a 6-byte directory header, one 16-byte entry per size, then the
 * payloads. Since Vista every browser accepts PNG payloads instead of BMP, so
 * the entries are the PNGs Chromium just rendered — no bitmap encoder, no
 * palette quantisation, and the alpha channel survives.
 */
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/* -------------------------------------------------------------------- main */

const proofDir = process.argv.includes('--proof')
  ? resolve(process.argv[process.argv.indexOf('--proof') + 1])
  : null;

assertLogoMatchesGeometry();
console.log('geometry.json and logo.tsx agree');
console.log('palette light:', palette.light);
console.log('palette dark: ', palette.dark);
console.log('k flourish:   ', K_STROKE);

const write = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  const bytes = Buffer.isBuffer(contents) ? contents.length : Buffer.byteLength(contents);
  console.log(`wrote ${path.replace(ROOT + '/', '')} (${bytes} B)`);
};

write(join(HERE, 'mark.svg'), markSvg());
write(join(HERE, 'mark-dark.svg'), markSvg({ theme: 'dark' }));
write(join(HERE, 'mark-icon.svg'), iconSvg());
write(join(APP, 'icon.svg'), iconSvg());

const browser = await chromium.launch();
try {
  const shot = async (html, width, height, { transparent = false, scale = 1 } = {}) => {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: scale,
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ omitBackground: transparent });
    await page.close();
    return buf;
  };

  const iconPage = (size) =>
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>${iconSvg().replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`;

  const icoSizes = [16, 32, 48];
  const pngs = [];
  for (const size of icoSizes) {
    pngs.push({ size, data: await shot(iconPage(size), size, size, { transparent: true }) });
  }
  write(join(APP, 'favicon.ico'), packIco(pngs));

  write(join(APP, 'apple-icon.png'), await shot(appleHtml(), 180, 180));
  write(join(APP, 'opengraph-image.png'), await shot(ogHtml(), 1200, 630));
  // Next reads `opengraph-image.alt.txt` and emits it as `og:image:alt`. It
  // describes the picture rather than repeating the headline, because a reader
  // who cannot see the card already gets the headline from `og:title`.
  write(
    join(APP, 'opengraph-image.alt.txt'),
    'The inkcast logo — a square ink-bordered tile with one violet marker stroke ' +
      'rising across it into a triangular nib — beside the headline "Type a topic. ' +
      'Watch it get drawn.", on dotted paper.\n',
  );

  if (proofDir) {
    for (const size of [16, 32, 64, 512]) {
      write(
        join(proofDir, `proof-icon-${size}.png`),
        await shot(iconPage(size), size, size, { transparent: false }),
      );
      const full = `<!doctype html><html><head><style>html,body{margin:0;background:${palette.light.background}}</style></head><body>${markSvg({ size }).replace('<svg ', '<svg style="display:block" ')}</body></html>`;
      write(join(proofDir, `proof-mark-${size}.png`), await shot(full, size, size));
    }
    // The lockup at the size the nav uses, and at OG size, both at 2x so the
    // flourish under the `k` is inspectable.
    for (const size of [28, 56]) {
      const html = `<!doctype html><html><head><style>${FONT_CSS}html,body{margin:0;background:${palette.light.background}}body{padding:12px;display:inline-block}</style></head><body>${lockupHtml(size, palette.light)}</body></html>`;
      write(
        join(proofDir, `proof-lockup-${size}.png`),
        await shot(html, size * 8, size * 2 + 24, { scale: 2 }),
      );
    }
    console.log(`proofs in ${proofDir}`);
  }
} finally {
  await browser.close();
}

if (!existsSync(join(APP, 'favicon.ico'))) throw new Error('favicon.ico was not written');
console.log('done');
