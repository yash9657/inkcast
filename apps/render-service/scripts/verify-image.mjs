// Build-time checks for the render image, so a broken image fails its build
// rather than its first render: Chromium is where Playwright will look, the ONNX
// runtime's native binding loads, and the baked weights are readable.
import { accessSync, constants, existsSync } from 'node:fs';

const { chromium } = await import('playwright');
// The renderer only ever launches headless, which Playwright serves from the
// headless shell; `--only-shell` in Dockerfile.vercel installs just that.
console.log(`playwright browsers: ${process.env.PLAYWRIGHT_BROWSERS_PATH}`);

const ort = await import('onnxruntime-node');
if (typeof (ort.InferenceSession ?? ort.default?.InferenceSession) !== 'function') {
  throw new Error('onnxruntime-node loaded but exposes no InferenceSession');
}
console.log('onnxruntime-node: native binding loaded');

const cache = process.env.INKCAST_MODEL_CACHE;
for (const repo of [
  'onnx-community/Kokoro-82M-v1.0-ONNX',
  'onnx-community/whisper-tiny.en_timestamped',
]) {
  accessSync(`${cache}/${repo}`, constants.R_OK);
}
console.log('weights: readable');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<p>ok</p>');
console.log(`chromium: launched (${browser.version()})`);
await browser.close();
