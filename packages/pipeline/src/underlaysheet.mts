/**
 * Can the drawing author place its marks **on top of a generated image**?
 *
 *     npx tsx packages/pipeline/src/underlaysheet.mts "<subject>" "<instruction>" [outDir]
 *
 * The experiment behind the hybrid drawing lane, run before any of it is built.
 *
 * Measured earlier this session, same beat and same words: the diffusion model returns an
 * anatomically correct heart containing none of the conduction system, and the composed
 * marks return a correct, fully labelled conduction system drawn on a valentine ❤️. Each
 * lane supplies exactly what the other lacks. The obvious move is to use the image for the
 * *form* and the marks for the *parts and their names*.
 *
 * The whole question is alignment. Marks are placed on a 1000x560 canvas by a model that
 * has never seen the picture they are meant to sit on, so "the SA node is high in the
 * right atrium" lands wherever the author guessed. **Unless it is shown the image.** That
 * is the only thing this script tests, and it is worth testing on its own because if it
 * fails there is no point building the seam, the schema field, the compiler branch or the
 * brief.
 *
 * Writes three files: the underlay as generated, the marks drawn alone, and the marks
 * drawn over the underlay — which is the one to look at.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DRAW_H, DRAW_W, Mark } from '@inkcast/core';
import { anthropicClient, callTool, drawModel } from '@inkcast/planner';
// Not on the package index: `imagePart` and the drawing schema are internals the stage
// uses, and a verification tool has no business widening a package's public surface.
const plannerSrc = new URL('../../planner/src/', import.meta.url).href;
const { imagePart } = (await import(`${plannerSrc}anthropic.js`)) as {
  imagePart(png: Uint8Array): {
    type: 'image';
    source: { type: 'base64'; media_type: 'image/png'; data: string };
  };
};
const { drawingJsonSchema } = (await import(`${plannerSrc}schema.js`)) as {
  drawingJsonSchema(): Promise<Record<string, unknown> | undefined>;
};
import { generateIllustration } from '@inkcast/visuals';
import { openDrawPreview } from './draw-preview.js';

const [subject, instruction, out = '/tmp/underlay'] = process.argv.slice(2);
if (!subject || !instruction) {
  console.error('usage: underlaysheet.mts "<subject>" "<instruction>" [outDir]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const vaultSpecifier = new URL('../../keyvault/src/index.ts', import.meta.url).href;
try {
  const kv = (await import(vaultSpecifier)) as { hydrateEnv(): Promise<unknown> };
  await kv.hydrateEnv();
} catch {
  /* environment it is */
}

/* --- 1. the form, from the image lane --- */

const png = await generateIllustration(subject);
if (!png) {
  console.error('no image came back — is FAL_KEY set?');
  process.exit(1);
}
writeFileSync(path.join(out, 'underlay.png'), png);
console.log(`underlay: ${subject}`);

/* --- 2. the parts, from the drawing author, looking at it --- */

// The image is square and is placed centred, as tall as the canvas. Telling the author
// the exact box is what makes its coordinates mean anything: without it "on the left
// ventricle" is a guess about a picture it cannot see.
const H = DRAW_H;
const X0 = Math.round((DRAW_W - H) / 2);
const BRIEF = `You are annotating a drawing that is ALREADY ON THE BOARD.

The attached image has been drawn on the whiteboard canvas, which is ${DRAW_W} wide and ${DRAW_H} tall (x right, y DOWN, origin top-left). The image occupies exactly the box x=${X0}, y=0, w=${H}, h=${H}. So a feature you can see a fraction fx across and fy down the image is at canvas x = ${X0} + fx*${H}, y = fy*${H}.

LOOK AT THE IMAGE and place marks that annotate what is actually there. Your marks must line up with the real picture — an arrow pointing at a structure has to point at where that structure IS in the image, not where you would have drawn it.

Do NOT redraw the subject. Its outline, its body, its overall form are already there. You are adding only what the image does not have: internal structure, pathways, parts, arrows and NAMES.

The marks: rect{x,y,w,h}, ellipse{x,y,w,h}, line{points}, stroke{points,smooth,closed}, arrow{points} (head on the last point), label{x,y,text,size} (x,y is the CENTRE, size 26-34), hatch{x,y,w,h,angle}, dots{x,y,w,h,count}. Each takes an optional tone: "accent" for the thing the beat is about, "contrast" for the thing that must not be confused with it, "muted" for context.

Put labels in the CLEAR SPACE beside the image (there is room to the left and right of the box above) and run an arrow from the label to the structure it names. 10-20 marks. Name every mark after its part. Emit the drawing by calling emit_drawing exactly once.`;

const c = await anthropicClient();
const schema = await drawingJsonSchema();
if (!c || !schema) {
  console.error('no ANTHROPIC_API_KEY, or the schema would not build');
  process.exit(1);
}

/**
 * Ask, and re-ask if what comes back cannot be read.
 *
 * `elements` arrives as a JSON *string* often enough that the real lane parses rather than
 * rejects it (see `draw-anthropic.ts`). On this call it came back as a string **and**
 * malformed — `{"x":565,y":300}`, one quote missing — which no amount of parsing fixes and
 * which the model does not recognise as an error when shown. So: repair the one corruption
 * that actually occurs, and otherwise just ask again.
 */
