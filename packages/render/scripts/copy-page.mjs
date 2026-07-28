/**
 * `tsc` only emits TypeScript. The animation runtime is hand-written vanilla JS
 * (it has to run inside the render page, not in Node), so copy it into `dist/`
 * after a build. `html.ts` looks in both places, so this is only needed when the
 * package is consumed from `dist` rather than from source.
 */
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'page');
const to = path.join(root, 'dist', 'page');

await mkdir(path.dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
process.stdout.write(`copied ${path.relative(root, from)} -> ${path.relative(root, to)}\n`);
