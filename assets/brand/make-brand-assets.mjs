#!/usr/bin/env node
// Regenerate every logo export from geometry.json and the shared CSS tokens.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const app = join(root, 'apps/web/app');
const geometry = JSON.parse(readFileSync(join(here, 'geometry.json'), 'utf8'));
const css = readFileSync(join(app, 'globals.css'), 'utf8');
function rgb(spec) {
  const [L, C, h] = spec.match(/[\d.]+/g).map(Number);
  const a = C * Math.cos((h * Math.PI) / 180),
    b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return (
    '#' +
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
      .map((v) =>
        Math.round(
          255 *
            (v <= 0.0031308 ? 12.92 * Math.max(0, v) : 1.055 * Math.min(1, v) ** (1 / 2.4) - 0.055),
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const sections = [
  css.slice(css.indexOf(':root {'), css.indexOf('\n.dark,\n')),
  css.slice(css.indexOf('\n.dark,\n'), css.indexOf('@theme {')),
];
// Tokens may reference primitives (`--background: var(--paper-100)`), and dark-theme
// roles may reference primitives declared only in :root, so resolve var() chains.
const raw = (name, dark) => {
  const own = dark && sections[1].match(new RegExp(`--${name}: ([^;]+);`));
  const value = own ? own[1] : sections[0].match(new RegExp(`--${name}: ([^;]+);`))[1];
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? raw(ref[1], dark) : value;
};
const token = (name, dark = false) => rgb(raw(name, dark));
const primary = token('primary'),
  paper = token('background'),
  ink = token('foreground'),
  highlighter = token('highlighter');
const markColors = (dark = false) => [
  token('mark-tile', dark),
  token('mark-stroke', dark),
  token('mark-play', dark),
];
const mark = (tile, stroke, play) =>
  `<rect width="40" height="40" rx="${geometry.tileRadius}" fill="${tile}"/><path d="${geometry.stroke}" fill="${stroke}"/><path d="${geometry.play}" fill="${play}"/>`;
const svg = (dark = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geometry.viewBox}">${mark(...markColors(dark))}</svg>`;
writeFileSync(join(here, 'mark.svg'), svg());
writeFileSync(join(here, 'mark-dark.svg'), svg(true));
const [lt, ls, lp] = markColors();
const [dt, ds, dp] = markColors(true);
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geometry.viewBox}"><style>:root{--t:${lt};--s:${ls};--p:${lp}}@media(prefers-color-scheme:dark){:root{--t:${dt};--s:${ds};--p:${dp}}}</style>${mark('var(--t)', 'var(--s)', 'var(--p)')}</svg>`;
writeFileSync(join(here, 'mark-icon.svg'), icon);
writeFileSync(join(app, 'icon.svg'), icon);
const sizes = [16, 32, 48, 64];
const buffers = await Promise.all(
  sizes.map((size) => sharp(Buffer.from(svg())).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const n = 6 + 16 * i;
  header[n] = sizes[i];
  header[n + 1] = sizes[i];
  header.writeUInt16LE(1, n + 4);
  header.writeUInt16LE(32, n + 6);
  header.writeUInt32LE(buffers[i].length, n + 8);
  header.writeUInt32LE(offset, n + 12);
  offset += buffers[i].length;
}
writeFileSync(join(app, 'favicon.ico'), Buffer.concat([header, ...buffers]));
await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="${paper}"/><g transform="translate(26 26) scale(3.2)">${mark(...markColors())}</g></svg>`,
  ),
)
  .png()
  .toFile(join(app, 'apple-icon.png'));
const serif = "Newsreader, 'Iowan Old Style', Georgia, serif";
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${paper}"/><g transform="translate(76 64) scale(1.5)">${mark(...markColors())}</g><text x="150" y="106" font-family="sans-serif" font-size="36" font-weight="600" letter-spacing="-0.5" fill="${ink}">inkcast</text><text x="76" y="300" font-family="${serif}" font-size="92" letter-spacing="-2.5" fill="${ink}">Explain anything with</text><rect x="70" y="352" width="792" height="50" rx="6" fill="${highlighter}" transform="rotate(-0.6 400 377)"/><text x="76" y="400" font-family="${serif}" font-size="92" letter-spacing="-2.5" fill="${ink}">a hand-drawn video.</text><text x="76" y="520" font-family="sans-serif" font-size="27" fill="${token('muted-foreground')}">Type a question or drop in your notes. Inkcast writes it, draws it and narrates it.</text><text x="76" y="574" font-family="sans-serif" font-size="22" font-weight="600" fill="${ink}">inkcast.video</text></svg>`;
await sharp(Buffer.from(og)).png().toFile(join(app, 'opengraph-image.png'));
writeFileSync(
  join(app, 'opengraph-image.alt.txt'),
  'Inkcast — Explain anything with a hand-drawn video. Type a question or drop in your notes; Inkcast writes it, draws it and narrates it.',
);
// The renderer cannot import a JSON file outside its TypeScript rootDir.
writeFileSync(
  join(root, 'packages/render/src/brand.ts'),
  `// Generated by assets/brand/make-brand-assets.mjs. Do not edit.\nexport const INKCAST_BRAND = ${JSON.stringify({ path: geometry.path, tilePath: geometry.tilePath, tileRadius: geometry.tileRadius, fill: token('mark-tile'), foreground: token('mark-stroke') }, null, 2)} as const;\n`,
);
console.log(
  'Generated SVG marks, multi-size favicon, Apple icon, social preview and render branding.',
);