function readMarks(raw: unknown): Mark[] {
  let list: unknown = (raw as { elements?: unknown } | undefined)?.elements;
  if (typeof list === 'string') {
    const text = list;
    const tries = [text, text.replace(/,\s*([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, ',"$1":')];
    list = undefined;
    for (const t of tries) {
      try {
        list = JSON.parse(t);
        break;
      } catch {
        /* next */
      }
    }
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((m) => {
    const one = Mark.safeParse(m);
    return one.success ? [one.data] : [];
  });
}

let marks: Mark[] = [];
for (let attempt = 1; attempt <= 3 && !marks.length; attempt++) {
  const raw = await callTool(
    c,
    drawModel(),
    BRIEF,
    [{ role: 'user', content: [imagePart(png), { type: 'text', text: instruction }] }],
    schema,
    { name: 'emit_drawing', description: 'Emit the marks that annotate the attached image.' },
  );
  marks = readMarks(raw);
  if (!marks.length) console.log(`attempt ${attempt}: nothing readable came back`);
}
if (!marks.length) {
  console.error('three attempts, no usable marks');
  process.exit(1);
}

const off = marks.filter((m) => {
  const ys = [m.y ?? 0, (m.y ?? 0) + (m.h ?? 0), ...(m.points ?? []).map((p) => p[1] ?? 0)];
  return ys.some((v) => v > DRAW_H + 20 || v < -20);
});
console.log(
  `${marks.length} marks placed${off.length ? `, ${off.length} outside the canvas` : ''}`,
);
for (const m of marks) console.log(`  ${m.kind.padEnd(7)} ${m.id}${m.text ? ` "${m.text}"` : ''}`);

/* --- 3. look at it: the marks over the image they were aimed at --- */

// Drawn plainly, in flat SVG, and NOT through `openDrawPreview` — which fits a drawing to
// its own box by content bounds and would silently rescale exactly the coordinates under
// test. What is being measured is aim, not ink: whether an arrow the author says points at
// the left ventricle points at the left ventricle.
const esc = (t: string) =>
  t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
const ink = (m: Mark) =>
  m.tone === 'accent'
    ? '#2f6fed'
    : m.tone === 'contrast'
      ? '#c2410c'
      : m.tone === 'muted'
        ? '#5a6472'
        : '#1b232e';
const pts = (m: Mark) => (m.points ?? []).map((p) => `${p[0]},${p[1]}`).join(' ');

const svg: string[] = [];
for (const m of marks) {
  const c = ink(m);
  if (m.kind === 'rect')
    svg.push(
      `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="none" stroke="${c}" stroke-width="3"/>`,
    );
  else if (m.kind === 'ellipse')
    svg.push(
      `<ellipse cx="${(m.x ?? 0) + (m.w ?? 0) / 2}" cy="${(m.y ?? 0) + (m.h ?? 0) / 2}" rx="${(m.w ?? 0) / 2}" ry="${(m.h ?? 0) / 2}" fill="none" stroke="${c}" stroke-width="3"/>`,
    );
  else if (m.kind === 'label')
    svg.push(
      `<text x="${m.x}" y="${m.y}" fill="${c}" font-size="${m.size ?? 30}" font-family="system-ui" text-anchor="middle" dominant-baseline="middle" paint-order="stroke fill" stroke="#fcfbf9" stroke-width="6">${esc(m.text ?? '')}</text>`,
    );
  else if (m.kind === 'dots') {
    const n = Math.min(30, Math.round(m.count ?? 6));
    for (let i = 0; i < n; i++)
      svg.push(
        `<circle cx="${(m.x ?? 0) + ((i * 37) % (m.w ?? 1))}" cy="${(m.y ?? 0) + ((i * 53) % (m.h ?? 1))}" r="5" fill="${c}"/>`,
      );
  } else if (m.kind === 'hatch')
    svg.push(
      `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="${c}" opacity="0.18"/>`,
    );
  else if (m.points?.length) {
    svg.push(
      `<polyline points="${pts(m)}" fill="none" stroke="${c}" stroke-width="3"${m.closed ? '' : ''}/>`,
    );
    if (m.kind === 'arrow') {
      const a = m.points[m.points.length - 2] ?? m.points[0]!;
      const b = m.points[m.points.length - 1]!;
      const ang = Math.atan2((b[1] ?? 0) - (a[1] ?? 0), (b[0] ?? 0) - (a[0] ?? 0));
      const h = 16;
      svg.push(
        `<polyline points="${(b[0] ?? 0) - h * Math.cos(ang - 0.4)},${(b[1] ?? 0) - h * Math.sin(ang - 0.4)} ${b[0]},${b[1]} ${(b[0] ?? 0) - h * Math.cos(ang + 0.4)},${(b[1] ?? 0) - h * Math.sin(ang + 0.4)}" fill="none" stroke="${c}" stroke-width="3"/>`,
      );
    }
  }
}

const html = `<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${DRAW_W}" height="${DRAW_H}" viewBox="0 0 ${DRAW_W} ${DRAW_H}">
<rect width="100%" height="100%" fill="#fcfbf9"/>
<image x="${X0}" y="0" width="${H}" height="${H}" href="data:image/png;base64,${Buffer.from(png).toString('base64')}"/>
${svg.join('\n')}
</svg></body>`;

const { chromium } = (await import('playwright')) as typeof import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: DRAW_W, height: DRAW_H },
  deviceScaleFactor: 2,
});
await page.setContent(html);
await page.screenshot({ path: path.join(out, 'composite.png') });
await browser.close();

writeFileSync(path.join(out, 'marks.json'), `${JSON.stringify(marks, null, 1)}\n`);
console.log(`\n${out}/composite.png   <- look at this one`);
console.log(`${out}/underlay.png · marks.json`);
